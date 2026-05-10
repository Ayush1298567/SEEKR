import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, resolveProjectInputPath, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";

export interface HilFailsafeEvidenceManifest {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  status: "completed" | "blocked";
  commandUploadEnabled: false;
  run: {
    operatorName: string;
    targetHardware: string;
    vehicleIdentifier: string;
    autopilot: string;
    failsafeKind: string;
    failsafeTriggeredAt: string;
    manualOverrideObservedAt: string;
    estopVerifiedAt: string;
    aircraftSafeAt: string;
    manualOverrideResult: string;
    onboardFailsafeResult: string;
    deviationsOrFailures: string;
  };
  evidence: {
    hardwareEvidencePath: string;
    rehearsalEvidencePath: string;
    flightLogPath: string;
    operatorNotesPath?: string;
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/hil-evidence";

export async function buildHilFailsafeEvidence(options: {
  root?: string;
  generatedAt?: string;
  label?: string;
  operatorName?: string;
  targetHardware?: string;
  vehicleIdentifier?: string;
  autopilot?: string;
  failsafeKind?: string;
  failsafeTriggeredAt?: string;
  manualOverrideObservedAt?: string;
  estopVerifiedAt?: string;
  aircraftSafeAt?: string;
  manualOverrideResult?: string;
  onboardFailsafeResult?: string;
  deviationsOrFailures?: string;
  hardwareEvidencePath?: string;
  rehearsalEvidencePath?: string;
  flightLogPath?: string;
  operatorNotesPath?: string;
  commandUploadEnabledObserved?: string | boolean;
} = {}): Promise<HilFailsafeEvidenceManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label ?? "hil-failsafe";
  const warnings: string[] = [];
  const blockers: string[] = [];
  const run = {
    operatorName: stringValue(options.operatorName),
    targetHardware: stringValue(options.targetHardware),
    vehicleIdentifier: stringValue(options.vehicleIdentifier),
    autopilot: stringValue(options.autopilot),
    failsafeKind: stringValue(options.failsafeKind),
    failsafeTriggeredAt: stringValue(options.failsafeTriggeredAt),
    manualOverrideObservedAt: stringValue(options.manualOverrideObservedAt),
    estopVerifiedAt: stringValue(options.estopVerifiedAt),
    aircraftSafeAt: stringValue(options.aircraftSafeAt),
    manualOverrideResult: stringValue(options.manualOverrideResult),
    onboardFailsafeResult: stringValue(options.onboardFailsafeResult),
    deviationsOrFailures: stringValue(options.deviationsOrFailures)
  };
  const evidence = {
    hardwareEvidencePath: stringValue(options.hardwareEvidencePath),
    rehearsalEvidencePath: stringValue(options.rehearsalEvidencePath),
    flightLogPath: stringValue(options.flightLogPath),
    operatorNotesPath: options.operatorNotesPath
  };

  for (const [key, value] of Object.entries({ ...run, ...evidence })) {
    if (key === "operatorNotesPath") continue;
    if (!value || !String(value).trim()) blockers.push(`Missing required HIL failsafe field: ${key}.`);
  }

  const commandUploadEnabledObserved = parseBoolean(options.commandUploadEnabledObserved);
  if (commandUploadEnabledObserved !== false) {
    blockers.push("commandUploadEnabledObserved must be false for HIL failsafe evidence.");
  }

  validateTimestampOrder(run, blockers);
  await validateHardwareEvidence(root, evidence.hardwareEvidencePath, run.targetHardware, blockers, warnings);
  await validateRehearsalEvidence(root, evidence.rehearsalEvidencePath, blockers);
  await validateFlightLog(root, evidence.flightLogPath, blockers);
  if (evidence.operatorNotesPath) await validateOptionalPath(root, evidence.operatorNotesPath, "operator notes", blockers);

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
        ? "This artifact validates archived HIL failsafe/manual override evidence for the named bench run."
        : "This blocked artifact does not prove HIL failsafe/manual override completion.",
      "It does not enable MAVLink, ROS 2, PX4, ArduPilot, or aircraft command upload.",
      "Real aircraft command authority remains blocked unless a future reviewed hardware-actuation policy explicitly changes the gate."
    ]
  };
}

