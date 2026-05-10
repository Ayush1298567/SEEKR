import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, resolveProjectInputPath, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";

export interface IsaacHilCaptureEvidenceManifest {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  status: "completed" | "blocked";
  commandUploadEnabled: false;
  run: {
    operatorName: string;
    targetHardware: string;
    isaacSimHost: string;
    isaacSimVersion: string;
    isaacRosVersion: string;
    sensorSuite: string;
    captureStartedAt: string;
    captureEndedAt: string;
    captureResult: string;
    deviationsOrFailures: string;
  };
  evidence: {
    hardwareEvidencePath: string;
    rehearsalEvidencePath: string;
    captureManifestPath: string;
    captureLogPath: string;
    replayVerifyPath?: string;
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/isaac-evidence";

export async function buildIsaacHilCaptureEvidence(options: {
  root?: string;
  generatedAt?: string;
  label?: string;
  operatorName?: string;
  targetHardware?: string;
  isaacSimHost?: string;
  isaacSimVersion?: string;
  isaacRosVersion?: string;
  sensorSuite?: string;
  captureStartedAt?: string;
  captureEndedAt?: string;
  captureResult?: string;
  deviationsOrFailures?: string;
  hardwareEvidencePath?: string;
  rehearsalEvidencePath?: string;
  captureManifestPath?: string;
  captureLogPath?: string;
  replayVerifyPath?: string;
  commandUploadEnabledObserved?: string | boolean;
} = {}): Promise<IsaacHilCaptureEvidenceManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label ?? "isaac-hil-capture";
  const warnings: string[] = [];
  const blockers: string[] = [];
  const run = {
    operatorName: stringValue(options.operatorName),
    targetHardware: stringValue(options.targetHardware),
    isaacSimHost: stringValue(options.isaacSimHost),
    isaacSimVersion: stringValue(options.isaacSimVersion),
    isaacRosVersion: stringValue(options.isaacRosVersion),
    sensorSuite: stringValue(options.sensorSuite),
    captureStartedAt: stringValue(options.captureStartedAt),
    captureEndedAt: stringValue(options.captureEndedAt),
    captureResult: stringValue(options.captureResult),
    deviationsOrFailures: stringValue(options.deviationsOrFailures)
  };
  const evidence = {
    hardwareEvidencePath: stringValue(options.hardwareEvidencePath),
    rehearsalEvidencePath: stringValue(options.rehearsalEvidencePath),
    captureManifestPath: stringValue(options.captureManifestPath),
    captureLogPath: stringValue(options.captureLogPath),
    replayVerifyPath: options.replayVerifyPath
  };

  for (const [key, value] of Object.entries({ ...run, ...evidence })) {
    if (key === "replayVerifyPath") continue;
    if (!value || !String(value).trim()) blockers.push(`Missing required Isaac HIL capture field: ${key}.`);
  }

  if (run.targetHardware && !run.targetHardware.toLowerCase().includes("jetson")) {
    blockers.push("Isaac HIL capture evidence must come from a Jetson bench target.");
  }

  const commandUploadEnabledObserved = parseBoolean(options.commandUploadEnabledObserved);
  if (commandUploadEnabledObserved !== false) {
    blockers.push("commandUploadEnabledObserved must be false for Isaac HIL capture evidence.");
  }

  validateTimestampOrder(run, blockers);
  await validateHardwareEvidence(root, evidence.hardwareEvidencePath, run.targetHardware, blockers, warnings);
  await validateRehearsalEvidence(root, evidence.rehearsalEvidencePath, blockers);
  await validateCaptureManifest(root, evidence.captureManifestPath, blockers);
  await validateNonEmptyFile(root, evidence.captureLogPath, "Isaac capture log", blockers);
  if (evidence.replayVerifyPath) await validateReplayVerify(root, evidence.replayVerifyPath, blockers);

  const validationOk = blockers.length === 0;
  return {
    schemaVersion: 1,
    generatedAt,
    label,
    status: validationOk ? "completed" : "blocked",
    commandUploadEnabled: false,
    run,
    evidence,
    validation: {
      ok: validationOk,
      warnings,
      blockers
    },
    limitations: [
      validationOk
        ? "This artifact validates archived Isaac Sim to Jetson HIL capture evidence for the named bench run."
        : "This blocked artifact does not prove Isaac Sim HIL capture completion.",
      "It does not enable MAVLink, ROS 2, PX4, ArduPilot, or aircraft command upload.",
      "The deterministic isaac-sim-hil-lite fixture remains local import proof only; this artifact is for actual Jetson bench capture evidence."
    ]
  };
}

export async function writeIsaacHilCaptureEvidence(options: Parameters<typeof buildIsaacHilCaptureEvidence>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildIsaacHilCaptureEvidence(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const safeLabel = safeFileNamePart(manifest.label, "run");
  const baseName = `seekr-isaac-hil-capture-${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function validateTimestampOrder(run: IsaacHilCaptureEvidenceManifest["run"], blockers: string[]) {
  const started = Date.parse(run.captureStartedAt);
  const ended = Date.parse(run.captureEndedAt);
  if (run.captureStartedAt && !Number.isFinite(started)) blockers.push("captureStartedAt must be an ISO timestamp.");
  if (run.captureEndedAt && !Number.isFinite(ended)) blockers.push("captureEndedAt must be an ISO timestamp.");
  if (Number.isFinite(started) && Number.isFinite(ended) && ended < started) {
    blockers.push("captureEndedAt must be at or after captureStartedAt.");
  }
}

async function validateHardwareEvidence(root: string, evidencePath: string, targetHardware: string, blockers: string[], warnings: string[]) {
  if (!evidencePath) return;
  const absolutePath = resolveReferencedPath(root, evidencePath, "Isaac HIL hardware evidence path", blockers);
  if (!absolutePath) return;
  const manifest = await readJson(absolutePath);
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) {
    blockers.push("Isaac HIL hardware evidence must exist and keep commandUploadEnabled false.");
    return;
  }
  if (manifest.actualHardwareValidationComplete !== true) {
    blockers.push("Isaac HIL hardware evidence must be actual target-board validation, not off-board readiness.");
  }
  const targetValidated = isRecord(manifest.actualTargetHostValidated) ? manifest.actualTargetHostValidated : {};
  if (targetHardware && targetValidated[targetHardware] !== true) {
    blockers.push(`Isaac HIL hardware evidence does not validate requested target ${targetHardware}.`);
  }
  if (manifest.hardwareValidationScope && manifest.hardwareValidationScope !== "actual-target") {
    warnings.push(`Hardware validation scope is ${String(manifest.hardwareValidationScope)}; expected actual-target.`);
  }
}

async function validateRehearsalEvidence(root: string, evidencePath: string, blockers: string[]) {
  if (!evidencePath) return;
  const absolutePath = resolveReferencedPath(root, evidencePath, "Isaac HIL rehearsal evidence path", blockers);
  if (!absolutePath) return;
  const manifest = await readJson(absolutePath);
  const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
  const sourceEvidence = isRecord(manifest) && isRecord(manifest.sourceEvidence) ? manifest.sourceEvidence : {};
  const matched = Array.isArray(sourceEvidence.matched) ? sourceEvidence.matched.filter(isRecord) : [];
  const hasIsaacSource = matched.some((source) => {
    const adapter = String(source.sourceAdapter ?? "").toLowerCase();
    const channels = Array.isArray(source.channels) ? source.channels.map((channel) => String(channel).toLowerCase()) : [];
    const eventCount = Number(source.eventCount);
    return (
      Number.isFinite(eventCount) &&
      eventCount > 0 &&
      (adapter === "isaac-nvblox" || adapter === "isaac-sim-hil") &&
      channels.some((channel) => ["costmap", "perception", "spatial", "lidar", "map"].includes(channel))
    );
  });

  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false || validation.ok !== true) {
    blockers.push("Isaac HIL rehearsal evidence must have commandUploadEnabled false and validation.ok true.");
  }
  if (!hasIsaacSource) {
    blockers.push("Isaac HIL rehearsal evidence must include fresh Isaac source-health events.");
  }
}

async function validateCaptureManifest(root: string, evidencePath: string, blockers: string[]) {
  if (!evidencePath) return;
  const absolutePath = resolveReferencedPath(root, evidencePath, "Isaac capture manifest path", blockers);
  if (!absolutePath) return;
  const manifest = await readJson(absolutePath);
  if (!isRecord(manifest)) {
    blockers.push("Isaac capture manifest must be a JSON object.");
    return;
  }
  if (manifest.commandUploadEnabled === true) {
    blockers.push("Isaac capture manifest must not report commandUploadEnabled true.");
  }
  const sourceText = JSON.stringify([
    manifest.source,
    manifest.captureSource,
    manifest.pipeline,
    manifest.kind,
    manifest.adapter
  ]).toLowerCase();
  if (!sourceText.includes("isaac")) {
    blockers.push("Isaac capture manifest must identify an Isaac Sim/Isaac ROS source or pipeline.");
  }
  if (!hasPositiveCaptureCount(manifest)) {
    blockers.push("Isaac capture manifest must include a positive captured record/frame count.");
  }
}

async function validateReplayVerify(root: string, evidencePath: string, blockers: string[]) {
  const absolutePath = resolveReferencedPath(root, evidencePath, "Isaac replay verification path", blockers);
  if (!absolutePath) return;
  const manifest = await readJson(absolutePath);
  if (!isRecord(manifest) || manifest.ok !== true) {
    blockers.push("Isaac replay verification evidence must have ok true when provided.");
  }
}

async function validateNonEmptyFile(root: string, evidencePath: string, label: string, blockers: string[]) {
  if (!evidencePath) return;
  const absolutePath = resolveReferencedPath(root, evidencePath, `${label} path`, blockers);
  if (!absolutePath) return;
  try {
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size === 0) blockers.push(`${label} must be a non-empty file.`);
  } catch {
    blockers.push(`${label} path does not exist: ${evidencePath}.`);
  }
}

function resolveReferencedPath(root: string, evidencePath: string, fieldName: string, blockers: string[]) {
  try {
    return resolveProjectInputPath(root, evidencePath, fieldName);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : `${fieldName} is invalid.`);
    return undefined;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function hasPositiveCaptureCount(manifest: Record<string, unknown>) {
  const candidates = [
    manifest.recordCount,
    manifest.recordsCaptured,
    manifest.frameCount,
    manifest.framesCaptured,
    manifest.pointCloudCount
  ];
  const counts = isRecord(manifest.counts) ? manifest.counts : {};
  candidates.push(
    counts.telemetry,
    counts.mapDelta,
    counts.detection,
    counts.spatialAsset,
    counts.costmap,
    counts.pointCloud,
    counts.frames,
    counts.records
  );
  if (Array.isArray(manifest.records)) candidates.push(manifest.records.length);
  return candidates.some((value) => {
    const count = Number(value);
    return Number.isFinite(count) && count > 0;
  });
}

function renderMarkdown(manifest: IsaacHilCaptureEvidenceManifest) {
  return `${[
    "# SEEKR Isaac HIL Capture Evidence",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Label: ${manifest.label}`,
    `Status: ${manifest.status}`,
    "",
    "Command upload enabled: false",
    "",
    "Run:",
    "",
    `- Operator: ${manifest.run.operatorName}`,
    `- Target hardware: ${manifest.run.targetHardware}`,
    `- Isaac Sim host: ${manifest.run.isaacSimHost}`,
    `- Isaac Sim version: ${manifest.run.isaacSimVersion}`,
    `- Isaac ROS version: ${manifest.run.isaacRosVersion}`,
    `- Sensor suite: ${manifest.run.sensorSuite}`,
    `- Capture started: ${manifest.run.captureStartedAt}`,
    `- Capture ended: ${manifest.run.captureEndedAt}`,
    `- Capture result: ${manifest.run.captureResult}`,
    `- Deviations or failures: ${manifest.run.deviationsOrFailures}`,
    "",
    "Evidence links:",
    "",
    `- Hardware evidence: ${manifest.evidence.hardwareEvidencePath}`,
    `- Rehearsal evidence: ${manifest.evidence.rehearsalEvidencePath}`,
    `- Capture manifest: ${manifest.evidence.captureManifestPath}`,
    `- Capture log: ${manifest.evidence.captureLogPath}`,
    manifest.evidence.replayVerifyPath ? `- Replay verify: ${manifest.evidence.replayVerifyPath}` : undefined,
    "",
    "Limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    "",
    "Validation:",
    "",
    `- OK: ${manifest.validation.ok}`,
    ...(manifest.validation.blockers.length ? manifest.validation.blockers.map((item) => `- Blocker: ${item}`) : ["- Blockers: none"]),
    ...(manifest.validation.warnings.length ? manifest.validation.warnings.map((item) => `- Warning: ${item}`) : ["- Warnings: none"]),
    ""
  ].filter((line): line is string => typeof line === "string").join("\n")}\n`;
}

function parseBoolean(value: string | boolean | undefined) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (value.toLowerCase() === "false") return false;
  if (value.toLowerCase() === "true") return true;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
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
  const result = await writeIsaacHilCaptureEvidence({
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    operatorName: typeof args.operator === "string" ? args.operator : undefined,
    targetHardware: typeof args.target === "string" ? args.target : undefined,
    isaacSimHost: typeof args["isaac-sim-host"] === "string" ? args["isaac-sim-host"] : undefined,
    isaacSimVersion: typeof args["isaac-sim-version"] === "string" ? args["isaac-sim-version"] : undefined,
    isaacRosVersion: typeof args["isaac-ros-version"] === "string" ? args["isaac-ros-version"] : undefined,
    sensorSuite: typeof args["sensor-suite"] === "string" ? args["sensor-suite"] : undefined,
    captureStartedAt: typeof args["capture-started-at"] === "string" ? args["capture-started-at"] : undefined,
    captureEndedAt: typeof args["capture-ended-at"] === "string" ? args["capture-ended-at"] : undefined,
    captureResult: typeof args["capture-result"] === "string" ? args["capture-result"] : undefined,
    deviationsOrFailures: typeof args.deviations === "string" ? args.deviations : undefined,
    hardwareEvidencePath: typeof args["hardware-evidence"] === "string" ? args["hardware-evidence"] : undefined,
    rehearsalEvidencePath: typeof args["rehearsal-evidence"] === "string" ? args["rehearsal-evidence"] : undefined,
    captureManifestPath: typeof args["capture-manifest"] === "string" ? args["capture-manifest"] : undefined,
    captureLogPath: typeof args["capture-log"] === "string" ? args["capture-log"] : undefined,
    replayVerifyPath: typeof args["replay-verify"] === "string" ? args["replay-verify"] : undefined,
    commandUploadEnabledObserved: typeof args["command-upload-enabled"] === "string" || typeof args["command-upload-enabled"] === "boolean"
      ? args["command-upload-enabled"]
      : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    warnings: result.manifest.validation.warnings,
    blockers: result.manifest.validation.blockers,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
