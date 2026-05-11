import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { OPERATOR_QUICKSTART_PATH, operatorQuickstartProblems } from "./operator-quickstart-contract";
import {
  REQUIRED_DOCTOR_CHECK_IDS,
  REQUIRED_RUNTIME_DEPENDENCY_EVIDENCE,
  SOFT_DOCTOR_CHECK_IDS,
  doctorCheckStatusOk,
  doctorRuntimeDependencyEvidenceOk,
  doctorSourceControlEvidenceOk,
  plugAndPlayDoctorOk,
  plugAndPlaySetupOk
} from "./plug-and-play-artifact-contract";
import { localAiPrepareManifestOk } from "./local-ai-prepare";
import { validateRehearsalStartSmokeManifest } from "./rehearsal-start-smoke";
import { validateSourceControlHandoffManifest } from "./source-control-handoff";
import { REQUIRED_STRICT_AI_SMOKE_CASES, isLocalOllamaUrl } from "../src/server/ai/localAiEvidence";

type PlugAndPlayCheckStatus = "pass" | "warn" | "fail" | "blocked";

export interface PlugAndPlayCheck {
  id: string;
  requirement: string;
  status: PlugAndPlayCheckStatus;
  details: string;
  evidence: string[];
}

export interface PlugAndPlayReadinessManifest {
  schemaVersion: 1;
  generatedAt: string;
  status: "ready-local-plug-and-play-real-world-blocked" | "blocked-local-plug-and-play" | "complete";
  localPlugAndPlayOk: boolean;
  complete: boolean;
  commandUploadEnabled: false;
  ai: {
    implemented: boolean;
    provider?: string;
    model?: string;
    ollamaUrl?: string;
    caseCount?: number;
    caseNames?: string[];
  };
  sourceControl: {
    path?: string;
    generatedAt?: string;
    status?: string;
    ready?: boolean;
    localHeadSha?: string;
    remoteDefaultBranchSha?: string;
    workingTreeClean?: boolean;
    workingTreeStatusLineCount?: number;
  };
  reviewBundle: {
    path?: string;
    verificationPath?: string;
    status?: string;
    checkedFileCount?: number;
    secretScanStatus?: string;
    sourceControlHandoffPath?: string;
    sourceControlHandoffLocalHeadSha?: string;
    sourceControlHandoffRemoteDefaultBranchSha?: string;
    sourceControlHandoffWorkingTreeClean?: boolean;
    sourceControlHandoffWorkingTreeStatusLineCount?: number;
  };
  summary: {
    pass: number;
    warn: number;
    fail: number;
    blocked: number;
  };
  checks: PlugAndPlayCheck[];
  remainingRealWorldBlockers: string[];
  remainingRealWorldBlockerCount: number;
  safetyBoundary: {
    realAircraftCommandUpload: false;
    hardwareActuationEnabled: false;
    runtimePolicyInstalled: false;
  };
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/plug-and-play-readiness";
const STRICT_AI_SMOKE_STATUS_PATH = ".tmp/ai-smoke-status.json";

const REQUIRED_COMMANDS = [
  "setup:local",
  "ai:prepare",
  "doctor",
  "dev",
  "rehearsal:start",
  "server",
  "client",
  "build",
  "preview",
  "check",
  "acceptance",
  "test:ai:local",
  "smoke:rehearsal:start",
  "qa:gstack",
  "audit:completion",
  "demo:package",
  "bench:evidence:packet",
  "handoff:index",
  "handoff:verify",
  "audit:gstack",
  "audit:source-control",
  "audit:todo",
  "audit:plug-and-play",
  "handoff:bundle",
  "handoff:bundle:verify",
  "audit:goal"
];

const REQUIRED_ENV_EXAMPLE_SIGNALS = [
  "PORT=8787",
  "SEEKR_API_PORT=8787",
  "SEEKR_CLIENT_PORT=5173",
  "SEEKR_DATA_DIR=data",
  "SEEKR_ENV_FILE=.env",
  "SEEKR_LOAD_DOTENV=false",
  "SEEKR_AI_PROVIDER=ollama",
  "SEEKR_OLLAMA_URL=http://127.0.0.1:11434",
  "SEEKR_OLLAMA_MODEL=llama3.2:latest",
  "SEEKR_OLLAMA_TIMEOUT_MS=20000"
];

const REQUIRED_GSTACK_WORKFLOW_IDS = ["health", "review", "planning", "qa"];
const REQUIRED_GSTACK_PERSPECTIVE_IDS = ["operator", "safety", "dx", "replay", "demo-readiness"];

export async function buildPlugAndPlayReadiness(options: {
  root?: string;
  generatedAt?: string;
} = {}): Promise<PlugAndPlayReadinessManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checks = [
    await commandSurfaceCheck(root),
    await operatorSetupCheck(root),
    await localAiPrepareCheck(root),
    await operatorDoctorCheck(root),
    await sourceControlHandoffCheck(root),
    await operatorStartCheck(root),
    await operatorStartSmokeCheck(root),
    await operatorQuickstartDocCheck(root),
    await envExampleCheck(root),
    await envLoaderCheck(root),
    await buildOutputCheck(root),
    await acceptanceAndAiCheck(root),
    await apiProbeCheck(root),
    await workflowQaCheck(root),
    await reviewBundleCheck(root),
    await completionBoundaryCheck(root)
  ];
  const summary = {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    blocked: checks.filter((check) => check.status === "blocked").length
  };
  const completion = await latestJson(root, ".tmp/completion-audit", (name) => name.startsWith("seekr-completion-audit-"));
  const completionManifest = completion ? await readJson(completion.absolutePath) : undefined;
  const remainingRealWorldBlockers = isRecord(completionManifest) && Array.isArray(completionManifest.realWorldBlockers)
    ? completionManifest.realWorldBlockers.map(String)
    : [];
  const localPlugAndPlayOk = summary.fail === 0;
  const completionAuditComplete = isRecord(completionManifest) && completionManifest.complete === true;
  const complete = localPlugAndPlayOk && completionAuditComplete && remainingRealWorldBlockers.length === 0;
  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const strictLocalAi = isRecord(acceptance) && isRecord(acceptance.strictLocalAi) ? acceptance.strictLocalAi : undefined;
  const sourceControl = await sourceControlSummary(root);
  const reviewBundle = await reviewBundleSummary(root);

  return {
    schemaVersion: 1,
    generatedAt,
    status: complete ? "complete" : localPlugAndPlayOk ? "ready-local-plug-and-play-real-world-blocked" : "blocked-local-plug-and-play",
    localPlugAndPlayOk,
    complete,
    commandUploadEnabled: false,
    ai: {
      implemented: Boolean(strictLocalAi?.ok),
      provider: stringOrUndefined(strictLocalAi?.provider),
      model: stringOrUndefined(strictLocalAi?.model),
      ollamaUrl: stringOrUndefined(strictLocalAi?.ollamaUrl),
      caseCount: typeof strictLocalAi?.caseCount === "number" ? strictLocalAi.caseCount : undefined,
      caseNames: stringArray(strictLocalAi?.caseNames)
    },
    sourceControl,
    reviewBundle,
    summary,
    checks,
    remainingRealWorldBlockers,
    remainingRealWorldBlockerCount: remainingRealWorldBlockers.length,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    limitations: [
      "This audit proves local plug-and-play readiness for the checked software, AI, QA, and handoff evidence surface.",
      "It does not prove actual Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim to Jetson capture, or hardware-actuation policy approval.",
      "Real command upload and hardware actuation remain disabled."
    ]
  };
}