export async function writeHilFailsafeEvidence(options: Parameters<typeof buildHilFailsafeEvidence>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildHilFailsafeEvidence(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const safeLabel = safeFileNamePart(manifest.label, "run");
  const baseName = `seekr-hil-failsafe-${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function validateTimestampOrder(run: HilFailsafeEvidenceManifest["run"], blockers: string[]) {
  const timestampKeys: Array<keyof HilFailsafeEvidenceManifest["run"]> = [
    "failsafeTriggeredAt",
    "manualOverrideObservedAt",
    "estopVerifiedAt",
    "aircraftSafeAt"
  ];
  const timestamps = timestampKeys.map((key) => ({ key, value: Date.parse(run[key]) }));
  for (const timestamp of timestamps) {
    if (run[timestamp.key] && !Number.isFinite(timestamp.value)) blockers.push(`${timestamp.key} must be an ISO timestamp.`);
  }
  for (let index = 1; index < timestamps.length; index += 1) {
    const previous = timestamps[index - 1];
    const current = timestamps[index];
    if (Number.isFinite(previous.value) && Number.isFinite(current.value) && current.value < previous.value) {
      blockers.push(`${current.key} must be at or after ${previous.key}.`);
    }
  }
}

async function validateHardwareEvidence(root: string, evidencePath: string, targetHardware: string, blockers: string[], warnings: string[]) {
  if (!evidencePath) return;
  const absolutePath = resolveReferencedPath(root, evidencePath, "HIL hardware evidence path", blockers);
  if (!absolutePath) return;
  const manifest = await readJson(absolutePath);
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) {
    blockers.push("HIL hardware evidence must exist and keep commandUploadEnabled false.");
    return;
  }
  if (manifest.actualHardwareValidationComplete !== true) {
    blockers.push("HIL hardware evidence must be actual target-board validation, not off-board readiness.");
  }
  const targetValidated = isRecord(manifest.actualTargetHostValidated) ? manifest.actualTargetHostValidated : {};
  if (targetHardware && targetValidated[targetHardware] !== true) {
    blockers.push(`HIL hardware evidence does not validate requested target ${targetHardware}.`);
  }
  if (manifest.hardwareValidationScope && manifest.hardwareValidationScope !== "actual-target") {
    warnings.push(`Hardware validation scope is ${String(manifest.hardwareValidationScope)}; expected actual-target.`);
  }
}

async function validateRehearsalEvidence(root: string, evidencePath: string, blockers: string[]) {
  if (!evidencePath) return;
  const absolutePath = resolveReferencedPath(root, evidencePath, "HIL rehearsal evidence path", blockers);
  if (!absolutePath) return;
  const manifest = await readJson(absolutePath);
  const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false || validation.ok !== true) {
    blockers.push("HIL rehearsal evidence must have commandUploadEnabled false and validation.ok true.");
  }
}

async function validateFlightLog(root: string, evidencePath: string, blockers: string[]) {
  if (!evidencePath) return;
  const absolutePath = resolveReferencedPath(root, evidencePath, "HIL flight log path", blockers);
  if (!absolutePath) return;
  try {
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size === 0) blockers.push("HIL flight log must be a non-empty file.");
  } catch {
    blockers.push(`HIL flight log path does not exist: ${evidencePath}.`);
  }
}

async function validateOptionalPath(root: string, evidencePath: string, label: string, blockers: string[]) {
  const absolutePath = resolveReferencedPath(root, evidencePath, `HIL ${label} path`, blockers);
  if (!absolutePath) return;
  try {
    await stat(absolutePath);
  } catch {
    blockers.push(`HIL ${label} path does not exist: ${evidencePath}.`);
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

function renderMarkdown(manifest: HilFailsafeEvidenceManifest) {
  return `${[
    "# SEEKR HIL Failsafe Evidence",
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
    `- Vehicle: ${manifest.run.vehicleIdentifier}`,
    `- Autopilot: ${manifest.run.autopilot}`,
    `- Failsafe kind: ${manifest.run.failsafeKind}`,
    `- Failsafe triggered: ${manifest.run.failsafeTriggeredAt}`,
    `- Manual override observed: ${manifest.run.manualOverrideObservedAt}`,
    `- E-stop verified: ${manifest.run.estopVerifiedAt}`,
    `- Aircraft safe: ${manifest.run.aircraftSafeAt}`,
    `- Manual override result: ${manifest.run.manualOverrideResult}`,
    `- Onboard failsafe result: ${manifest.run.onboardFailsafeResult}`,
    `- Deviations or failures: ${manifest.run.deviationsOrFailures}`,
    "",
    "Evidence links:",
    "",
    `- Hardware evidence: ${manifest.evidence.hardwareEvidencePath}`,
    `- Rehearsal evidence: ${manifest.evidence.rehearsalEvidencePath}`,
    `- Flight log: ${manifest.evidence.flightLogPath}`,
    manifest.evidence.operatorNotesPath ? `- Operator notes: ${manifest.evidence.operatorNotesPath}` : undefined,
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
  const result = await writeHilFailsafeEvidence({
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    operatorName: typeof args.operator === "string" ? args.operator : undefined,
    targetHardware: typeof args.target === "string" ? args.target : undefined,
    vehicleIdentifier: typeof args.vehicle === "string" ? args.vehicle : undefined,
    autopilot: typeof args.autopilot === "string" ? args.autopilot : undefined,
    failsafeKind: typeof args.failsafe === "string" ? args.failsafe : undefined,
    failsafeTriggeredAt: typeof args["failsafe-triggered-at"] === "string" ? args["failsafe-triggered-at"] : undefined,
    manualOverrideObservedAt: typeof args["manual-override-observed-at"] === "string" ? args["manual-override-observed-at"] : undefined,
    estopVerifiedAt: typeof args["estop-verified-at"] === "string" ? args["estop-verified-at"] : undefined,
    aircraftSafeAt: typeof args["aircraft-safe-at"] === "string" ? args["aircraft-safe-at"] : undefined,
    manualOverrideResult: typeof args["manual-override-result"] === "string" ? args["manual-override-result"] : undefined,
    onboardFailsafeResult: typeof args["onboard-failsafe-result"] === "string" ? args["onboard-failsafe-result"] : undefined,
    deviationsOrFailures: typeof args.deviations === "string" ? args.deviations : undefined,
    hardwareEvidencePath: typeof args["hardware-evidence"] === "string" ? args["hardware-evidence"] : undefined,
    rehearsalEvidencePath: typeof args["rehearsal-evidence"] === "string" ? args["rehearsal-evidence"] : undefined,
    flightLogPath: typeof args["flight-log"] === "string" ? args["flight-log"] : undefined,
    operatorNotesPath: typeof args["operator-notes"] === "string" ? args["operator-notes"] : undefined,
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
