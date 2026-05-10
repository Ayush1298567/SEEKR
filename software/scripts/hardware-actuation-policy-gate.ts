import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, resolveProjectInputPath, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";

export interface HardwareActuationPolicyGateManifest {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  status: "ready-for-human-review" | "blocked";
  commandUploadEnabled: false;
  scope: {
    operatorName: string;
    targetHardware: string;
    vehicleIdentifier: string;
    reviewers: string[];
    reviewedAt: string;
  };
  authorization: {
    realAircraftCommandUpload: false;
    hardwareActuationEnabled: false;
    runtimePolicyInstalled: false;
  };
  evidence: {
    candidatePolicyPath: string;
    acceptanceStatusPath: string;
    hardwareEvidencePath: string;
    hilEvidencePath: string;
    reviewPacketPath?: string;
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/policy-evidence";
const DEFAULT_ACCEPTANCE_PATH = ".tmp/acceptance-status.json";
const POLICY_ARRAY_FIELDS = [
  "approvedCommandClasses",
  "authorizedCommandClasses",
  "allowedHardwareCommands",
  "enabledHardwareCommands",
  "missionUploadCommandClasses"
];

export async function buildHardwareActuationPolicyGate(options: {
  root?: string;
  generatedAt?: string;
  label?: string;
  operatorName?: string;
  targetHardware?: string;
  vehicleIdentifier?: string;
  reviewers?: string[] | string;
  reviewedAt?: string;
  candidatePolicyPath?: string;
  acceptanceStatusPath?: string;
  hardwareEvidencePath?: string;
  hilEvidencePath?: string;
  reviewPacketPath?: string;
  commandUploadEnabledObserved?: string | boolean;
} = {}): Promise<HardwareActuationPolicyGateManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label ?? "hardware-actuation-policy-gate";
  const warnings: string[] = [];
  const blockers: string[] = [];
  const candidatePolicyPath = stringValue(options.candidatePolicyPath);
  const acceptanceStatusPath = stringValue(options.acceptanceStatusPath) || DEFAULT_ACCEPTANCE_PATH;
  const hardwareEvidencePath = stringValue(options.hardwareEvidencePath);
  const hilEvidencePath = stringValue(options.hilEvidencePath);
  const candidatePolicy = candidatePolicyPath ? await readReferencedJson(root, candidatePolicyPath, "Candidate policy path", blockers) : undefined;
  const policyRecord = isRecord(candidatePolicy) ? candidatePolicy : undefined;
  const scope = {
    operatorName: stringValue(options.operatorName),
    targetHardware: stringValue(options.targetHardware || policyString(policyRecord, "targetHardware")),
    vehicleIdentifier: stringValue(options.vehicleIdentifier || policyString(policyRecord, "vehicleIdentifier")),
    reviewers: reviewersFrom(options.reviewers, policyRecord),
    reviewedAt: stringValue(options.reviewedAt || policyString(policyRecord, "reviewedAt"))
  };

  if (!scope.operatorName) blockers.push("Missing required policy gate field: operatorName.");
  if (!scope.targetHardware) blockers.push("Missing required policy gate field: targetHardware.");
  if (!scope.vehicleIdentifier) blockers.push("Missing required policy gate field: vehicleIdentifier.");
  if (scope.reviewers.length < 2) blockers.push("At least two reviewers are required for hardware-actuation policy review.");
  if (!scope.reviewedAt) blockers.push("Missing required policy gate field: reviewedAt.");
  else if (!Number.isFinite(Date.parse(scope.reviewedAt))) blockers.push("reviewedAt must be an ISO timestamp.");

  const commandUploadEnabledObserved = parseBoolean(options.commandUploadEnabledObserved);
  if (commandUploadEnabledObserved !== false) {
    blockers.push("commandUploadEnabledObserved must be false for hardware-actuation policy review evidence.");
  }

  validateCandidatePolicy(policyRecord, candidatePolicyPath, scope, blockers, warnings);
  await validateAcceptanceStatus(root, acceptanceStatusPath, blockers);
  await validateHardwareEvidence(root, hardwareEvidencePath, scope.targetHardware, blockers, warnings);
  await validateHilEvidence(root, hilEvidencePath, scope, blockers);
  if (options.reviewPacketPath) await validateReviewPacket(root, options.reviewPacketPath, blockers);

  const validationOk = blockers.length === 0;
  return {
    schemaVersion: 1,
    generatedAt,
    label,
    status: validationOk ? "ready-for-human-review" : "blocked",
    commandUploadEnabled: false,
    scope,
    authorization: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    evidence: {
      candidatePolicyPath,
      acceptanceStatusPath,
      hardwareEvidencePath,
      hilEvidencePath,
      reviewPacketPath: options.reviewPacketPath
    },
    validation: {
      ok: validationOk,
      warnings,
      blockers
    },
    limitations: [
      validationOk
        ? "This artifact says the supplied evidence package is ready for human review."
        : "This blocked artifact does not satisfy the hardware-actuation review gate.",
      "It does not authorize or enable real aircraft command upload.",
      "Runtime MAVLink, ROS 2, PX4, ArduPilot, mission, geofence, mode, arm, takeoff, land, RTH, terminate, and waypoint command paths remain blocked outside simulator/SITL transports.",
      "A future reviewed policy must still be installed by a separate code change before any runtime behavior can change."
    ]
  };
}

export async function writeHardwareActuationPolicyGate(options: Parameters<typeof buildHardwareActuationPolicyGate>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildHardwareActuationPolicyGate(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const safeLabel = safeFileNamePart(manifest.label, "policy-gate");
  const baseName = `seekr-hardware-actuation-gate-${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function validateCandidatePolicy(
  policy: Record<string, unknown> | undefined,
  policyPath: string,
  scope: HardwareActuationPolicyGateManifest["scope"],
  blockers: string[],
  warnings: string[]
) {
  if (!policyPath) {
    blockers.push("Missing candidate hardware-actuation review policy path.");
    return;
  }
  if (!policy) {
    blockers.push("Candidate hardware-actuation review policy must be valid JSON.");
    return;
  }

  const policyKind = policyString(policy, "policyKind");
  if (policyKind && policyKind !== "seekr-hardware-actuation-review") {
    warnings.push(`Candidate policyKind is ${policyKind}; expected seekr-hardware-actuation-review.`);
  }
  if (policy.commandUploadEnabled !== false) {
    blockers.push("Candidate policy must keep commandUploadEnabled false.");
  }
  if (policy.realAircraftCommandUploadAuthorized === true) {
    blockers.push("Candidate policy must not authorize real aircraft command upload.");
  }
  if (policy.hardwareActuationEnabled === true) {
    blockers.push("Candidate policy must not enable hardware actuation.");
  }
  if (policy.runtimeInstallApproved === true) {
    blockers.push("Candidate policy must not approve runtime installation.");
  }
  if (policy.manualOverrideRequired !== true) {
    blockers.push("Candidate policy must require manual override.");
  }
  if (policy.estopRequired !== true) {
    blockers.push("Candidate policy must require physical E-stop verification.");
  }

  for (const field of POLICY_ARRAY_FIELDS) {
    const value = policy[field];
    if (Array.isArray(value) && value.length > 0) {
      blockers.push(`Candidate policy field ${field} must be empty until runtime actuation is explicitly approved in a future change.`);
    }
  }

  const targetHardware = policyString(policy, "targetHardware");
  if (targetHardware && scope.targetHardware && targetHardware !== scope.targetHardware) {
    blockers.push(`Candidate policy targetHardware ${targetHardware} does not match requested target ${scope.targetHardware}.`);
  }
  const vehicleIdentifier = policyString(policy, "vehicleIdentifier");
  if (vehicleIdentifier && scope.vehicleIdentifier && vehicleIdentifier !== scope.vehicleIdentifier) {
    blockers.push(`Candidate policy vehicleIdentifier ${vehicleIdentifier} does not match requested vehicle ${scope.vehicleIdentifier}.`);
  }
}

async function validateAcceptanceStatus(root: string, evidencePath: string, blockers: string[]) {
  const manifest = await readReferencedJson(root, evidencePath, "Acceptance status path", blockers);
  if (!isRecord(manifest) || manifest.ok !== true || manifest.commandUploadEnabled !== false) {
    blockers.push("Acceptance status must be ok and keep commandUploadEnabled false.");
  }
}

async function validateHardwareEvidence(root: string, evidencePath: string, targetHardware: string, blockers: string[], warnings: string[]) {
  if (!evidencePath) {
    blockers.push("Missing actual target-board hardware evidence path.");
    return;
  }
  const manifest = await readReferencedJson(root, evidencePath, "Hardware evidence path", blockers);
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) {
    blockers.push("Hardware evidence must exist and keep commandUploadEnabled false.");
    return;
  }
  if (manifest.actualHardwareValidationComplete !== true) {
    blockers.push("Hardware evidence must be actual target-board validation, not off-board readiness.");
  }
  const targetValidated = isRecord(manifest.actualTargetHostValidated) ? manifest.actualTargetHostValidated : {};
  if (targetHardware && targetValidated[targetHardware] !== true) {
    blockers.push(`Hardware evidence does not validate requested target ${targetHardware}.`);
  }
  if (manifest.hardwareValidationScope && manifest.hardwareValidationScope !== "actual-target") {
    warnings.push(`Hardware validation scope is ${String(manifest.hardwareValidationScope)}; expected actual-target.`);
  }
}

async function validateHilEvidence(
  root: string,
  evidencePath: string,
  scope: HardwareActuationPolicyGateManifest["scope"],
  blockers: string[]
) {
  if (!evidencePath) {
    blockers.push("Missing HIL failsafe/manual override evidence path.");
    return;
  }
  const manifest = await readReferencedJson(root, evidencePath, "HIL evidence path", blockers);
  const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
  const run = isRecord(manifest) && isRecord(manifest.run) ? manifest.run : {};
  if (
    !isRecord(manifest) ||
    manifest.status !== "completed" ||
    manifest.commandUploadEnabled !== false ||
    validation.ok !== true
  ) {
    blockers.push("HIL evidence must be completed, valid, and keep commandUploadEnabled false.");
    return;
  }
  if (scope.targetHardware && run.targetHardware !== scope.targetHardware) {
    blockers.push(`HIL evidence targetHardware ${String(run.targetHardware ?? "")} does not match requested target ${scope.targetHardware}.`);
  }
  if (scope.vehicleIdentifier && run.vehicleIdentifier !== scope.vehicleIdentifier) {
    blockers.push(`HIL evidence vehicleIdentifier ${String(run.vehicleIdentifier ?? "")} does not match requested vehicle ${scope.vehicleIdentifier}.`);
  }
  for (const key of ["manualOverrideObservedAt", "estopVerifiedAt", "aircraftSafeAt"]) {
    if (typeof run[key] !== "string" || !run[key].trim()) blockers.push(`HIL evidence is missing ${key}.`);
  }
}

async function validateReviewPacket(root: string, evidencePath: string, blockers: string[]) {
  const absolutePath = resolveReferencedPath(root, evidencePath, "Review packet path", blockers);
  if (!absolutePath) return;
  try {
    await readFile(absolutePath, "utf8");
  } catch {
    blockers.push(`Review packet path does not exist: ${evidencePath}.`);
  }
}

async function readReferencedJson(root: string, evidencePath: string, fieldName: string, blockers: string[]) {
  const absolutePath = resolveReferencedPath(root, evidencePath, fieldName, blockers);
  return absolutePath ? await readJson(absolutePath) : undefined;
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

function renderMarkdown(manifest: HardwareActuationPolicyGateManifest) {
  return `${[
    "# SEEKR Hardware-Actuation Policy Gate",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Label: ${manifest.label}`,
    `Status: ${manifest.status}`,
    "",
    "Authorization:",
    "",
    `- Command upload enabled: ${manifest.commandUploadEnabled}`,
    `- Real aircraft command upload authorized: ${manifest.authorization.realAircraftCommandUpload}`,
    `- Hardware actuation enabled: ${manifest.authorization.hardwareActuationEnabled}`,
    `- Runtime policy installed: ${manifest.authorization.runtimePolicyInstalled}`,
    "",
    "Scope:",
    "",
    `- Operator: ${manifest.scope.operatorName}`,
    `- Target hardware: ${manifest.scope.targetHardware}`,
    `- Vehicle: ${manifest.scope.vehicleIdentifier}`,
    `- Reviewers: ${manifest.scope.reviewers.join(", ") || "none"}`,
    `- Reviewed at: ${manifest.scope.reviewedAt}`,
    "",
    "Evidence links:",
    "",
    `- Candidate policy: ${manifest.evidence.candidatePolicyPath}`,
    `- Acceptance status: ${manifest.evidence.acceptanceStatusPath}`,
    `- Hardware evidence: ${manifest.evidence.hardwareEvidencePath}`,
    `- HIL evidence: ${manifest.evidence.hilEvidencePath}`,
    manifest.evidence.reviewPacketPath ? `- Review packet: ${manifest.evidence.reviewPacketPath}` : undefined,
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

function reviewersFrom(value: string[] | string | undefined, policy: Record<string, unknown> | undefined) {
  const explicit = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const fromPolicy = policy && Array.isArray(policy.reviewers)
    ? policy.reviewers
    : policy && Array.isArray(policy.reviewedBy)
      ? policy.reviewedBy
      : [];
  return [...explicit, ...fromPolicy]
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
}

function parseBoolean(value: string | boolean | undefined) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (value.toLowerCase() === "false") return false;
  if (value.toLowerCase() === "true") return true;
  return undefined;
}

function policyString(policy: Record<string, unknown> | undefined, key: string) {
  const value = policy?.[key];
  return typeof value === "string" ? value : undefined;
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
  const result = await writeHardwareActuationPolicyGate({
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    operatorName: typeof args.operator === "string" ? args.operator : undefined,
    targetHardware: typeof args.target === "string" ? args.target : undefined,
    vehicleIdentifier: typeof args.vehicle === "string" ? args.vehicle : undefined,
    reviewers: typeof args.reviewers === "string" ? args.reviewers : undefined,
    reviewedAt: typeof args["reviewed-at"] === "string" ? args["reviewed-at"] : undefined,
    candidatePolicyPath: typeof args.policy === "string" ? args.policy : undefined,
    acceptanceStatusPath: typeof args.acceptance === "string" ? args.acceptance : undefined,
    hardwareEvidencePath: typeof args["hardware-evidence"] === "string" ? args["hardware-evidence"] : undefined,
    hilEvidencePath: typeof args["hil-evidence"] === "string" ? args["hil-evidence"] : undefined,
    reviewPacketPath: typeof args["review-packet"] === "string" ? args["review-packet"] : undefined,
    commandUploadEnabledObserved: typeof args["command-upload-enabled"] === "string" || typeof args["command-upload-enabled"] === "boolean"
      ? args["command-upload-enabled"]
      : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    authorization: result.manifest.authorization,
    warnings: result.manifest.validation.warnings,
    blockers: result.manifest.validation.blockers,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