export async function writePlugAndPlayReadiness(options: Parameters<typeof buildPlugAndPlayReadiness>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildPlugAndPlayReadiness(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-plug-and-play-readiness-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function commandSurfaceCheck(root: string): Promise<PlugAndPlayCheck> {
  const packageJson = await readJson(path.join(root, "package.json"));
  const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const missing = REQUIRED_COMMANDS.filter((command) => typeof scripts[command] !== "string");
  return {
    id: "command-surface",
    requirement: "Plug-and-play operation exposes run, build, AI, QA, acceptance, and handoff commands.",
    status: missing.length ? "fail" : "pass",
    details: missing.length
      ? `Missing package scripts: ${missing.join(", ")}.`
      : "Run, build, AI, QA, acceptance, and handoff package scripts are present.",
    evidence: ["package.json", ...REQUIRED_COMMANDS.map((command) => `package.json scripts.${command}`)]
  };
}

async function operatorSetupCheck(root: string): Promise<PlugAndPlayCheck> {
  const setup = await latestJson(root, ".tmp/plug-and-play-setup", (name) => name.startsWith("seekr-local-setup-"));
  const manifest = setup ? await readJson(setup.absolutePath) : undefined;
  const script = await readText(path.join(root, "scripts/local-setup.ts"));
  const test = await readText(path.join(root, "src/server/__tests__/localSetup.test.ts"));
  const problems: string[] = [];

  if (!script) problems.push("scripts/local-setup.ts is missing");
  for (const signal of ["writeLocalSetup", "envCreated", "envAlreadyExisted", "rehearsal-data-dir", "SEEKR_COMMAND_UPLOAD_ENABLED=true"]) {
    if (script && !script.includes(signal)) problems.push(`scripts/local-setup.ts missing ${signal}`);
  }
  if (!test) problems.push("src/server/__tests__/localSetup.test.ts is missing");
  for (const signal of ["does not overwrite an existing env file", "blocks env output paths outside the project root", "blocks setup when env example defaults are missing"]) {
    if (test && !test.includes(signal)) problems.push(`localSetup.test.ts missing ${signal}`);
  }
  if (!plugAndPlaySetupOk(manifest)) problems.push("latest plug-and-play setup artifact must pass local env/data preparation with commandUploadEnabled false");

  return {
    id: "operator-setup",
    requirement: "A local setup command prepares operator env/data files without overwriting edits or enabling command authority.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "Latest plug-and-play setup artifact proves non-destructive .env preparation, project-local rehearsal data setup, and disabled command upload.",
    evidence: [
      "scripts/local-setup.ts",
      "src/server/__tests__/localSetup.test.ts",
      setup?.relativePath ?? ".tmp/plug-and-play-setup"
    ].filter(isString)
  };
}

async function localAiPrepareCheck(root: string): Promise<PlugAndPlayCheck> {
  const artifact = await latestJson(root, ".tmp/local-ai-prepare", (name) => name.startsWith("seekr-local-ai-prepare-"));
  const manifest = artifact ? await readJson(artifact.absolutePath) : undefined;
  const script = await readText(path.join(root, "scripts/local-ai-prepare.ts"));
  const test = await readText(path.join(root, "src/server/__tests__/localAiPrepare.test.ts"));
  const problems: string[] = [];

  if (!script) problems.push("scripts/local-ai-prepare.ts is missing");
  for (const signal of ["buildLocalAiPrepare", "writeLocalAiPrepare", "ollama", "pull", "commandUploadEnabled: false"]) {
    if (script && !script.includes(signal)) problems.push(`scripts/local-ai-prepare.ts missing ${signal}`);
  }
  if (!test) problems.push("src/server/__tests__/localAiPrepare.test.ts is missing");
  for (const signal of ["ollama pull llama3.2", "check-only", "fails closed"]) {
    if (test && !test.includes(signal)) problems.push(`localAiPrepare.test.ts missing ${signal}`);
  }
  if (!localAiPrepareManifestOk(manifest)) {
    problems.push("latest local AI prepare artifact must prove a passing Ollama model preparation run with commandUploadEnabled false");
  }

  return {
    id: "local-ai-prepare",
    requirement: "The local Ollama model is prepared through a repeatable package command before startup and strict AI smoke.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "Latest local AI prepare artifact proves the Ollama model preparation command passed while command upload stayed disabled.",
    evidence: [
      "scripts/local-ai-prepare.ts",
      "src/server/__tests__/localAiPrepare.test.ts",
      artifact?.relativePath ?? ".tmp/local-ai-prepare"
    ].filter(isString)
  };
}

async function operatorDoctorCheck(root: string): Promise<PlugAndPlayCheck> {
  const doctor = await latestOperatorDoctorJson(root);
  const sourceControl = await latestJson(root, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
  const manifest = doctor ? await readJson(doctor.absolutePath) : undefined;
  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const script = await readText(path.join(root, "scripts/plug-and-play-doctor.ts"));
  const test = await readText(path.join(root, "src/server/__tests__/plugAndPlayDoctor.test.ts"));
  const problems: string[] = [];

  if (!script) problems.push("scripts/plug-and-play-doctor.ts is missing");
  for (const signal of [
    "buildPlugAndPlayDoctor",
    "writePlugAndPlayDoctor",
    "runtime-dependencies",
    "repository-safety",
    "source-control-handoff",
    "packageManager",
    "engines.node",
    ".npmrc",
    "node_modules/.bin/concurrently",
    "node_modules/.bin/vite",
    "local-ai",
    "local-ports",
    "auto-selected free local",
    "probeOccupiedSeekrPort",
    "healthy SEEKR local instance",
    "SEEKR_DOCTOR_PROFILE",
    "SEEKR_COMMAND_UPLOAD_ENABLED"
  ]) {
    if (script && !script.includes(signal)) problems.push(`scripts/plug-and-play-doctor.ts missing ${signal}`);
  }
  if (!test) problems.push("src/server/__tests__/plugAndPlayDoctor.test.ts is missing");
  for (const signal of [
    "local runtime dependencies have not been installed",
    "repository safety policy",
    "configured Ollama model is unavailable",
    "local start ports are already occupied",
    "occupied local ports already serve a healthy SEEKR instance",
    "healthy SEEKR local instance",
    "unsafe local environment flags",
    "rehearsal start wrapper skips the doctor preflight",
    "port normalization and automatic fallback"
  ]) {
    if (test && !test.includes(signal)) problems.push(`plugAndPlayDoctor.test.ts missing ${signal}`);
  }
  if (!isRecord(manifest)) problems.push("latest operator-start plug-and-play doctor artifact is missing or malformed");
  if (isRecord(manifest) && manifest.profile !== undefined && manifest.profile !== "operator-start") {
    problems.push("latest plug-and-play doctor must be an operator-start artifact, not rehearsal-start-smoke");
  }
  if (isRecord(manifest) && manifest.ok !== true) problems.push("latest plug-and-play doctor must pass");
  if (isRecord(manifest) && manifest.commandUploadEnabled !== false) problems.push("latest plug-and-play doctor must keep commandUploadEnabled false");
  if (isRecord(manifest) && manifest.status !== "ready-local-start") problems.push("latest plug-and-play doctor must report ready-local-start");
  const checks = isRecord(manifest) && Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  const checkIds = new Set(checks.map((check) => String(check.id ?? "")));
  const missingCheckIds = isRecord(manifest) ? REQUIRED_DOCTOR_CHECK_IDS.filter((id) => !checkIds.has(id)) : [];
  if (missingCheckIds.length) problems.push(`latest plug-and-play doctor is missing required check(s): ${missingCheckIds.join(", ")}`);
  const badCheckIds = isRecord(manifest) ? REQUIRED_DOCTOR_CHECK_IDS.filter((id) => !doctorCheckStatusOk(checks, id)) : [];
  if (badCheckIds.length) problems.push(`latest plug-and-play doctor has non-passing critical check(s): ${badCheckIds.join(", ")}`);
  if (isRecord(manifest) && !doctorRuntimeDependencyEvidenceOk(checks)) {
    problems.push(`latest plug-and-play doctor runtime-dependencies check must preserve evidence for ${REQUIRED_RUNTIME_DEPENDENCY_EVIDENCE.join(", ")}`);
  }
  if (isRecord(manifest) && sourceControl && !doctorSourceControlEvidenceOk(checks, sourceControl.relativePath)) {
    problems.push("latest operator-start plug-and-play doctor must reference the latest source-control handoff artifact");
  }
  if (isRecord(manifest) && !plugAndPlayDoctorOk(manifest, acceptance, sourceControl?.relativePath)) {
    problems.push("latest plug-and-play doctor must satisfy the shared exact-row operator-start artifact contract");
  }
  const ai = isRecord(manifest) && isRecord(manifest.ai) ? manifest.ai : undefined;
  if (ai && (ai.provider !== "ollama" || ai.status !== "pass")) problems.push("latest plug-and-play doctor must prove local Ollama is reachable");
  const doctorGeneratedAt = isRecord(manifest) ? timeMs(manifest.generatedAt) : undefined;
  const acceptanceGeneratedAt = isRecord(acceptance) ? timeMs(acceptance.generatedAt) : undefined;
  if (acceptanceGeneratedAt !== undefined && doctorGeneratedAt === undefined) {
    problems.push("latest plug-and-play doctor must record a parseable generatedAt timestamp");
  } else if (acceptanceGeneratedAt !== undefined && doctorGeneratedAt !== undefined && doctorGeneratedAt < acceptanceGeneratedAt) {
    problems.push("latest plug-and-play doctor must be newer than or equal to the latest acceptance record");
  }
  const warningDetails = doctorSoftWarningDetails(checks);

  return {
    id: "operator-doctor",
    requirement: "A local operator has a runnable preflight command for laptop startup, local AI, ports, data directory, and safety flags.",
    status: problems.length ? "fail" : warningDetails.length ? "warn" : "pass",
    details: problems.length
      ? problems.join("; ")
      : warningDetails.length
        ? `Latest operator-start plug-and-play doctor passed with soft warning(s): ${warningDetails.join("; ")}.`
      : "Latest operator-start plug-and-play doctor artifact proves repository safety, local startup prerequisites, start-wrapper safety, local Ollama, ports, data directory, and disabled command upload.",
    evidence: [
      "scripts/plug-and-play-doctor.ts",
      "src/server/__tests__/plugAndPlayDoctor.test.ts",
      sourceControl?.relativePath,
      doctor?.relativePath ?? ".tmp/plug-and-play-doctor"
    ].filter(isString)
  };
}

function doctorSoftWarningDetails(checks: Record<string, unknown>[]) {
  return checks
    .filter((check) => SOFT_DOCTOR_CHECK_IDS.has(String(check.id ?? "")) && check.status === "warn")
    .map((check) => {
      const id = String(check.id ?? "unknown");
      const details = typeof check.details === "string" && check.details.length ? check.details : "warning details unavailable";
      return `${id}: ${details}`;
    });
}

async function sourceControlHandoffCheck(root: string): Promise<PlugAndPlayCheck> {
  const artifact = await latestJson(root, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
  const manifest = artifact ? await readJson(artifact.absolutePath) : undefined;
  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const acceptanceGeneratedAt = isRecord(acceptance) ? timeMs(acceptance.generatedAt) : undefined;

  if (!isRecord(manifest)) {
    return {
      id: "source-control-handoff",
      requirement: "Source-control publication and GitHub handoff state are recorded separately from hardware readiness.",
      status: "warn",
      details: "No source-control handoff artifact exists; run npm run audit:source-control before claiming GitHub-published plug-and-play distribution.",
      evidence: [".tmp/source-control-handoff"]
    };
  }
  const validation = validateSourceControlHandoffManifest(manifest);
  if (!validation.ok) {
    return {
      id: "source-control-handoff",
      requirement: "Source-control publication and GitHub handoff state are recorded separately from hardware readiness.",
      status: "fail",
      details: `Source-control handoff artifact is unsafe or malformed: ${validation.problems.join("; ")}.`,
      evidence: [artifact?.relativePath ?? ".tmp/source-control-handoff"]
    };
  }
  const sourceControlGeneratedAt = timeMs(manifest.generatedAt);
  if (validation.ready && acceptanceGeneratedAt !== undefined && sourceControlGeneratedAt === undefined) {
    return {
      id: "source-control-handoff",
      requirement: "Source-control publication and GitHub handoff state are recorded separately from hardware readiness.",
      status: "fail",
      details: "Ready source-control handoff artifact must record a parseable generatedAt timestamp so plug-and-play readiness can prove it follows acceptance.",
      evidence: [artifact?.relativePath ?? ".tmp/source-control-handoff"]
    };
  }
  if (validation.ready && acceptanceGeneratedAt !== undefined && sourceControlGeneratedAt !== undefined && sourceControlGeneratedAt < acceptanceGeneratedAt) {
    return {
      id: "source-control-handoff",
      requirement: "Source-control publication and GitHub handoff state are recorded separately from hardware readiness.",
      status: "fail",
      details: "Ready source-control handoff artifact must be newer than or equal to the latest acceptance record.",
      evidence: [artifact?.relativePath ?? ".tmp/source-control-handoff", ".tmp/acceptance-status.json"]
    };
  }

  return {
    id: "source-control-handoff",
    requirement: "Source-control publication and GitHub handoff state are recorded separately from hardware readiness.",
    status: validation.blockedCheckIds.length || validation.warningCheckIds.length ? "warn" : "pass",
    details: validation.blockedCheckIds.length
      ? `Source-control handoff is not ready yet: ${validation.blockedCheckIds.join(", ")}.`
      : validation.warningCheckIds.length
        ? `Source-control handoff has warning(s): ${validation.warningCheckIds.join(", ")}.`
        : "Source-control handoff artifact records local Git metadata, GitHub remote refs/default branch, published local HEAD, and a clean worktree.",
    evidence: [artifact?.relativePath ?? ".tmp/source-control-handoff"]
  };
}

async function operatorStartCheck(root: string): Promise<PlugAndPlayCheck> {
  const packageJson = await readJson(path.join(root, "package.json"));
  const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const startScript = await readText(path.join(root, "scripts/rehearsal-start.sh"));
  const problems: string[] = [];

  if (scripts["rehearsal:start"] !== "bash scripts/rehearsal-start.sh") {
    problems.push("package.json scripts.rehearsal:start must point at bash scripts/rehearsal-start.sh");
  }
  if (!startScript) {
    problems.push("scripts/rehearsal-start.sh is missing");
  } else {
    for (const signal of [
      "set -euo pipefail",
      ".tmp/rehearsal-data",
      "SEEKR_EXPECTED_SOURCES",
      "select_free_port",
      "port_is_busy",
      "SEEKR_API_PORT",
      "SEEKR_CLIENT_PORT",
      "PORT and SEEKR_API_PORT disagree",
      "auto-selected free local",
      "mavlink:telemetry:drone-1",
      "ros2-slam:map",
      "lidar-slam:lidar",
      "isaac-nvblox:costmap",
      "npm run setup:local",
      "npm run ai:prepare",
      "npm run audit:source-control",
      "npm run doctor",
      "exec npm run dev"
    ]) {
      if (!startScript.includes(signal)) problems.push(`scripts/rehearsal-start.sh missing ${signal}`);
    }
    const setupIndex = startScript.indexOf("npm run setup:local");
    const aiPrepareIndex = startScript.indexOf("npm run ai:prepare");
    const sourceControlIndex = startScript.indexOf("npm run audit:source-control");
    const doctorIndex = startScript.indexOf("npm run doctor");
    const devIndex = startScript.indexOf("exec npm run dev");
    if (
      setupIndex === -1 ||
      aiPrepareIndex === -1 ||
      sourceControlIndex === -1 ||
      doctorIndex === -1 ||
      devIndex === -1 ||
      setupIndex > aiPrepareIndex ||
      aiPrepareIndex > sourceControlIndex ||
      sourceControlIndex > doctorIndex ||
      doctorIndex > devIndex
    ) {
      problems.push("scripts/rehearsal-start.sh must run npm run setup:local before npm run ai:prepare before npm run audit:source-control before npm run doctor before exec npm run dev");
    }
  }

  return {
    id: "operator-start",
    requirement: "A local operator has one command that starts a project-local rehearsal with expected read-only sources.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "npm run rehearsal:start sets a project-local data directory, declares expected read-only sources, normalizes API/client port environment, auto-selects free local ports when unconfigured defaults are busy, runs npm run setup:local, prepares the local Ollama model with npm run ai:prepare, refreshes source-control handoff evidence, runs npm run doctor, and launches npm run dev.",
    evidence: ["package.json scripts.rehearsal:start", "scripts/rehearsal-start.sh"]
  };
}

async function operatorStartSmokeCheck(root: string): Promise<PlugAndPlayCheck> {
  const packageJson = await readJson(path.join(root, "package.json"));
  const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const script = await readText(path.join(root, "scripts/rehearsal-start-smoke.ts"));
  const artifact = await latestJson(root, ".tmp/rehearsal-start-smoke", (name) => name.startsWith("seekr-rehearsal-start-smoke-"));
  const manifest = artifact ? await readJson(artifact.absolutePath) : undefined;
  const validation = validateRehearsalStartSmokeManifest(manifest);
  const problems: string[] = [];

  if (scripts["smoke:rehearsal:start"] !== "tsx scripts/rehearsal-start-smoke.ts") {
    problems.push("package.json scripts.smoke:rehearsal:start must point at tsx scripts/rehearsal-start-smoke.ts");
  }
  if (!script) {
    problems.push("scripts/rehearsal-start-smoke.ts is missing");
  } else {
    for (const signal of ["npm", "rehearsal:start", "/api/config", "/api/source-health", "/api/readiness", "commandUploadEnabled"]) {
      if (!script.includes(signal)) problems.push(`scripts/rehearsal-start-smoke.ts missing ${signal}`);
    }
  }
  if (!artifact) problems.push("latest rehearsal-start smoke artifact is missing");
  if (artifact && !validation.ok) problems.push(`latest rehearsal-start smoke artifact is unsafe or malformed: ${validation.problems.join("; ")}`);

  return {
    id: "operator-start-smoke",
    requirement: "The one-command operator start path has a bounded smoke proof for setup, doctor, API/client startup, source health, readiness, and shutdown.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "Latest rehearsal-start smoke artifact proves the wrapper can run setup, doctor, local API/client startup, source-health/readiness checks, and clean shutdown with command upload disabled.",
    evidence: [
      "package.json scripts.smoke:rehearsal:start",
      "scripts/rehearsal-start-smoke.ts",
      artifact?.relativePath ?? ".tmp/rehearsal-start-smoke"
    ].filter(isString)
  };
}

async function operatorQuickstartDocCheck(root: string): Promise<PlugAndPlayCheck> {
  const content = await readText(path.join(root, OPERATOR_QUICKSTART_PATH));
  const problems = operatorQuickstartProblems(content);

  return {
    id: "operator-quickstart-doc",
    requirement: "The operator quickstart documents local setup, source-control audit, start, strict local AI smoke proof, evidence checks, and safety limits for plug-and-play use.",
    status: !content || problems.length ? "fail" : "pass",
    details: !content
      ? `${OPERATOR_QUICKSTART_PATH} is missing.`
      : problems.length
        ? `${OPERATOR_QUICKSTART_PATH} is missing plug-and-play signal(s): ${problems.join(", ")}.`
        : "Operator quickstart covers local setup, source-control audit, start, strict local AI smoke proof, advisory-only Ollama AI, API evidence checks, source-health proof, and the disabled command/hardware boundary.",
    evidence: [OPERATOR_QUICKSTART_PATH]
  };
}

async function envExampleCheck(root: string): Promise<PlugAndPlayCheck> {
  const content = await readText(path.join(root, ".env.example"));
  const missing = REQUIRED_ENV_EXAMPLE_SIGNALS.filter((signal) => !content.includes(signal));
  return {
    id: "operator-env",
    requirement: "A local operator can see the default API/client/data/AI environment knobs.",
    status: missing.length ? "fail" : "pass",
    details: missing.length
      ? `.env.example is missing: ${missing.join(", ")}.`
      : ".env.example documents local ports, data directory, env-file loading controls, and the default local Ollama provider, URL, model, and timeout.",
    evidence: [".env.example"]
  };
}

async function envLoaderCheck(root: string): Promise<PlugAndPlayCheck> {
  const requiredFiles = [
    {
      path: "src/server/env.ts",
      signals: ["export function loadLocalEnv", "parseEnvContent", "SEEKR_ENV_FILE", "SEEKR_LOAD_DOTENV", "outside-root"]
    },
    { path: "src/server/index.ts", signals: ["loadLocalEnv();"] },
    { path: "src/server/config.ts", signals: ["loadLocalEnv();"] },
    { path: "src/server/session.ts", signals: ["loadLocalEnv();"] },
    { path: "src/server/ai/llamaProvider.ts", signals: ["loadLocalEnv();"] },
    { path: "src/server/sourceHealth.ts", signals: ["loadLocalEnv();"] },
    { path: "src/server/persistence.ts", signals: ["loadLocalEnv();"] },
    { path: "src/server/api/auth.ts", signals: ["loadLocalEnv();"] },
    {
      path: "src/server/__tests__/envLoader.test.ts",
      signals: ["does not override explicit environment variables", "outside the project root", "fills unset server AI settings"]
    }
  ];
  const missing: string[] = [];
  for (const item of requiredFiles) {
    const content = await readText(path.join(root, item.path));
    if (!content) {
      missing.push(`${item.path} missing`);
      continue;
    }
    for (const signal of item.signals) {
      if (!content.includes(signal)) missing.push(`${item.path} missing ${signal}`);
    }
  }

  return {
    id: "env-loader",
    requirement: "Local .env loading is implemented, project-root-contained, and covered by tests for copy-and-run operator setup.",
    status: missing.length ? "fail" : "pass",
    details: missing.length
      ? missing.join("; ")
      : "Project-local .env loading is wired into server/runtime config, preserves explicit shell values, rejects outside-root env files, and has focused tests.",
    evidence: requiredFiles.map((item) => item.path)
  };
}

async function buildOutputCheck(root: string): Promise<PlugAndPlayCheck> {
  const required = ["dist/index.html"];
  const missing = [];
  for (const file of required) {
    if (!(await pathExists(path.join(root, file)))) missing.push(file);
  }
  return {
    id: "built-app",
    requirement: "A production shell has been built and is available for preview smoke testing.",
    status: missing.length ? "fail" : "pass",
    details: missing.length
      ? `Missing built production artifacts: ${missing.join(", ")}.`
      : "Production shell exists under dist/.",
    evidence: required
  };
}

async function acceptanceAndAiCheck(root: string): Promise<PlugAndPlayCheck> {
  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const release = await latestJson(root, ".tmp/release-evidence", (name) => name.startsWith("seekr-release-"));
  const strictLocalAi = isRecord(acceptance) && isRecord(acceptance.strictLocalAi) ? acceptance.strictLocalAi : {};
  const releaseChecksum = isRecord(acceptance) && isRecord(acceptance.releaseChecksum) ? acceptance.releaseChecksum : {};
  const expectedStrictCaseNames: string[] = [...REQUIRED_STRICT_AI_SMOKE_CASES];
  const strictCaseNames = stringArray(strictLocalAi.caseNames);
  const missingStrictCases = expectedStrictCaseNames.filter((name) => !strictCaseNames.includes(name));
  const unexpectedStrictCases = strictCaseNames.filter((name) => !expectedStrictCaseNames.includes(name));
  const problems: string[] = [];

  if (!isRecord(acceptance) || acceptance.ok !== true) problems.push("acceptance status must pass");
  if (!isRecord(acceptance) || acceptance.commandUploadEnabled !== false) problems.push("acceptance status must keep commandUploadEnabled false");
  if (!isRecord(strictLocalAi) || strictLocalAi.ok !== true) problems.push("strict local AI evidence must pass");
  if (isRecord(strictLocalAi) && strictLocalAi.provider !== "ollama") problems.push("strict local AI should use the local Ollama provider for plug-and-play AI readiness");
  if (isRecord(strictLocalAi) && typeof strictLocalAi.model !== "string") problems.push("strict local AI must record the model");
  if (isRecord(strictLocalAi) && !isLocalOllamaUrl(strictLocalAi.ollamaUrl)) problems.push("strict local AI must record a loopback Ollama URL");
  if (isRecord(strictLocalAi) && Number(strictLocalAi.caseCount) !== expectedStrictCaseNames.length) {
    problems.push("strict local AI case count must exactly match the required smoke cases");
  }
  if (strictCaseNames.length !== Number(strictLocalAi.caseCount) || !sameStringArray(strictCaseNames, expectedStrictCaseNames)) {
    problems.push(
      missingStrictCases.length
        ? `strict local AI evidence is missing required scenario(s): ${missingStrictCases.join(", ")}`
        : unexpectedStrictCases.length
          ? `strict local AI evidence includes unexpected scenario(s): ${unexpectedStrictCases.join(", ")}`
          : "strict local AI scenario names must exactly match the required ordered smoke cases"
    );
  }
  if (!release || normalizeArtifactPath(root, releaseChecksum.jsonPath) !== release.relativePath) problems.push("acceptance must point at the latest release checksum");

  return {
    id: "acceptance-ai",
    requirement: "Latest acceptance is passing, tied to the release checksum, and includes local AI smoke evidence.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Acceptance is passing with local AI ${String(strictLocalAi.provider)} / ${String(strictLocalAi.model)} and release ${String(releaseChecksum.overallSha256 ?? "").slice(0, 12)}...`,
    evidence: [".tmp/acceptance-status.json", release?.relativePath].filter(isString)
  };
}

async function apiProbeCheck(root: string): Promise<PlugAndPlayCheck> {
  const probe = await latestJson(root, ".tmp/api-probe", (name) => name.startsWith("seekr-api-probe-"));
  const manifest = probe ? await readJson(probe.absolutePath) : undefined;
  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const checked = isRecord(manifest) && Array.isArray(manifest.checked) ? manifest.checked.map(String) : [];
  const sessionAcceptance = isRecord(manifest) && isRecord(manifest.sessionAcceptance) ? manifest.sessionAcceptance : {};
  const requiredChecks = ["config", "session-acceptance", "session-acceptance-evidence", "readiness", "verify", "replays", "malformed-json"];
  const missing = requiredChecks.filter((check) => !checked.includes(check));
  const problems: string[] = [];

  if (!isRecord(manifest) || manifest.ok !== true) problems.push("probe ok is not true");
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) problems.push("probe commandUploadEnabled is not false");
  if (missing.length) problems.push(`probe missing check(s): ${missing.join(", ")}`);
  if (!isRecord(acceptance) || acceptance.ok !== true) problems.push("acceptance status must pass before API readback can be trusted");
  if (isRecord(acceptance) && acceptance.commandUploadEnabled !== false) problems.push("acceptance status commandUploadEnabled is not false");
  if (sessionAcceptance.ok !== true) problems.push("probe session acceptance ok is not true");
  if (sessionAcceptance.commandUploadEnabled !== false) problems.push("probe session acceptance commandUploadEnabled is not false");

  if (isRecord(acceptance) && acceptance.ok === true) {
    const acceptanceRelease = isRecord(acceptance.releaseChecksum) ? acceptance.releaseChecksum : {};
    const probeRelease = isRecord(sessionAcceptance.releaseChecksum) ? sessionAcceptance.releaseChecksum : {};
    const acceptanceScan = isRecord(acceptance.commandBoundaryScan) ? acceptance.commandBoundaryScan : {};
    const probeScan = isRecord(sessionAcceptance.commandBoundaryScan) ? sessionAcceptance.commandBoundaryScan : {};
    const acceptanceAi = isRecord(acceptance.strictLocalAi) ? acceptance.strictLocalAi : {};
    const probeAi = isRecord(sessionAcceptance.strictLocalAi) ? sessionAcceptance.strictLocalAi : {};
    const acceptanceCommandCount = Array.isArray(acceptance.completedCommands) ? acceptance.completedCommands.length : undefined;
    const acceptanceAiCaseNames = stringArray(acceptanceAi.caseNames);
    const probeAiCaseNames = stringArray(probeAi.caseNames);

    if (sessionAcceptance.status !== "pass") problems.push("probe did not read back passing acceptance status");
    if (Number(sessionAcceptance.generatedAt) !== Number(acceptance.generatedAt)) {
      problems.push("probe acceptance timestamp does not match acceptance status");
    }
    if (typeof acceptanceCommandCount === "number" && Number(sessionAcceptance.commandCount) !== acceptanceCommandCount) {
      problems.push("probe acceptance command count does not match acceptance status");
    }
    if (
      probeAi.ok !== acceptanceAi.ok ||
      probeAi.provider !== acceptanceAi.provider ||
      probeAi.model !== acceptanceAi.model ||
      probeAi.ollamaUrl !== acceptanceAi.ollamaUrl ||
      !isLocalOllamaUrl(acceptanceAi.ollamaUrl) ||
      Number(probeAi.caseCount) !== Number(acceptanceAi.caseCount) ||
      !sameStringArray(probeAiCaseNames, acceptanceAiCaseNames)
    ) {
      problems.push("probe strict local AI summary does not match acceptance status");
    }
    if (
      probeRelease.overallSha256 !== acceptanceRelease.overallSha256 ||
      Number(probeRelease.fileCount) !== Number(acceptanceRelease.fileCount) ||
      Number(probeRelease.totalBytes) !== Number(acceptanceRelease.totalBytes)
    ) {
      problems.push("probe release checksum summary does not match acceptance status");
    }
    if (
      probeScan.status !== "pass" ||
      Number(probeScan.scannedFileCount) !== Number(acceptanceScan.scannedFileCount) ||
      Number(probeScan.violationCount) !== 0 ||
      Number(probeScan.allowedFindingCount) !== Number(acceptanceScan.allowedFindingCount)
    ) {
      problems.push("probe command-boundary scan summary does not match acceptance status");
    }
  }

  return {
    id: "api-readback",
    requirement: "The local API has a current smoke probe for session, config, readiness, replay, and malformed JSON behavior.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "Latest API probe covers the local plug-and-play readback surface, matches acceptance evidence, and keeps command upload disabled.",
    evidence: [probe?.relativePath ?? ".tmp/api-probe"].filter(isString)
  };
}

async function workflowQaCheck(root: string): Promise<PlugAndPlayCheck> {
  const workflow = await latestJson(root, ".tmp/gstack-workflow-status", (name) => name.startsWith("seekr-gstack-workflow-status-"));
  const manifest = workflow ? await readJson(workflow.absolutePath) : undefined;
  const qaReport = isRecord(manifest) && isRecord(manifest.qaReport) ? manifest.qaReport : {};
  const healthHistory = isRecord(manifest) && isRecord(manifest.healthHistory) ? manifest.healthHistory : {};
  const workflows = isRecord(manifest) && Array.isArray(manifest.workflows) ? manifest.workflows.filter(isRecord) : [];
  const perspectives = isRecord(manifest) && Array.isArray(manifest.perspectives) ? manifest.perspectives.filter(isRecord) : [];
  const problems: string[] = [];

  if (!isRecord(manifest)) problems.push("gstack workflow status is missing");
  if (isRecord(manifest) && !["pass", "pass-with-limitations"].includes(String(manifest.status))) problems.push("gstack workflow status must pass or pass-with-limitations");
  if (isRecord(manifest) && manifest.commandUploadEnabled !== false) problems.push("gstack workflow status must keep commandUploadEnabled false");
  if (isRecord(manifest) && manifest.gstackAvailable !== true) problems.push("gstack workflow status must record installed gstack skill/tool availability");
  if (isRecord(manifest) && typeof manifest.gstackCliAvailable !== "boolean") problems.push("gstack workflow status must record gstack CLI availability");
  if (isRecord(manifest) && !gstackHelperToolEvidenceOk(manifest)) {
    problems.push("gstack workflow status must preserve helper-tool evidence when the umbrella CLI is unavailable");
  }
  if (isRecord(manifest) && !artifactIdsAreExact(workflows, REQUIRED_GSTACK_WORKFLOW_IDS)) {
    problems.push(`gstack workflow rows must exactly match ${REQUIRED_GSTACK_WORKFLOW_IDS.join(", ")} in order`);
  }
  if (isRecord(manifest) && !artifactIdsAreExact(perspectives, REQUIRED_GSTACK_PERSPECTIVE_IDS)) {
    problems.push(`gstack perspective rows must exactly match ${REQUIRED_GSTACK_PERSPECTIVE_IDS.join(", ")} in order`);
  }
  if (!isRecord(healthHistory) || healthHistory.status !== "pass") problems.push("health history must be current and passing");
  if (!isRecord(qaReport) || qaReport.status !== "pass") problems.push("browser QA report must be current and passing");
  if (isRecord(qaReport) && typeof qaReport.path !== "string") problems.push("browser QA report path must be recorded");

  return {
    id: "workflow-qa",
    requirement: "Current health history and browser QA are recorded for plug-and-play operator confidence.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Health history and browser QA are current: ${String(qaReport.path)}.`,
    evidence: [workflow?.relativePath, stringOrUndefined(qaReport.path)].filter(isString)
  };
}

async function reviewBundleCheck(root: string): Promise<PlugAndPlayCheck> {
  const bundle = await latestJson(root, ".tmp/handoff-bundles", (name) => name.startsWith("seekr-handoff-bundle-"));
  const verification = await latestJson(root, ".tmp/handoff-bundles", (name) => name.startsWith("seekr-review-bundle-verification-"));
  const manifest = verification ? await readJson(verification.absolutePath) : undefined;
  const secretScan = isRecord(manifest) && isRecord(manifest.secretScan) ? manifest.secretScan : undefined;
  const checkedFileCount = isRecord(manifest) ? Number(manifest.checkedFileCount) : Number.NaN;
  const workflow = await latestJson(root, ".tmp/gstack-workflow-status", (name) => name.startsWith("seekr-gstack-workflow-status-"));
  const workflowManifest = workflow ? await readJson(workflow.absolutePath) : undefined;
  const qaReport = isRecord(workflowManifest) && isRecord(workflowManifest.qaReport) ? workflowManifest.qaReport : undefined;
  const todoAudit = await latestJson(root, ".tmp/todo-audit", (name) => name.startsWith("seekr-todo-audit-"));
  const sourceControl = await latestJson(root, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
  const sourceControlManifest = sourceControl ? await readJson(sourceControl.absolutePath) : undefined;
  const setup = await latestJson(root, ".tmp/plug-and-play-setup", (name) => name.startsWith("seekr-local-setup-"));
  const localAiPrepare = await latestJson(root, ".tmp/local-ai-prepare", (name) => name.startsWith("seekr-local-ai-prepare-"));
  const doctor = await latestOperatorDoctorJson(root);
  const rehearsalStartSmoke = await latestJson(root, ".tmp/rehearsal-start-smoke", (name) => name.startsWith("seekr-rehearsal-start-smoke-"));
  const sourceBundlePath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.sourceBundlePath) : undefined;
  const gstackWorkflowStatusPath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.gstackWorkflowStatusPath) : undefined;
  const gstackQaReportPath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.gstackQaReportPath) : undefined;
  const todoAuditPath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.todoAuditPath) : undefined;
  const sourceControlHandoffPath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.sourceControlHandoffPath) : undefined;
  const plugAndPlaySetupPath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.plugAndPlaySetupPath) : undefined;
  const localAiPreparePath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.localAiPreparePath) : undefined;
  const plugAndPlayDoctorPath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.plugAndPlayDoctorPath) : undefined;
  const rehearsalStartSmokePath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.rehearsalStartSmokePath) : undefined;
  const strictAiSmokeStatusPath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.strictAiSmokeStatusPath) : undefined;
  const operatorQuickstartPath = isRecord(manifest) ? normalizeArtifactPath(root, manifest.operatorQuickstartPath) : undefined;
  const latestQaReportPath = isRecord(qaReport) ? normalizeArtifactPath(root, qaReport.path) : undefined;
  const problems: string[] = [];

  if (!isRecord(manifest) || manifest.status !== "pass") problems.push("review bundle verification must pass");
  if (isRecord(manifest) && manifest.commandUploadEnabled !== false) problems.push("review bundle verification must keep commandUploadEnabled false");
  if (!bundle || sourceBundlePath !== bundle.relativePath) problems.push("review bundle verification must point at the latest handoff bundle");
  if (!workflow || gstackWorkflowStatusPath !== workflow.relativePath) problems.push("review bundle verification must point at the latest gstack workflow status");
  if (!todoAudit || todoAuditPath !== todoAudit.relativePath) problems.push("review bundle verification must point at the latest TODO audit");
  if (!sourceControl || sourceControlHandoffPath !== sourceControl.relativePath) problems.push("review bundle verification must point at the latest source-control handoff");
  if (isRecord(sourceControlManifest) && sourceControlManifest.ready === true && isRecord(manifest)) {
    if (stringOrUndefined(manifest.sourceControlHandoffLocalHeadSha) !== stringOrUndefined(sourceControlManifest.localHeadSha)) {
      problems.push("review bundle source-control local HEAD summary must match the latest source-control handoff");
    }
    if (stringOrUndefined(manifest.sourceControlHandoffRemoteDefaultBranchSha) !== stringOrUndefined(sourceControlManifest.remoteDefaultBranchSha)) {
      problems.push("review bundle source-control remote default SHA summary must match the latest source-control handoff");
    }
    if (booleanOrUndefined(manifest.sourceControlHandoffWorkingTreeClean) !== booleanOrUndefined(sourceControlManifest.workingTreeClean)) {
      problems.push("review bundle source-control clean-worktree summary must match the latest source-control handoff");
    }
    if (numberOrUndefined(manifest.sourceControlHandoffWorkingTreeStatusLineCount) !== numberOrUndefined(sourceControlManifest.workingTreeStatusLineCount)) {
      problems.push("review bundle source-control working-tree status line summary must match the latest source-control handoff");
    }
  }
  if (!setup || plugAndPlaySetupPath !== setup.relativePath) problems.push("review bundle verification must point at the latest plug-and-play setup");
  if (!localAiPrepare || localAiPreparePath !== localAiPrepare.relativePath) problems.push("review bundle verification must point at the latest local AI prepare artifact");
  if (!doctor || plugAndPlayDoctorPath !== doctor.relativePath) problems.push("review bundle verification must point at the latest operator-start plug-and-play doctor");
  if (!rehearsalStartSmoke || rehearsalStartSmokePath !== rehearsalStartSmoke.relativePath) problems.push("review bundle verification must point at the latest rehearsal-start smoke");
  if (strictAiSmokeStatusPath !== STRICT_AI_SMOKE_STATUS_PATH) problems.push("review bundle verification must include the strict local AI smoke status");
  if (operatorQuickstartPath !== OPERATOR_QUICKSTART_PATH) problems.push("review bundle verification must include the operator quickstart");
  if (!latestQaReportPath || gstackQaReportPath !== latestQaReportPath) problems.push("review bundle verification must point at the latest gstack QA report");
  if (!Number.isFinite(checkedFileCount) || checkedFileCount <= 0) problems.push("review bundle verification must check copied files");
  if (!secretScan || secretScan.status !== "pass" || Number(secretScan.findingCount) !== 0) problems.push("review bundle secret scan must pass with zero findings");
  if (secretScan && (Number(secretScan.scannedFileCount) !== checkedFileCount || Number(secretScan.expectedFileCount) !== checkedFileCount)) {
    problems.push("review bundle secret scan must cover every copied file");
  }

  return {
    id: "review-bundle",
    requirement: "A copied local review bundle has passed digest, strict-AI smoke, semantic, QA, TODO, source-control, setup, doctor, operator quickstart, and secret-scan verification.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Latest review bundle verification passed with ${checkedFileCount} copied files checked/scanned, current strict-AI/gstack/QA/TODO/source-control/setup/local-AI-prep/doctor/operator-quickstart evidence, and zero secret findings.`,
    evidence: [
      verification?.relativePath ?? ".tmp/handoff-bundles",
      bundle?.relativePath,
      workflow?.relativePath,
      latestQaReportPath,
      todoAudit?.relativePath,
      sourceControl?.relativePath,
      setup?.relativePath,
      localAiPrepare?.relativePath,
      doctor?.relativePath,
      rehearsalStartSmoke?.relativePath,
      STRICT_AI_SMOKE_STATUS_PATH,
      OPERATOR_QUICKSTART_PATH
    ].filter(isString)
  };
}

