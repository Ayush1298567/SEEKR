import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";

export interface CommandBoundaryScanFinding {
  id: string;
  file: string;
  line: number;
  match: string;
  message: string;
}

export interface CommandBoundaryScanManifest {
  schemaVersion: 1;
  generatedAt: string;
  status: "pass" | "fail";
  commandUploadEnabled: false;
  safetyBoundary: {
    realAircraftCommandUpload: false;
    hardwareActuationEnabled: false;
    runtimePolicyInstalled: false;
  };
  scannedFiles: string[];
  summary: {
    scannedFileCount: number;
    violationCount: number;
    allowedFindingCount: number;
  };
  violations: CommandBoundaryScanFinding[];
  allowedFindings: CommandBoundaryScanFinding[];
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/safety-evidence";
const DEFAULT_INPUTS = ["src", "scripts", "package.json"];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);
const SKIPPED_PARTS = new Set(["__tests__", "dist", "node_modules"]);
const ALLOWED_OUTBOUND_COMMAND_FILES = new Set(["src/flight/sitl/mapper.ts"]);
const SCANNER_RULE_FILES = new Set(["scripts/command-boundary-scan.ts", "scripts/completion-audit.ts"]);
const ALLOWED_HARDWARE_TRANSPORT_FILES = new Set([
  "src/flight/safety.ts",
  "src/flight/bench.ts",
  "src/flight/sitl/bench.ts",
  "src/flight/sitl/processIo.ts"
]);
const REAL_ADAPTER_FILES = [
  "src/server/adapters/mavlinkAdapter.ts",
  "src/server/adapters/ros2SlamAdapter.ts"
];

