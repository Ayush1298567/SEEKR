import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { localAiPrepareManifestOk } from "./local-ai-prepare";
import { plugAndPlayDoctorOk, plugAndPlaySetupOk } from "./plug-and-play-artifact-contract";
import { validateRehearsalStartSmokeManifest } from "./rehearsal-start-smoke";
import { EXPECTED_REPOSITORY_URL, REQUIRED_FRESH_CLONE_PATHS, validateSourceControlHandoffManifest } from "./source-control-handoff";
import { REQUIRED_STRICT_AI_SMOKE_CASES, isLocalOllamaUrl } from "../src/server/ai/localAiEvidence";

type FreshCloneOperatorSmokeStatus = "pass" | "fail" | "blocked";

export interface FreshCloneOperatorSmokeCheck {
  id: string;
  status: FreshCloneOperatorSmokeStatus;
  details: string;
  evidence: string[];
}

export interface FreshCloneOperatorSmokeManifest {
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  status: "pass" | "blocked";
  commandUploadEnabled: false;
  repositoryUrl: string;
  cloneCommand: string[];
  installCommand: string[];
  localHeadSha?: string;
  cloneHeadSha?: string;
  plugAndPlaySetupPath?: string;
  localAiPreparePath?: string;
  localAiPrepareModel?: string;
  strictAiSmokeStatusPath?: string;
  strictAiSmokeProvider?: string;
  strictAiSmokeModel?: string;
  strictAiSmokeOllamaUrl?: string;
  strictAiSmokeCaseCount?: number;
  sourceControlHandoffPath?: string;
  sourceControlHandoffStatus?: string;
  sourceControlHandoffReady?: boolean;
  sourceControlHandoffLocalHeadSha?: string;
  sourceControlHandoffRemoteDefaultBranchSha?: string;
  sourceControlHandoffFreshCloneHeadSha?: string;
  sourceControlHandoffFreshCloneInstallDryRunOk?: boolean;
  sourceControlHandoffFreshCloneCheckedPathCount?: number;
  plugAndPlayDoctorPath?: string;
  plugAndPlayDoctorStatus?: string;
  rehearsalStartSmokePath?: string;
  rehearsalStartSmokeStatus?: string;
  checked: string[];
  checks: FreshCloneOperatorSmokeCheck[];
  safetyBoundary: {
    realAircraftCommandUpload: false;
    hardwareActuationEnabled: false;
    runtimePolicyInstalled: false;
  };
  limitations: string[];
}

type ExecFileImpl = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);
const DEFAULT_OUT_DIR = ".tmp/fresh-clone-smoke";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const INSTALL_COMMAND_TEXT = "npm ci --ignore-scripts --no-audit --fund=false --prefer-offline";
const INSTALL_COMMAND = INSTALL_COMMAND_TEXT.split(" ");

export const REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS = [
  "fresh-clone",
  "software-directory",
  "npm-ci",
  "operator-start-smoke",
  "setup-artifact",
  "local-ai-prepare-artifact",
  "strict-ai-smoke",
  "source-control-handoff-artifact",
  "rehearsal-start-smoke-artifact",
  "final-doctor",
  "safety-boundary"
];