async function completionBoundaryCheck(root: string): Promise<PlugAndPlayCheck> {
  const completion = await latestJson(root, ".tmp/completion-audit", (name) => name.startsWith("seekr-completion-audit-"));
  const manifest = completion ? await readJson(completion.absolutePath) : undefined;
  const blockers = isRecord(manifest) && Array.isArray(manifest.realWorldBlockers) ? manifest.realWorldBlockers.map(String) : [];
  const items = isRecord(manifest) && Array.isArray(manifest.items) ? manifest.items.filter(isRecord) : [];
  const adapterBoundary = items.find((item) => item.id === "adapter-command-boundary");
  const commandScan = items.find((item) => item.id === "command-boundary-scan");
  const policyReview = items.find((item) => item.id === "hardware-actuation-policy-review");
  const policyDetails = String(policyReview?.details ?? "");
  const completionComplete = isRecord(manifest) && manifest.complete === true;
  const explicitBoundary = isRecord(manifest) && isRecord(manifest.safetyBoundary) ? manifest.safetyBoundary : undefined;
  const falseHardwareAuthorization = explicitBoundary
    ? explicitBoundary.hardwareActuationEnabled === false
    : /false authorization|command authority remains disabled|runtime command authority remains disabled/i.test(policyDetails);
  const completionContradictions: string[] = [];
  if (isRecord(manifest) && completionComplete && blockers.length > 0) {
    completionContradictions.push("completion audit cannot report complete while real-world blockers remain");
  }
  if (isRecord(manifest) && !completionComplete && blockers.length === 0) {
    completionContradictions.push("completion audit must explicitly report complete before plug-and-play readiness can clear real-world blockers");
  }
  const fail = !isRecord(manifest) ||
    manifest.localAlphaOk !== true ||
    manifest.commandUploadEnabled !== false ||
    adapterBoundary?.status !== "pass" ||
    commandScan?.status !== "pass" ||
    !falseHardwareAuthorization ||
    completionContradictions.length > 0;
  return {
    id: "real-world-boundary",
    requirement: "Local plug-and-play readiness must keep real hardware blockers explicit instead of claiming aircraft readiness.",
    status: fail ? "fail" : blockers.length ? "blocked" : "pass",
    details: fail
      ? [
        "Completion audit must report localAlphaOk true, keep commandUploadEnabled false, pass command-boundary checks, preserve false hardware authorization, and keep complete/blocker state consistent.",
        ...completionContradictions
      ].join(" ")
      : blockers.length
        ? `${blockers.length} real-world blocker category/categories remain before aircraft/hardware plug-and-play.`
        : "Completion audit reports no remaining real-world blockers.",
    evidence: [completion?.relativePath ?? ".tmp/completion-audit"]
  };
}

