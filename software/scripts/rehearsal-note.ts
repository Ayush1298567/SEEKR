import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";

export interface RehearsalNoteManifest {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  operator?: string;
  status: "template";
  freshOperatorCompleted: false;
  commandUploadEnabled: false;
  evidence: {
    acceptanceStatusPath?: string;
    releaseChecksumPath?: string;
    completionAuditPath?: string;
    hardwareEvidencePath?: string;
    rehearsalEvidencePaths: string[];
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  requiredOperatorFields: string[];
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/rehearsal-notes";
const REQUIRED_OPERATOR_FIELDS = [
  "operator_name",
  "machine_identifier",
  "setup_started_at",
  "acceptance_completed_at",
  "before_run_rehearsal_evidence_path",
  "mission_export_completed_at",
  "replay_id",
  "final_state_hash",
  "after_run_rehearsal_evidence_path",
  "shutdown_completed_at",
  "deviations_or_failures"
];

export async function buildRehearsalNote(options: {
  root?: string;
  generatedAt?: string;
  label?: string;
  operator?: string;
} = {}): Promise<RehearsalNoteManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label ?? "field-laptop-rehearsal";
  const acceptancePath = path.join(root, ".tmp", "acceptance-status.json");
  const acceptance = await readJson(acceptancePath);
  const release = await latestJson(root, ".tmp/release-evidence", (name) => name.startsWith("seekr-release-"));
  const completionAudit = await latestJson(root, ".tmp/completion-audit", (name) => name.startsWith("seekr-completion-audit-"));
  const hardwareEvidence = await latestJson(root, ".tmp/hardware-evidence", (name) => name.startsWith("seekr-hardware-evidence-"));
  const rehearsalEvidence = await allJson(root, ".tmp/rehearsal-evidence", (name) => name.startsWith("seekr-rehearsal-evidence-"));
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (!isRecord(acceptance) || acceptance.ok !== true || acceptance.commandUploadEnabled !== false) {
    blockers.push("Acceptance status is missing, failing, or does not prove commandUploadEnabled false.");
  }
  if (!release) warnings.push("No release checksum evidence was found under .tmp/release-evidence.");
  if (!completionAudit) warnings.push("No completion audit evidence was found under .tmp/completion-audit.");
  if (!hardwareEvidence) warnings.push("No hardware readiness archive was found under .tmp/hardware-evidence.");
  if (rehearsalEvidence.length < 2) {
    warnings.push("Fewer than two rehearsal evidence snapshots were found; capture before-run and after-run snapshots.");
  }

  const hardwareManifest = hardwareEvidence ? await readJson(hardwareEvidence.absolutePath) : undefined;
  if (isRecord(hardwareManifest) && hardwareManifest.actualHardwareValidationComplete !== true) {
    warnings.push("Latest hardware archive is not actual Jetson/Pi validation; keep it labeled as setup/readiness evidence only.");
  }

  return {
    schemaVersion: 1,
    generatedAt,
    label,
    operator: options.operator,
    status: "template",
    freshOperatorCompleted: false,
    commandUploadEnabled: false,
    evidence: {
      acceptanceStatusPath: relativeIfExists(root, acceptancePath),
      releaseChecksumPath: release?.relativePath,
      completionAuditPath: completionAudit?.relativePath,
      hardwareEvidencePath: hardwareEvidence?.relativePath,
      rehearsalEvidencePaths: rehearsalEvidence.slice(-4).map((item) => item.relativePath)
    },
    validation: {
      ok: blockers.length === 0,
      warnings,
      blockers
    },
    requiredOperatorFields: REQUIRED_OPERATOR_FIELDS,
    limitations: [
      "This file is a rehearsal note template until a human operator fills every required field.",
      "It does not prove actual Jetson/Pi hardware validation unless the linked hardware archive says actualHardwareValidationComplete true.",
      "It does not enable real MAVLink, ROS 2, PX4, ArduPilot, or aircraft command upload."
    ]
  };
}

export async function writeRehearsalNote(options: {
  root?: string;
  outDir?: string;
  generatedAt?: string;
  label?: string;
  operator?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildRehearsalNote(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const safeLabel = safeFileNamePart(manifest.label, "run");
  const baseName = `seekr-rehearsal-note-${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function latestJson(root: string, directory: string, predicate: (name: string) => boolean) {
  return (await allJson(root, directory, predicate)).at(-1);
}

async function allJson(root: string, directory: string, predicate: (name: string) => boolean) {
  const absoluteDir = path.join(root, directory);
  try {
    const names = (await readdir(absoluteDir)).filter((name) => name.endsWith(".json") && predicate(name)).sort();
    return names.map((name) => ({
      absolutePath: path.join(absoluteDir, name),
      relativePath: path.posix.join(directory.split(path.sep).join("/"), name)
    }));
  } catch {
    return [];
  }
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function relativeIfExists(root: string, absolutePath: string) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderMarkdown(manifest: RehearsalNoteManifest) {
  return `${[
    "# SEEKR Field-Laptop Rehearsal Note",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Label: ${manifest.label}`,
    manifest.operator ? `Operator: ${manifest.operator}` : "Operator: TODO",
    `Status: ${manifest.status}`,
    `Fresh operator completed: ${manifest.freshOperatorCompleted}`,
    "",
    "Command upload enabled: false",
    "",
    "Safety limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    "",
    "Evidence links:",
    "",
    `- Acceptance status: ${manifest.evidence.acceptanceStatusPath ?? "missing"}`,
    `- Release checksum: ${manifest.evidence.releaseChecksumPath ?? "missing"}`,
    `- Completion audit: ${manifest.evidence.completionAuditPath ?? "missing"}`,
    `- Hardware evidence: ${manifest.evidence.hardwareEvidencePath ?? "missing"}`,
    ...manifest.evidence.rehearsalEvidencePaths.map((item) => `- Rehearsal evidence: ${item}`),
    "",
    "Required operator fields:",
    "",
    ...manifest.requiredOperatorFields.map((field) => `- [ ] ${field}:`),
    "",
    "Validation:",
    "",
    `- OK: ${manifest.validation.ok}`,
    ...(manifest.validation.blockers.length ? manifest.validation.blockers.map((item) => `- Blocker: ${item}`) : ["- Blockers: none"]),
    ...(manifest.validation.warnings.length ? manifest.validation.warnings.map((item) => `- Warning: ${item}`) : ["- Warnings: none"]),
    "",
    "Run log:",
    "",
    "- Setup started:",
    "- Acceptance completed:",
    "- Before-run evidence captured:",
    "- Mission exported:",
    "- Replay verified:",
    "- After-run evidence captured:",
    "- Shutdown completed:",
    "- Deviations or failures:",
    ""
  ].join("\n")}\n`;
}

function parseArgs(values: string[]) {
  const parsed: Record<string, string | boolean | undefined> = {};
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (typeof inlineValue === "string") parsed[rawKey] = inlineValue;
    else if (values[index + 1] && !values[index + 1].startsWith("--")) parsed[rawKey] = values[++index];
    else parsed[rawKey] = true;
  }
  return parsed;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  const result = await writeRehearsalNote({
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    operator: typeof args.operator === "string" ? args.operator : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    status: result.manifest.status,
    freshOperatorCompleted: result.manifest.freshOperatorCompleted,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    warnings: result.manifest.validation.warnings,
    blockers: result.manifest.validation.blockers,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
