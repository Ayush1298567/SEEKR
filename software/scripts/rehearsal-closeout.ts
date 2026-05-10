import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";

export interface RehearsalCloseoutManifest {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  status: "completed" | "blocked";
  freshOperatorCompleted: boolean;
  commandUploadEnabled: false;
  operatorFields: {
    operatorName: string;
    machineIdentifier: string;
    setupStartedAt: string;
    acceptanceCompletedAt: string;
    missionExportCompletedAt: string;
    replayId: string;
    finalStateHash: string;
    shutdownCompletedAt: string;
    deviationsOrFailures: string;
  };
  evidence: {
    templateNotePath?: string;
    acceptanceStatusPath: string;
    beforeRunRehearsalEvidencePath: string;
    afterRunRehearsalEvidencePath: string;
    releaseChecksumPath?: string;
    completionAuditPath?: string;
    hardwareEvidencePath?: string;
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/rehearsal-notes";

export async function buildRehearsalCloseout(options: {
  root?: string;
  generatedAt?: string;
  label?: string;
  templateNotePath?: string;
  operatorName?: string;
  machineIdentifier?: string;
  setupStartedAt?: string;
  acceptanceCompletedAt?: string;
  beforeRunRehearsalEvidencePath?: string;
  missionExportCompletedAt?: string;
  replayId?: string;
  finalStateHash?: string;
  afterRunRehearsalEvidencePath?: string;
  shutdownCompletedAt?: string;
  deviationsOrFailures?: string;
}): Promise<RehearsalCloseoutManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label ?? "field-laptop-rehearsal";
  const acceptanceStatusPath = ".tmp/acceptance-status.json";
  const release = await latestJson(root, ".tmp/release-evidence", (name) => name.startsWith("seekr-release-"));
  const completionAudit = await latestJson(root, ".tmp/completion-audit", (name) => name.startsWith("seekr-completion-audit-"));
  const hardwareEvidence = await latestJson(root, ".tmp/hardware-evidence", (name) => name.startsWith("seekr-hardware-evidence-"));
  const warnings: string[] = [];
  const blockers: string[] = [];

  const required = {
    operatorName: options.operatorName,
    machineIdentifier: options.machineIdentifier,
    setupStartedAt: options.setupStartedAt,
    acceptanceCompletedAt: options.acceptanceCompletedAt,
    beforeRunRehearsalEvidencePath: options.beforeRunRehearsalEvidencePath,
    missionExportCompletedAt: options.missionExportCompletedAt,
    replayId: options.replayId,
    finalStateHash: options.finalStateHash,
    afterRunRehearsalEvidencePath: options.afterRunRehearsalEvidencePath,
    shutdownCompletedAt: options.shutdownCompletedAt,
    deviationsOrFailures: options.deviationsOrFailures
  };

  for (const [key, value] of Object.entries(required)) {
    if (!value || !String(value).trim()) blockers.push(`Missing required closeout field: ${key}.`);
  }

  if (required.finalStateHash && !/^[a-f0-9]{64}$/i.test(required.finalStateHash)) {
    blockers.push("finalStateHash must be a 64-character SHA-256 style hex string.");
  }

  const acceptance = await readJson(path.join(root, acceptanceStatusPath));
  if (!isRecord(acceptance) || acceptance.ok !== true || acceptance.commandUploadEnabled !== false) {
    blockers.push("Acceptance status is missing, failing, or does not prove commandUploadEnabled false.");
  }

  await validateRehearsalEvidence(root, required.beforeRunRehearsalEvidencePath, "before-run", blockers);
  await validateRehearsalEvidence(root, required.afterRunRehearsalEvidencePath, "after-run", blockers);

  if (options.templateNotePath && !(await pathExists(path.join(root, options.templateNotePath)))) {
    blockers.push(`Template note path does not exist: ${options.templateNotePath}.`);
  }
  if (!release) warnings.push("No release checksum evidence was found under .tmp/release-evidence.");
  if (!completionAudit) warnings.push("No completion audit evidence was found under .tmp/completion-audit.");
  if (!hardwareEvidence) warnings.push("No hardware readiness archive was found under .tmp/hardware-evidence.");
  const hardwareManifest = hardwareEvidence ? await readJson(hardwareEvidence.absolutePath) : undefined;
  if (isRecord(hardwareManifest) && hardwareManifest.actualHardwareValidationComplete !== true) {
    warnings.push("Latest hardware archive is not actual Jetson/Pi validation; keep the closeout scoped to local field-laptop rehearsal only.");
  }

  const validationOk = blockers.length === 0;

  return {
    schemaVersion: 1,
    generatedAt,
    label,
    status: validationOk ? "completed" : "blocked",
    freshOperatorCompleted: validationOk,
    commandUploadEnabled: false,
    operatorFields: {
      operatorName: required.operatorName ?? "",
      machineIdentifier: required.machineIdentifier ?? "",
      setupStartedAt: required.setupStartedAt ?? "",
      acceptanceCompletedAt: required.acceptanceCompletedAt ?? "",
      missionExportCompletedAt: required.missionExportCompletedAt ?? "",
      replayId: required.replayId ?? "",
      finalStateHash: required.finalStateHash ?? "",
      shutdownCompletedAt: required.shutdownCompletedAt ?? "",
      deviationsOrFailures: required.deviationsOrFailures ?? ""
    },
    evidence: {
      templateNotePath: options.templateNotePath,
      acceptanceStatusPath,
      beforeRunRehearsalEvidencePath: required.beforeRunRehearsalEvidencePath ?? "",
      afterRunRehearsalEvidencePath: required.afterRunRehearsalEvidencePath ?? "",
      releaseChecksumPath: release?.relativePath,
      completionAuditPath: completionAudit?.relativePath,
      hardwareEvidencePath: hardwareEvidence?.relativePath
    },
    validation: {
      ok: validationOk,
      warnings,
      blockers
    },
    limitations: [
      validationOk
        ? "This completed closeout proves a filled local field-laptop rehearsal note only."
        : "This blocked closeout attempt does not prove a completed fresh-operator rehearsal.",
      "It does not prove actual Jetson/Pi hardware validation unless the linked hardware archive says actualHardwareValidationComplete true.",
      "It does not enable real MAVLink, ROS 2, PX4, ArduPilot, or aircraft command upload."
    ]
  };
}

export async function writeRehearsalCloseout(options: Parameters<typeof buildRehearsalCloseout>[0] & {
  outDir?: string;
}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildRehearsalCloseout(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const safeLabel = safeFileNamePart(manifest.label, "run");
  const baseName = `seekr-rehearsal-closeout-${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");
  return { manifest, jsonPath, markdownPath };
}

async function validateRehearsalEvidence(root: string, evidencePath: string | undefined, label: string, blockers: string[]) {
  if (!evidencePath) return;
  const absolutePath = path.join(root, evidencePath);
  if (!(await pathExists(absolutePath))) {
    blockers.push(`${label} rehearsal evidence path does not exist: ${evidencePath}.`);
    return;
  }
  const evidence = await readJson(absolutePath);
  const validation = isRecord(evidence) && isRecord(evidence.validation) ? evidence.validation : {};
  if (!isRecord(evidence) || evidence.commandUploadEnabled !== false || validation.ok !== true) {
    blockers.push(`${label} rehearsal evidence must have commandUploadEnabled false and validation.ok true.`);
  }
}

async function latestJson(root: string, directory: string, predicate: (name: string) => boolean) {
  const absoluteDir = path.join(root, directory);
  try {
    const entries = (await readdir(absoluteDir)).filter((name) => name.endsWith(".json") && predicate(name)).sort();
    const latest = entries.at(-1);
    return latest
      ? {
          absolutePath: path.join(absoluteDir, latest),
          relativePath: path.posix.join(directory.split(path.sep).join("/"), latest)
        }
      : undefined;
  } catch {
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

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderMarkdown(manifest: RehearsalCloseoutManifest) {
  return `${[
    "# SEEKR Field-Laptop Rehearsal Closeout",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Label: ${manifest.label}`,
    `Status: ${manifest.status}`,
    `Fresh operator completed: ${manifest.freshOperatorCompleted}`,
    "",
    "Command upload enabled: false",
    "",
    "Operator fields:",
    "",
    `- Operator: ${manifest.operatorFields.operatorName}`,
    `- Machine: ${manifest.operatorFields.machineIdentifier}`,
    `- Setup started: ${manifest.operatorFields.setupStartedAt}`,
    `- Acceptance completed: ${manifest.operatorFields.acceptanceCompletedAt}`,
    `- Mission export completed: ${manifest.operatorFields.missionExportCompletedAt}`,
    `- Replay id: ${manifest.operatorFields.replayId}`,
    `- Final state hash: ${manifest.operatorFields.finalStateHash}`,
    `- Shutdown completed: ${manifest.operatorFields.shutdownCompletedAt}`,
    `- Deviations or failures: ${manifest.operatorFields.deviationsOrFailures}`,
    "",
    "Evidence links:",
    "",
    `- Acceptance status: ${manifest.evidence.acceptanceStatusPath}`,
    `- Before-run rehearsal evidence: ${manifest.evidence.beforeRunRehearsalEvidencePath}`,
    `- After-run rehearsal evidence: ${manifest.evidence.afterRunRehearsalEvidencePath}`,
    `- Release checksum: ${manifest.evidence.releaseChecksumPath ?? "missing"}`,
    `- Completion audit: ${manifest.evidence.completionAuditPath ?? "missing"}`,
    `- Hardware evidence: ${manifest.evidence.hardwareEvidencePath ?? "missing"}`,
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
  const result = await writeRehearsalCloseout({
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    templateNotePath: typeof args.note === "string" ? args.note : undefined,
    operatorName: typeof args.operator === "string" ? args.operator : undefined,
    machineIdentifier: typeof args.machine === "string" ? args.machine : undefined,
    setupStartedAt: typeof args["setup-started-at"] === "string" ? args["setup-started-at"] : undefined,
    acceptanceCompletedAt: typeof args["acceptance-completed-at"] === "string" ? args["acceptance-completed-at"] : undefined,
    beforeRunRehearsalEvidencePath: typeof args.before === "string" ? args.before : undefined,
    missionExportCompletedAt: typeof args["mission-exported-at"] === "string" ? args["mission-exported-at"] : undefined,
    replayId: typeof args["replay-id"] === "string" ? args["replay-id"] : undefined,
    finalStateHash: typeof args["final-hash"] === "string" ? args["final-hash"] : undefined,
    afterRunRehearsalEvidencePath: typeof args.after === "string" ? args.after : undefined,
    shutdownCompletedAt: typeof args["shutdown-completed-at"] === "string" ? args["shutdown-completed-at"] : undefined,
    deviationsOrFailures: typeof args.deviations === "string" ? args.deviations : undefined
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