function renderMarkdown(manifest: PlugAndPlayReadinessManifest) {
  return `${[
    "# SEEKR Plug-And-Play Readiness",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `Local plug-and-play OK: ${manifest.localPlugAndPlayOk}`,
    `Complete: ${manifest.complete}`,
    "Command upload enabled: false",
    "",
    "AI:",
    "",
    `- Implemented: ${manifest.ai.implemented}`,
    manifest.ai.provider ? `- Provider: ${manifest.ai.provider}` : undefined,
    manifest.ai.model ? `- Model: ${manifest.ai.model}` : undefined,
    typeof manifest.ai.caseCount === "number" ? `- Smoke cases: ${manifest.ai.caseCount}` : undefined,
    manifest.ai.caseNames?.length ? `- Smoke scenario names: ${manifest.ai.caseNames.join(", ")}` : undefined,
    "",
    "Source control:",
    "",
    manifest.sourceControl.path ? `- Handoff: ${manifest.sourceControl.path}` : undefined,
    manifest.sourceControl.status ? `- Status: ${manifest.sourceControl.status}` : undefined,
    typeof manifest.sourceControl.ready === "boolean" ? `- Ready: ${manifest.sourceControl.ready}` : undefined,
    manifest.sourceControl.localHeadSha ? `- Local HEAD: ${manifest.sourceControl.localHeadSha}` : undefined,
    manifest.sourceControl.remoteDefaultBranchSha ? `- Remote default SHA: ${manifest.sourceControl.remoteDefaultBranchSha}` : undefined,
    typeof manifest.sourceControl.workingTreeClean === "boolean" ? `- Working tree clean: ${manifest.sourceControl.workingTreeClean}` : undefined,
    typeof manifest.sourceControl.workingTreeStatusLineCount === "number" ? `- Working tree status lines: ${manifest.sourceControl.workingTreeStatusLineCount}` : undefined,
    "",
    "Review bundle:",
    "",
    manifest.reviewBundle.path ? `- Bundle: ${manifest.reviewBundle.path}` : undefined,
    manifest.reviewBundle.verificationPath ? `- Verification: ${manifest.reviewBundle.verificationPath}` : undefined,
    manifest.reviewBundle.status ? `- Status: ${manifest.reviewBundle.status}` : undefined,
    typeof manifest.reviewBundle.checkedFileCount === "number" ? `- Checked files: ${manifest.reviewBundle.checkedFileCount}` : undefined,
    manifest.reviewBundle.secretScanStatus ? `- Secret scan: ${manifest.reviewBundle.secretScanStatus}` : undefined,
    manifest.reviewBundle.sourceControlHandoffPath ? `- Source-control handoff: ${manifest.reviewBundle.sourceControlHandoffPath}` : undefined,
    manifest.reviewBundle.sourceControlHandoffLocalHeadSha ? `- Source-control local HEAD: ${manifest.reviewBundle.sourceControlHandoffLocalHeadSha}` : undefined,
    manifest.reviewBundle.sourceControlHandoffRemoteDefaultBranchSha ? `- Source-control remote default SHA: ${manifest.reviewBundle.sourceControlHandoffRemoteDefaultBranchSha}` : undefined,
    typeof manifest.reviewBundle.sourceControlHandoffWorkingTreeClean === "boolean" ? `- Source-control working tree clean: ${manifest.reviewBundle.sourceControlHandoffWorkingTreeClean}` : undefined,
    typeof manifest.reviewBundle.sourceControlHandoffWorkingTreeStatusLineCount === "number" ? `- Source-control working tree status lines: ${manifest.reviewBundle.sourceControlHandoffWorkingTreeStatusLineCount}` : undefined,
    "",
    "Checks:",
    "",
    "| Check | Status | Details |",
    "| --- | --- | --- |",
    ...manifest.checks.map((check) => `| ${check.id} | ${check.status} | ${escapeTable(check.details)} |`),
    "",
    "Remaining real-world blockers:",
    "",
    `Count: ${manifest.remainingRealWorldBlockerCount}`,
    "",
    ...(manifest.remainingRealWorldBlockers.length ? manifest.remainingRealWorldBlockers.map((blocker) => `- ${blocker}`) : ["- None"]),
    "",
    "Limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].filter((line): line is string => typeof line === "string").join("\n")}\n`;
}