export async function buildFreshCloneOperatorSmoke(options: {
  root?: string;
  generatedAt?: string;
  repositoryUrl?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  execFileImpl?: ExecFileImpl;
} = {}): Promise<FreshCloneOperatorSmokeManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const repositoryUrl = options.repositoryUrl ?? EXPECTED_REPOSITORY_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = { ...(options.env ?? process.env), SEEKR_COMMAND_UPLOAD_ENABLED: "false" };
  const execImpl = options.execFileImpl ?? defaultExecFile;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "seekr-fresh-clone-"));
  const cloneDir = path.join(tempDir, "SEEKR");
  const softwareDir = path.join(cloneDir, "software");
  const checks: FreshCloneOperatorSmokeCheck[] = [];

  let localHeadSha: string | undefined;
  let cloneHeadSha: string | undefined;
  let setupPath: string | undefined;
  let setupManifest: unknown;
  let localAiPreparePath: string | undefined;
  let localAiPrepareManifest: unknown;
  let strictAiSmokeStatusPath: string | undefined;
  let strictAiSmokeStatusManifest: unknown;
  let sourceControlHandoffPath: string | undefined;
  let sourceControlHandoffManifest: unknown;
  let doctorPath: string | undefined;
  let doctorManifest: unknown;
  let rehearsalStartSmokePath: string | undefined;
  let rehearsalStartSmokeManifest: unknown;

  try {
    localHeadSha = (await execImpl("git", ["rev-parse", "HEAD"], {
      cwd: root,
      timeout: 10_000,
      env,
      maxBuffer: 1024 * 1024
    })).stdout.trim() || undefined;
  } catch {
    localHeadSha = undefined;
  }

  try {
    checks.push(await runCheck("fresh-clone", `Clone ${repositoryUrl} with --depth 1.`, async () => {
      await execImpl("git", ["clone", "--depth", "1", repositoryUrl, cloneDir], {
        cwd: tempDir,
        timeout: timeoutMs,
        env,
        maxBuffer: 4 * 1024 * 1024
      });
      cloneHeadSha = (await execImpl("git", ["rev-parse", "HEAD"], {
        cwd: cloneDir,
        timeout: 10_000,
        env,
        maxBuffer: 1024 * 1024
      })).stdout.trim() || undefined;
      return {
        details: cloneHeadSha
          ? `Fresh clone completed at ${cloneHeadSha}.`
          : "Fresh clone completed.",
        evidence: ["git clone --depth 1", repositoryUrl, cloneHeadSha ? `HEAD:${cloneHeadSha}` : "git rev-parse HEAD"]
      };
    }));

    checks.push(await runCheck("software-directory", "Verify the cloned software workspace exists.", async () => {
      await stat(softwareDir);
      await stat(path.join(softwareDir, "package.json"));
      await stat(path.join(softwareDir, "package-lock.json"));
      return {
        details: "Fresh clone contains the software workspace, package manifest, and lockfile.",
        evidence: ["software/", "software/package.json", "software/package-lock.json"]
      };
    }));

    checks.push(await runCheck("npm-ci", "Install fresh-clone dependencies from the lockfile.", async () => {
      await execImpl(INSTALL_COMMAND[0], INSTALL_COMMAND.slice(1), {
        cwd: softwareDir,
        timeout: timeoutMs,
        env,
        maxBuffer: 8 * 1024 * 1024
      });
      return {
        details: `${INSTALL_COMMAND_TEXT} completed in the fresh clone.`,
        evidence: [INSTALL_COMMAND_TEXT, "software/package-lock.json"]
      };
    }));

    checks.push(await runCheck("operator-start-smoke", "Run the bounded one-command operator-start smoke in the fresh clone.", async () => {
      await execImpl("npm", ["run", "smoke:rehearsal:start"], {
        cwd: softwareDir,
        timeout: timeoutMs,
        env,
        maxBuffer: 8 * 1024 * 1024
      });
      return {
        details: "Fresh clone bounded operator-start smoke passed.",
        evidence: ["npm run smoke:rehearsal:start"]
      };
    }));

    const setupArtifact = await latestJson(softwareDir, ".tmp/plug-and-play-setup", (name) => name.startsWith("seekr-local-setup-"));
    setupPath = setupArtifact?.relativePath;
    setupManifest = setupArtifact ? await readJson(setupArtifact.absolutePath) : undefined;
    checks.push(semanticCheck("setup-artifact", "Fresh clone smoke must create passing setup evidence.", plugAndPlaySetupOk(setupManifest), setupPath ?? ".tmp/plug-and-play-setup"));

    const localAiPrepareArtifact = await latestJson(softwareDir, ".tmp/local-ai-prepare", (name) => name.startsWith("seekr-local-ai-prepare-"));
    localAiPreparePath = localAiPrepareArtifact?.relativePath;
    localAiPrepareManifest = localAiPrepareArtifact ? await readJson(localAiPrepareArtifact.absolutePath) : undefined;
    checks.push(semanticCheck("local-ai-prepare-artifact", "Fresh clone smoke must create passing local AI prepare evidence.", localAiPrepareManifestOk(localAiPrepareManifest), localAiPreparePath ?? ".tmp/local-ai-prepare"));

    checks.push(await runCheck("strict-ai-smoke", "Run strict local AI smoke in the fresh clone.", async () => {
      await execImpl("npm", ["run", "test:ai:local"], {
        cwd: softwareDir,
        timeout: timeoutMs,
        env,
        maxBuffer: 8 * 1024 * 1024
      });
      strictAiSmokeStatusPath = ".tmp/ai-smoke-status.json";
      strictAiSmokeStatusManifest = await readJson(path.join(softwareDir, strictAiSmokeStatusPath));
      if (!strictAiSmokeStatusOk(strictAiSmokeStatusManifest, localAiPrepareManifest)) {
        throw new Error("fresh-clone strict local AI smoke evidence does not satisfy the command-boundary contract");
      }
      return {
        details: "Fresh clone strict local AI smoke passed with Ollama, required safety cases, and commandUploadEnabled false.",
        evidence: ["npm run test:ai:local", strictAiSmokeStatusPath]
      };
    }));

    const sourceControlArtifact = await latestJson(softwareDir, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
    sourceControlHandoffPath = sourceControlArtifact?.relativePath;
    sourceControlHandoffManifest = sourceControlArtifact ? await readJson(sourceControlArtifact.absolutePath) : undefined;
    const sourceControlValidation = validateSourceControlHandoffManifest(sourceControlHandoffManifest);
    checks.push(semanticCheck(
      "source-control-handoff-artifact",
      "Fresh clone smoke must create safe source-control handoff evidence.",
      sourceControlValidation.ok && sourceControlValidation.ready,
      sourceControlHandoffPath ?? ".tmp/source-control-handoff",
      sourceControlValidation.ok ? undefined : sourceControlValidation.problems.join("; ")
    ));

    const smokeArtifact = await latestJson(softwareDir, ".tmp/rehearsal-start-smoke", (name) => name.startsWith("seekr-rehearsal-start-smoke-"));
    rehearsalStartSmokePath = smokeArtifact?.relativePath;
    rehearsalStartSmokeManifest = smokeArtifact ? await readJson(smokeArtifact.absolutePath) : undefined;
    const smokeValidation = validateRehearsalStartSmokeManifest(rehearsalStartSmokeManifest);
    checks.push(semanticCheck(
      "rehearsal-start-smoke-artifact",
      "Fresh clone smoke must persist exact-row rehearsal-start evidence.",
      smokeValidation.ok,
      rehearsalStartSmokePath ?? ".tmp/rehearsal-start-smoke",
      smokeValidation.ok ? undefined : smokeValidation.problems.join("; ")
    ));

    checks.push(await runCheck("final-doctor", "Rerun standalone operator-start doctor after the bounded smoke.", async () => {
      await execImpl("npm", ["run", "doctor"], {
        cwd: softwareDir,
        timeout: timeoutMs,
        env,
        maxBuffer: 8 * 1024 * 1024
      });
      const artifact = await latestJson(softwareDir, ".tmp/plug-and-play-doctor", (name) => name.startsWith("seekr-plug-and-play-doctor-"));
      doctorPath = artifact?.relativePath;
      doctorManifest = artifact ? await readJson(artifact.absolutePath) : undefined;
      if (!plugAndPlayDoctorOk(doctorManifest, undefined, sourceControlHandoffPath)) {
        throw new Error("latest fresh-clone operator-start doctor does not satisfy the shared artifact contract");
      }
      return {
        details: "Fresh clone standalone operator-start doctor passed after smoke.",
        evidence: ["npm run doctor", doctorPath ?? ".tmp/plug-and-play-doctor"]
      };
    }));

    const safetyOk = [
      setupManifest,
      localAiPrepareManifest,
      strictAiSmokeStatusManifest,
      sourceControlHandoffManifest,
      doctorManifest,
      rehearsalStartSmokeManifest
    ].every((manifest) => isRecord(manifest) && manifest.commandUploadEnabled === false) &&
      (!localHeadSha || !cloneHeadSha || localHeadSha === cloneHeadSha);
    checks.push(semanticCheck(
      "safety-boundary",
      "Fresh clone proof must preserve disabled command upload and use the published local HEAD.",
      safetyOk,
      ".tmp/fresh-clone-smoke",
      localHeadSha && cloneHeadSha && localHeadSha !== cloneHeadSha
        ? `fresh clone HEAD ${cloneHeadSha} does not match local HEAD ${localHeadSha}`
        : undefined
    ));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  const ok = checks.length === REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS.length &&
    checks.every((check, index) => check.id === REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS[index] && check.status === "pass");
  const sourceControl = isRecord(sourceControlHandoffManifest) ? sourceControlHandoffManifest : undefined;
  const localAi = isRecord(localAiPrepareManifest) ? localAiPrepareManifest : undefined;
  const strictAiSmoke = isRecord(strictAiSmokeStatusManifest) ? strictAiSmokeStatusManifest : undefined;
  const doctor = isRecord(doctorManifest) ? doctorManifest : undefined;
  const smoke = isRecord(rehearsalStartSmokeManifest) ? rehearsalStartSmokeManifest : undefined;

  return {
    schemaVersion: 1,
    generatedAt,
    ok,
    status: ok ? "pass" : "blocked",
    commandUploadEnabled: false,
    repositoryUrl,
    cloneCommand: ["git", "clone", "--depth", "1", repositoryUrl],
    installCommand: INSTALL_COMMAND,
    localHeadSha,
    cloneHeadSha,
    plugAndPlaySetupPath: setupPath,
    localAiPreparePath,
    localAiPrepareModel: typeof localAi?.model === "string" ? localAi.model : undefined,
    strictAiSmokeStatusPath,
    strictAiSmokeProvider: typeof strictAiSmoke?.provider === "string" ? strictAiSmoke.provider : undefined,
    strictAiSmokeModel: typeof strictAiSmoke?.model === "string" ? strictAiSmoke.model : undefined,
    strictAiSmokeOllamaUrl: typeof strictAiSmoke?.ollamaUrl === "string" ? strictAiSmoke.ollamaUrl : undefined,
    strictAiSmokeCaseCount: typeof strictAiSmoke?.caseCount === "number" ? strictAiSmoke.caseCount : undefined,
    sourceControlHandoffPath,
    sourceControlHandoffStatus: typeof sourceControl?.status === "string" ? sourceControl.status : undefined,
    sourceControlHandoffReady: typeof sourceControl?.ready === "boolean" ? sourceControl.ready : undefined,
    sourceControlHandoffLocalHeadSha: typeof sourceControl?.localHeadSha === "string" ? sourceControl.localHeadSha : undefined,
    sourceControlHandoffRemoteDefaultBranchSha: typeof sourceControl?.remoteDefaultBranchSha === "string" ? sourceControl.remoteDefaultBranchSha : undefined,
    sourceControlHandoffFreshCloneHeadSha: typeof sourceControl?.freshCloneHeadSha === "string" ? sourceControl.freshCloneHeadSha : undefined,
    sourceControlHandoffFreshCloneInstallDryRunOk: typeof sourceControl?.freshCloneInstallDryRunOk === "boolean" ? sourceControl.freshCloneInstallDryRunOk : undefined,
    sourceControlHandoffFreshCloneCheckedPathCount: typeof sourceControl?.freshCloneCheckedPathCount === "number" ? sourceControl.freshCloneCheckedPathCount : undefined,
    plugAndPlayDoctorPath: doctorPath,
    plugAndPlayDoctorStatus: typeof doctor?.status === "string" ? doctor.status : undefined,
    rehearsalStartSmokePath,
    rehearsalStartSmokeStatus: typeof smoke?.status === "string" ? smoke.status : undefined,
    checked: checks.map((check) => check.id),
    checks,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    limitations: [
      "This smoke proves a fresh GitHub clone can install dependencies and run the local operator-start software path.",
      "It uses local fixtures and local Ollama readiness only; it does not validate actual Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware-actuation policy approval.",
      "Real command upload and hardware actuation remain disabled."
    ]
  };
}

export async function writeFreshCloneOperatorSmoke(options: Parameters<typeof buildFreshCloneOperatorSmoke>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildFreshCloneOperatorSmoke(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-fresh-clone-smoke-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

export function freshCloneOperatorSmokeOk(manifest: unknown, acceptance?: unknown) {
  if (!isRecord(manifest)) return false;
  const checks = Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  const checked = Array.isArray(manifest.checked) ? manifest.checked.map(String) : [];
  const exactCheckOrder = checked.length === REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS.length &&
    REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS.every((id, index) => checked[index] === id) &&
    checks.length === REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS.length &&
    REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS.every((id, index) => checks[index]?.id === id && checks[index]?.status === "pass");
  const localHeadSha = typeof manifest.localHeadSha === "string" ? manifest.localHeadSha : undefined;
  const cloneHeadSha = typeof manifest.cloneHeadSha === "string" ? manifest.cloneHeadSha : undefined;
  const sourceControlLocalHeadSha = typeof manifest.sourceControlHandoffLocalHeadSha === "string" ? manifest.sourceControlHandoffLocalHeadSha : undefined;
  const sourceControlRemoteDefaultBranchSha = typeof manifest.sourceControlHandoffRemoteDefaultBranchSha === "string" ? manifest.sourceControlHandoffRemoteDefaultBranchSha : undefined;
  const sourceControlFreshCloneHeadSha = typeof manifest.sourceControlHandoffFreshCloneHeadSha === "string" ? manifest.sourceControlHandoffFreshCloneHeadSha : undefined;
  const sourceControlFreshCloneCheckedPathCount = Number(manifest.sourceControlHandoffFreshCloneCheckedPathCount);
  const acceptanceStrictAi = isRecord(acceptance) && isRecord(acceptance.strictLocalAi) ? acceptance.strictLocalAi : undefined;
  const acceptanceModel = typeof acceptanceStrictAi?.model === "string" ? acceptanceStrictAi.model : undefined;
  const modelMatches = !acceptanceModel || manifest.localAiPrepareModel === acceptanceModel;
  const strictAiModelMatches = !acceptanceModel || manifest.strictAiSmokeModel === acceptanceModel;
  const acceptanceGeneratedAt = isRecord(acceptance) ? timeMs(acceptance.generatedAt) : undefined;
  const generatedAt = timeMs(manifest.generatedAt);
  const freshForAcceptance = acceptanceGeneratedAt === undefined || (generatedAt !== undefined && generatedAt >= acceptanceGeneratedAt);

  return manifest.ok === true &&
    manifest.status === "pass" &&
    manifest.commandUploadEnabled === false &&
    manifest.repositoryUrl === EXPECTED_REPOSITORY_URL &&
    exactCheckOrder &&
    typeof manifest.plugAndPlaySetupPath === "string" &&
    typeof manifest.localAiPreparePath === "string" &&
    typeof manifest.strictAiSmokeStatusPath === "string" &&
    manifest.strictAiSmokeProvider === "ollama" &&
    typeof manifest.strictAiSmokeModel === "string" &&
    isLocalOllamaUrl(manifest.strictAiSmokeOllamaUrl) &&
    Number(manifest.strictAiSmokeCaseCount) === REQUIRED_STRICT_AI_SMOKE_CASES.length &&
    typeof manifest.sourceControlHandoffPath === "string" &&
    typeof manifest.plugAndPlayDoctorPath === "string" &&
    typeof manifest.rehearsalStartSmokePath === "string" &&
    typeof sourceControlLocalHeadSha === "string" &&
    typeof sourceControlRemoteDefaultBranchSha === "string" &&
    typeof sourceControlFreshCloneHeadSha === "string" &&
    manifest.sourceControlHandoffFreshCloneInstallDryRunOk === true &&
    Number.isInteger(sourceControlFreshCloneCheckedPathCount) &&
    sourceControlFreshCloneCheckedPathCount >= REQUIRED_FRESH_CLONE_PATHS.length &&
    (!localHeadSha || !cloneHeadSha || localHeadSha === cloneHeadSha) &&
    (!cloneHeadSha || sourceControlLocalHeadSha === cloneHeadSha) &&
    (!cloneHeadSha || sourceControlRemoteDefaultBranchSha === cloneHeadSha) &&
    (!cloneHeadSha || sourceControlFreshCloneHeadSha === cloneHeadSha) &&
    modelMatches &&
    strictAiModelMatches &&
    freshForAcceptance &&
    safetyBoundaryFalse(manifest);
}

function strictAiSmokeStatusOk(manifest: unknown, localAiPrepare: unknown) {
  if (!isRecord(manifest)) return false;
  const cases = Array.isArray(manifest.cases) ? manifest.cases.filter(isRecord) : [];
  const caseNames = cases.map((testCase) => String(testCase.name ?? ""));
  const localAiModel = isRecord(localAiPrepare) && typeof localAiPrepare.model === "string" ? localAiPrepare.model : undefined;
  return manifest.ok === true &&
    manifest.commandUploadEnabled === false &&
    manifest.provider === "ollama" &&
    manifest.requireOllama === true &&
    typeof manifest.model === "string" &&
    (!localAiModel || manifest.model === localAiModel) &&
    isLocalOllamaUrl(manifest.ollamaUrl) &&
    Number(manifest.caseCount) === REQUIRED_STRICT_AI_SMOKE_CASES.length &&
    cases.length === REQUIRED_STRICT_AI_SMOKE_CASES.length &&
    arraysEqual(caseNames, [...REQUIRED_STRICT_AI_SMOKE_CASES]) &&
    cases.every((testCase) =>
      testCase.provider === "ollama" &&
      testCase.model === manifest.model &&
      typeof testCase.planKind === "string" &&
      testCase.planKind.length > 0 &&
      testCase.planKind !== "hold-drone" &&
      testCase.validatorOk === true &&
      testCase.unsafeOperatorTextPresent === false &&
      testCase.mutatedWhileThinking === false
    );
}

function semanticCheck(id: string, requirement: string, ok: boolean, evidencePath: string, problem?: string): FreshCloneOperatorSmokeCheck {
  return {
    id,
    status: ok ? "pass" : "fail",
    details: ok ? requirement : problem ? `${requirement} ${problem}` : `${requirement} Semantic validation failed.`,
    evidence: [evidencePath]
  };
}

async function runCheck(
  id: string,
  requirement: string,
  fn: () => Promise<{ details: string; evidence: string[] }>
): Promise<FreshCloneOperatorSmokeCheck> {
  try {
    const result = await fn();
    return {
      id,
      status: "pass",
      details: result.details,
      evidence: result.evidence
    };
  } catch (error) {
    return {
      id,
      status: "fail",
      details: `${requirement} ${compactError(error) || "Command failed."}`,
      evidence: [requirement]
    };
  }
}

async function defaultExecFile(
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number }
) {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    env: options.env,
    maxBuffer: options.maxBuffer,
    encoding: "utf8"
  });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

async function latestJson(root: string, relativeDir: string, predicate: (name: string) => boolean) {
  const directory = path.join(root, relativeDir);
  try {
    const names = (await readdir(directory))
      .filter((name) => name.endsWith(".json") && predicate(name))
      .sort((left, right) => left.localeCompare(right));
    const name = names.at(-1);
    if (!name) return undefined;
    return {
      relativePath: path.join(relativeDir, name).split(path.sep).join("/"),
      absolutePath: path.join(directory, name)
    };
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

function renderMarkdown(manifest: FreshCloneOperatorSmokeManifest) {
  const lines = [
    "# SEEKR Fresh Clone Operator Smoke",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `Command upload enabled: ${manifest.commandUploadEnabled}`,
    `Repository: ${manifest.repositoryUrl}`,
    manifest.localHeadSha ? `Local HEAD: ${manifest.localHeadSha}` : undefined,
    manifest.cloneHeadSha ? `Fresh clone HEAD: ${manifest.cloneHeadSha}` : undefined,
    manifest.plugAndPlaySetupPath ? `Plug-and-play setup: ${manifest.plugAndPlaySetupPath}` : undefined,
    manifest.localAiPreparePath ? `Local AI prepare: ${manifest.localAiPreparePath}` : undefined,
    manifest.localAiPrepareModel ? `Local AI model: ${manifest.localAiPrepareModel}` : undefined,
    manifest.strictAiSmokeStatusPath ? `Strict AI smoke: ${manifest.strictAiSmokeStatusPath}` : undefined,
    manifest.strictAiSmokeProvider ? `Strict AI provider: ${manifest.strictAiSmokeProvider}` : undefined,
    manifest.strictAiSmokeModel ? `Strict AI model: ${manifest.strictAiSmokeModel}` : undefined,
    manifest.strictAiSmokeOllamaUrl ? `Strict AI Ollama URL: ${manifest.strictAiSmokeOllamaUrl}` : undefined,
    typeof manifest.strictAiSmokeCaseCount === "number" ? `Strict AI smoke cases: ${manifest.strictAiSmokeCaseCount}` : undefined,
    manifest.sourceControlHandoffPath ? `Source-control handoff: ${manifest.sourceControlHandoffPath}` : undefined,
    manifest.sourceControlHandoffLocalHeadSha ? `Source-control local HEAD: ${manifest.sourceControlHandoffLocalHeadSha}` : undefined,
    manifest.sourceControlHandoffRemoteDefaultBranchSha ? `Source-control remote default SHA: ${manifest.sourceControlHandoffRemoteDefaultBranchSha}` : undefined,
    manifest.sourceControlHandoffFreshCloneHeadSha ? `Source-control fresh-clone HEAD: ${manifest.sourceControlHandoffFreshCloneHeadSha}` : undefined,
    typeof manifest.sourceControlHandoffFreshCloneInstallDryRunOk === "boolean" ? `Source-control fresh-clone npm ci dry-run: ${manifest.sourceControlHandoffFreshCloneInstallDryRunOk}` : undefined,
    typeof manifest.sourceControlHandoffFreshCloneCheckedPathCount === "number" ? `Source-control fresh-clone checked paths: ${manifest.sourceControlHandoffFreshCloneCheckedPathCount}` : undefined,
    manifest.plugAndPlayDoctorPath ? `Plug-and-play doctor: ${manifest.plugAndPlayDoctorPath}` : undefined,
    manifest.rehearsalStartSmokePath ? `Rehearsal-start smoke: ${manifest.rehearsalStartSmokePath}` : undefined,
    "",
    "## Checks",
    "",
    "| Check | Status | Details | Evidence |",
    "| --- | --- | --- | --- |",
    ...manifest.checks.map((check) => `| ${check.id} | ${check.status} | ${check.details} | ${check.evidence.join(", ")} |`),
    "",
    "## Limitations",
    "",
    ...manifest.limitations.map((item) => `- ${item}`),
    ""
  ].filter((line): line is string => typeof line === "string");
  return `${lines.join("\n")}\n`;
}

function compactError(error: unknown) {
  const record = isRecord(error) ? error : {};
  return [
    record.message,
    record.stdout,
    record.stderr
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" ")
    .slice(0, 1200);
}

function safetyBoundaryFalse(manifest: Record<string, unknown>) {
  const safety = isRecord(manifest.safetyBoundary) ? manifest.safetyBoundary : {};
  return safety.realAircraftCommandUpload === false &&
    safety.hardwareActuationEnabled === false &&
    safety.runtimePolicyInstalled === false;
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function timeMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  writeFreshCloneOperatorSmoke().then((result) => {
    console.log(JSON.stringify({
      ok: result.manifest.ok,
      status: result.manifest.status,
      commandUploadEnabled: result.manifest.commandUploadEnabled,
      repositoryUrl: result.manifest.repositoryUrl,
      cloneHeadSha: result.manifest.cloneHeadSha,
      localHeadSha: result.manifest.localHeadSha,
      checked: result.manifest.checked,
      localAiPrepareModel: result.manifest.localAiPrepareModel,
      strictAiSmokeStatusPath: result.manifest.strictAiSmokeStatusPath,
      strictAiSmokeProvider: result.manifest.strictAiSmokeProvider,
      strictAiSmokeModel: result.manifest.strictAiSmokeModel,
      strictAiSmokeOllamaUrl: result.manifest.strictAiSmokeOllamaUrl,
      strictAiSmokeCaseCount: result.manifest.strictAiSmokeCaseCount,
      sourceControlHandoffStatus: result.manifest.sourceControlHandoffStatus,
      sourceControlHandoffLocalHeadSha: result.manifest.sourceControlHandoffLocalHeadSha,
      sourceControlHandoffRemoteDefaultBranchSha: result.manifest.sourceControlHandoffRemoteDefaultBranchSha,
      sourceControlHandoffFreshCloneHeadSha: result.manifest.sourceControlHandoffFreshCloneHeadSha,
      sourceControlHandoffFreshCloneInstallDryRunOk: result.manifest.sourceControlHandoffFreshCloneInstallDryRunOk,
      sourceControlHandoffFreshCloneCheckedPathCount: result.manifest.sourceControlHandoffFreshCloneCheckedPathCount,
      jsonPath: result.jsonPath,
      markdownPath: result.markdownPath
    }, null, 2));
    if (!result.manifest.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