const UNSAFE_TRUTH_ASSIGNMENT = /\b(commandUploadEnabled|hardwareActuationEnabled|realAircraftCommandUploadAuthorized|runtimeInstallApproved|allowHardwareActuation)\s*:\s*true\b/g;
const ACCEPTED_TRUE = /\baccepted\s*:\s*true\b/g;
const COMMAND_ACCEPTED = /\bcommandAccepted\b/g;
const HARDWARE_TRANSPORT = /\btransport\s*:\s*["']hardware["']/g;
const OUTBOUND_COMMAND_TOKEN = /\b(COMMAND_LONG|SET_MODE|DO_SET_MODE|PARAM_SET|MISSION_ITEM_INT|MISSION_COUNT|MISSION_WRITE_PARTIAL_LIST|MISSION_REQUEST|MISSION_ACK|MISSION_CLEAR_ALL|MISSION_SET_CURRENT|MAV_CMD_[A-Z0-9_]+)\b/g;

export async function buildCommandBoundaryScan(options: {
  root?: string;
  generatedAt?: string;
  inputs?: string[];
} = {}): Promise<CommandBoundaryScanManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const files = await collectScanFiles(root, options.inputs ?? DEFAULT_INPUTS);
  const violations: CommandBoundaryScanFinding[] = [];
  const allowedFindings: CommandBoundaryScanFinding[] = [];

  for (const file of files) {
    const content = await readFile(path.join(root, file), "utf8");
    scanContent(file, content, violations, allowedFindings);
  }

  for (const adapterFile of REAL_ADAPTER_FILES) {
    const content = await readText(path.join(root, adapterFile));
    if (!content) {
      violations.push(finding("missing-real-adapter", adapterFile, 1, "", "Real adapter file is missing from the command-boundary scan."));
      continue;
    }
    for (const method of ["uploadMission", "hold", "returnHome"]) {
      if (!methodRejects(content, method)) {
        violations.push(finding("real-adapter-command-not-rejected", adapterFile, 1, method, `Real adapter method ${method} must return commandRejected.`));
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt,
    status: violations.length ? "fail" : "pass",
    commandUploadEnabled: false,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    scannedFiles: files,
    summary: {
      scannedFileCount: files.length,
      violationCount: violations.length,
      allowedFindingCount: allowedFindings.length
    },
    violations,
    allowedFindings,
    limitations: [
      "This is a static source scan for obvious command-boundary regressions.",
      "It does not prove real hardware validation, MAVLink bench telemetry, ROS 2 bench topics, HIL behavior, or Isaac Sim capture.",
      "Real MAVLink, ROS 2, PX4, ArduPilot, mission, geofence, mode, arm, takeoff, land, RTH, terminate, and waypoint command paths remain blocked outside simulator/SITL transports."
    ]
  };
}

export async function writeCommandBoundaryScan(options: Parameters<typeof buildCommandBoundaryScan>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildCommandBoundaryScan(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-command-boundary-scan-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function collectScanFiles(root: string, inputs: string[]) {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const absolutePath = path.resolve(root, input);
    if (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root) {
      throw new Error(`Scan input escapes root: ${input}`);
    }
    await collectPath(root, absolutePath, files, seen);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function collectPath(root: string, absolutePath: string, files: string[], seen: Set<string>) {
  let stats;
  try {
    stats = await stat(absolutePath);
  } catch {
    return;
  }
  const relativePath = toRelativePath(root, absolutePath);
  if (relativePath.split("/").some((part) => SKIPPED_PARTS.has(part))) return;

  if (stats.isDirectory()) {
    const entries = await readdir(absolutePath);
    for (const entry of entries.sort()) await collectPath(root, path.join(absolutePath, entry), files, seen);
    return;
  }

  if (!stats.isFile() || !SCANNED_EXTENSIONS.has(path.extname(absolutePath))) return;
  if (seen.has(relativePath)) return;
  seen.add(relativePath);
  files.push(relativePath);
}

function scanContent(file: string, content: string, violations: CommandBoundaryScanFinding[], allowedFindings: CommandBoundaryScanFinding[]) {
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    scanRegex(file, index + 1, line, UNSAFE_TRUTH_ASSIGNMENT, violations, "unsafe-truth-assignment", "Command-boundary flags must not be set to true in production source.");
    scanAcceptedTrue(file, index + 1, line, violations, allowedFindings);
    scanCommandAccepted(file, index + 1, line, violations, allowedFindings);
    scanHardwareTransport(file, index + 1, line, violations, allowedFindings);
    scanOutboundCommandToken(file, index + 1, line, violations, allowedFindings);
  }
}

function scanAcceptedTrue(
  file: string,
  lineNumber: number,
  line: string,
  violations: CommandBoundaryScanFinding[],
  allowedFindings: CommandBoundaryScanFinding[]
) {
  for (const match of matches(line, ACCEPTED_TRUE)) {
    if (file === "src/server/adapters/vehicleAdapter.ts") {
      allowedFindings.push(finding("adapter-result-helper", file, lineNumber, match, "Adapter accepted-result helper is allowed only in the shared adapter type module."));
    } else if (SCANNER_RULE_FILES.has(file)) {
      allowedFindings.push(finding("scanner-rule-definition", file, lineNumber, match, "Static scanner/audit rule text is allowed to mention unsafe accepted-result patterns."));
    } else {
      violations.push(finding("accepted-command-result", file, lineNumber, match, "Production source must not create accepted real-adapter command results."));
    }
  }
}

function scanCommandAccepted(
  file: string,
  lineNumber: number,
  line: string,
  violations: CommandBoundaryScanFinding[],
  allowedFindings: CommandBoundaryScanFinding[]
) {
  for (const match of matches(line, COMMAND_ACCEPTED)) {
    if (file === "src/server/adapters/vehicleAdapter.ts") {
      allowedFindings.push(finding("adapter-result-helper", file, lineNumber, match, "commandAccepted may only be defined in the shared adapter type module."));
    } else if (SCANNER_RULE_FILES.has(file)) {
      allowedFindings.push(finding("scanner-rule-definition", file, lineNumber, match, "Static scanner/audit rule text is allowed to mention commandAccepted."));
    } else {
      violations.push(finding("command-accepted-used", file, lineNumber, match, "Production source must not import or call commandAccepted for real adapters."));
    }
  }
}

function scanHardwareTransport(
  file: string,
  lineNumber: number,
  line: string,
  violations: CommandBoundaryScanFinding[],
  allowedFindings: CommandBoundaryScanFinding[]
) {
  for (const match of matches(line, HARDWARE_TRANSPORT)) {
    if (ALLOWED_HARDWARE_TRANSPORT_FILES.has(file)) {
      allowedFindings.push(finding("hardware-rejection-proof", file, lineNumber, match, "Hardware transport literals are allowed only in rejection proof paths."));
    } else {
      violations.push(finding("hardware-transport-literal", file, lineNumber, match, "Hardware transport literals outside rejection proof paths need explicit review."));
    }
  }
}

function scanOutboundCommandToken(
  file: string,
  lineNumber: number,
  line: string,
  violations: CommandBoundaryScanFinding[],
  allowedFindings: CommandBoundaryScanFinding[]
) {
  for (const match of matches(line, OUTBOUND_COMMAND_TOKEN)) {
    if (ALLOWED_OUTBOUND_COMMAND_FILES.has(file)) {
      allowedFindings.push(finding("sitl-command-token", file, lineNumber, match, "Outbound command token is allowed only in SITL mapping code."));
    } else if (file === "scripts/command-boundary-scan.ts") {
      allowedFindings.push(finding("scanner-rule-definition", file, lineNumber, match, "Static scanner rule text is allowed to name blocked outbound command tokens."));
    } else {
      violations.push(finding("outbound-command-token", file, lineNumber, match, "Outbound MAVLink/PX4/ArduPilot command token outside SITL mapping is not allowed."));
    }
  }
}

function scanRegex(
  file: string,
  lineNumber: number,
  line: string,
  pattern: RegExp,
  violations: CommandBoundaryScanFinding[],
  id: string,
  message: string
) {
  for (const match of matches(line, pattern)) violations.push(finding(id, file, lineNumber, match, message));
}

function matches(line: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  const values: string[] = [];
  let match;
  while ((match = pattern.exec(line))) values.push(match[0]);
  return values;
}

function methodRejects(content: string, method: string) {
  const methodIndex = content.indexOf(`async ${method}`);
  if (methodIndex === -1) return false;
  const nextMethodIndex = content.indexOf("\n  async ", methodIndex + 1);
  const body = content.slice(methodIndex, nextMethodIndex === -1 ? undefined : nextMethodIndex);
  return body.includes("commandRejected") && !body.includes("commandAccepted");
}

function finding(id: string, file: string, line: number, match: string, message: string): CommandBoundaryScanFinding {
  return { id, file, line, match, message };
}

async function readText(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function renderMarkdown(manifest: CommandBoundaryScanManifest) {
  return `${[
    "# SEEKR Command Boundary Scan",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `Scanned files: ${manifest.summary.scannedFileCount}`,
    `Violations: ${manifest.summary.violationCount}`,
    `Allowed findings: ${manifest.summary.allowedFindingCount}`,
    "",
    "Command upload enabled: false",
    "",
    "Safety boundary:",
    "",
    `- realAircraftCommandUpload: ${manifest.safetyBoundary.realAircraftCommandUpload}`,
    `- hardwareActuationEnabled: ${manifest.safetyBoundary.hardwareActuationEnabled}`,
    `- runtimePolicyInstalled: ${manifest.safetyBoundary.runtimePolicyInstalled}`,
    "",
    "Violations:",
    "",
    ...(manifest.violations.length
      ? manifest.violations.map((item) => `- ${item.file}:${item.line} ${item.id}: ${item.match} - ${item.message}`)
      : ["- None"]),
    "",
    "Allowed findings:",
    "",
    ...(manifest.allowedFindings.length
      ? manifest.allowedFindings.map((item) => `- ${item.file}:${item.line} ${item.id}: ${item.match} - ${item.message}`)
      : ["- None"]),
    "",
    "Limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].join("\n")}\n`;
}

function toRelativePath(root: string, absolutePath: string) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | undefined> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    args[key] = inlineValue ?? argv[index + 1];
    if (!inlineValue) index += 1;
  }
  return args;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  const result = await writeCommandBoundaryScan({
    root: args.root,
    outDir: args.out,
    generatedAt: args.generatedAt
  });
  console.log(JSON.stringify({
    ok: result.manifest.status === "pass",
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    scannedFileCount: result.manifest.summary.scannedFileCount,
    violationCount: result.manifest.summary.violationCount,
    allowedFindingCount: result.manifest.summary.allowedFindingCount,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (result.manifest.status !== "pass") process.exitCode = 1;
}