interface LatestJson {
  absolutePath: string;
  relativePath: string;
}

async function latestJson(root: string, directory: string, predicate: (name: string) => boolean): Promise<LatestJson | undefined> {
  const absoluteDir = path.join(root, directory);
  try {
    const names = (await readdir(absoluteDir)).filter((name) => name.endsWith(".json") && predicate(name)).sort();
    const latest = names.at(-1);
    if (!latest) return undefined;
    return {
      absolutePath: path.join(absoluteDir, latest),
      relativePath: path.posix.join(directory.split(path.sep).join("/"), latest)
    };
  } catch {
    return undefined;
  }
}

async function latestOperatorDoctorJson(root: string): Promise<LatestJson | undefined> {
  const directory = ".tmp/plug-and-play-doctor";
  const absoluteDir = path.join(root, directory);
  try {
    const names = (await readdir(absoluteDir))
      .filter((name) => name.endsWith(".json") && name.startsWith("seekr-plug-and-play-doctor-"))
      .sort()
      .reverse();
    for (const name of names) {
      const absolutePath = path.join(absoluteDir, name);
      const manifest = await readJson(absolutePath);
      if (!isRecord(manifest) || manifest.profile === "rehearsal-start-smoke") continue;
      return {
        absolutePath,
        relativePath: path.posix.join(directory, name)
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function readText(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function sourceControlSummary(root: string): Promise<PlugAndPlayReadinessManifest["sourceControl"]> {
  const artifact = await latestJson(root, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
  const manifest = artifact ? await readJson(artifact.absolutePath) : undefined;
  if (!isRecord(manifest)) return {};
  return {
    path: artifact?.relativePath,
    generatedAt: stringOrUndefined(manifest.generatedAt),
    status: stringOrUndefined(manifest.status),
    ready: booleanOrUndefined(manifest.ready),
    localHeadSha: stringOrUndefined(manifest.localHeadSha),
    remoteDefaultBranchSha: stringOrUndefined(manifest.remoteDefaultBranchSha),
    workingTreeClean: booleanOrUndefined(manifest.workingTreeClean),
    workingTreeStatusLineCount: numberOrUndefined(manifest.workingTreeStatusLineCount)
  };
}

async function reviewBundleSummary(root: string): Promise<PlugAndPlayReadinessManifest["reviewBundle"]> {
  const bundle = await latestJson(root, ".tmp/handoff-bundles", (name) => name.startsWith("seekr-handoff-bundle-"));
  const verification = await latestJson(root, ".tmp/handoff-bundles", (name) => name.startsWith("seekr-review-bundle-verification-"));
  const manifest = verification ? await readJson(verification.absolutePath) : undefined;
  const secretScan = isRecord(manifest) && isRecord(manifest.secretScan) ? manifest.secretScan : undefined;
  if (!isRecord(manifest)) {
    return {
      path: bundle?.relativePath,
      verificationPath: verification?.relativePath
    };
  }
  return {
    path: normalizeArtifactPath(root, manifest.sourceBundlePath) ?? bundle?.relativePath,
    verificationPath: verification?.relativePath,
    status: stringOrUndefined(manifest.status),
    checkedFileCount: numberOrUndefined(manifest.checkedFileCount),
    secretScanStatus: isRecord(secretScan) ? stringOrUndefined(secretScan.status) : undefined,
    sourceControlHandoffPath: normalizeArtifactPath(root, manifest.sourceControlHandoffPath),
    sourceControlHandoffLocalHeadSha: stringOrUndefined(manifest.sourceControlHandoffLocalHeadSha),
    sourceControlHandoffRemoteDefaultBranchSha: stringOrUndefined(manifest.sourceControlHandoffRemoteDefaultBranchSha),
    sourceControlHandoffWorkingTreeClean: booleanOrUndefined(manifest.sourceControlHandoffWorkingTreeClean),
    sourceControlHandoffWorkingTreeStatusLineCount: numberOrUndefined(manifest.sourceControlHandoffWorkingTreeStatusLineCount)
  };
}

async function pathExists(filePath: string) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeArtifactPath(root: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const absolutePath = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  const relative = path.relative(root, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

function timeMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function booleanOrUndefined(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function gstackHelperToolEvidenceOk(manifest: Record<string, unknown>) {
  if (manifest.gstackCliAvailable === true) return true;
  const toolRoot = stringOrUndefined(manifest.gstackToolRoot);
  const toolCount = Number(manifest.gstackToolCount);
  const toolNames = Array.isArray(manifest.gstackToolNames)
    ? manifest.gstackToolNames.filter((item): item is string => typeof item === "string" && item.startsWith("gstack-"))
    : [];
  const evidence = Array.isArray(manifest.evidence)
    ? manifest.evidence.filter((item): item is string => typeof item === "string")
    : [];
  const limitations = Array.isArray(manifest.limitations)
    ? manifest.limitations.filter((item): item is string => typeof item === "string")
    : [];
  const evidenceText = evidence.concat(limitations).join(" ");
  return typeof toolRoot === "string" &&
    /gstack/i.test(toolRoot) &&
    Number.isInteger(toolCount) &&
    toolCount > 0 &&
    toolNames.length === toolCount &&
    /helper tool/i.test(evidenceText) &&
    evidenceText.includes(String(toolCount));
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function artifactIdsAreExact(items: Record<string, unknown>[], requiredIds: string[]) {
  return items.length === requiredIds.length &&
    items.every((item, index) => String(item.id ?? "") === requiredIds[index]);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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
  const result = await writePlugAndPlayReadiness({
    outDir: typeof args.out === "string" ? args.out : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.localPlugAndPlayOk,
    complete: result.manifest.complete,
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    ai: result.manifest.ai,
    sourceControl: result.manifest.sourceControl,
    reviewBundle: result.manifest.reviewBundle,
    summary: result.manifest.summary,
    remainingRealWorldBlockerCount: result.manifest.remainingRealWorldBlockerCount,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.localPlugAndPlayOk) process.exitCode = 1;
}
