import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";
import { buildHandoffVerification } from "./handoff-verify";
import { localAiPrepareManifestOk } from "./local-ai-prepare";
import { OPERATOR_QUICKSTART_PATH, operatorQuickstartProblems } from "./operator-quickstart-contract";
import { plugAndPlayDoctorOk, plugAndPlaySetupOk } from "./plug-and-play-artifact-contract";
import { validateRehearsalStartSmokeManifest } from "./rehearsal-start-smoke";
import { validateSourceControlHandoffManifest } from "./source-control-handoff";
import { REQUIRED_STRICT_AI_SMOKE_CASES, isLocalOllamaUrl } from "../src/server/ai/localAiEvidence";

type BundleStatus = "ready-local-alpha-review-bundle" | "blocked";

export interface HandoffBundleFile {
  sourcePath: string;
  bundlePath: string;
  bytes: number;
  sha256: string;
}

export interface HandoffBundleManifest {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  status: BundleStatus;
  commandUploadEnabled: false;
  sourceIndexPath?: string;
  sourceIndexGeneratedAt?: string;
  sourceIndexStatus?: string;
  sourceIndexComplete: boolean;
  gstackWorkflowStatusPath?: string;
  gstackWorkflowStatusGeneratedAt?: string;
  gstackWorkflowStatus?: string;
  gstackQaReportPath?: string;
  gstackQaReportGeneratedAt?: string;
  gstackQaReportStatus?: string;
  gstackQaScreenshotPaths: string[];
  todoAuditPath?: string;
  todoAuditGeneratedAt?: string;
  todoAuditStatus?: string;
  sourceControlHandoffPath?: string;
  sourceControlHandoffGeneratedAt?: string;
  sourceControlHandoffStatus?: string;
  sourceControlHandoffReady?: boolean;
  sourceControlHandoffRepositoryUrl?: string;
  sourceControlHandoffPackageRepositoryUrl?: string;
  sourceControlHandoffConfiguredRemoteUrls: string[];
  sourceControlHandoffLocalHeadSha?: string;
  sourceControlHandoffRemoteDefaultBranchSha?: string;
  sourceControlHandoffWorkingTreeClean?: boolean;
  sourceControlHandoffWorkingTreeStatusLineCount?: number;
  plugAndPlaySetupPath?: string;
  plugAndPlaySetupGeneratedAt?: string;
  plugAndPlaySetupStatus?: string;
  localAiPreparePath?: string;
  localAiPrepareGeneratedAt?: string;
  localAiPrepareStatus?: string;
  localAiPrepareModel?: string;
  plugAndPlayDoctorPath?: string;
  plugAndPlayDoctorGeneratedAt?: string;
  plugAndPlayDoctorStatus?: string;
  rehearsalStartSmokePath?: string;
  rehearsalStartSmokeGeneratedAt?: string;
  rehearsalStartSmokeStatus?: string;
  strictAiSmokeStatusPath?: string;
  strictAiSmokeGeneratedAt?: number;
  strictAiSmokeProvider?: string;
  strictAiSmokeModel?: string;
  strictAiSmokeOllamaUrl?: string;
  strictAiSmokeCaseCount?: number;
  operatorQuickstartPath?: string;
  copiedFileCount: number;
  bundleDirectory: string;
  files: HandoffBundleFile[];
  safetyBoundary: {
    realAircraftCommandUpload: false;
    hardwareActuationEnabled: false;
    runtimePolicyInstalled: false;
  };
  hardwareClaims: {
    jetsonOrinNanoValidated: false;
    raspberryPi5Validated: false;
    realMavlinkBenchValidated: false;
    realRos2BenchValidated: false;
    hilFailsafeValidated: false;
    isaacJetsonCaptureValidated: false;
    hardwareActuationAuthorized: false;
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  realWorldBlockers: string[];
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/handoff-bundles";
const HANDOFF_INDEX_DIR = ".tmp/handoff-index";
const GSTACK_WORKFLOW_STATUS_DIR = ".tmp/gstack-workflow-status";
const TODO_AUDIT_DIR = ".tmp/todo-audit";
const SOURCE_CONTROL_HANDOFF_DIR = ".tmp/source-control-handoff";
const PLUG_AND_PLAY_SETUP_DIR = ".tmp/plug-and-play-setup";
const LOCAL_AI_PREPARE_DIR = ".tmp/local-ai-prepare";
const PLUG_AND_PLAY_DOCTOR_DIR = ".tmp/plug-and-play-doctor";
const REHEARSAL_START_SMOKE_DIR = ".tmp/rehearsal-start-smoke";
const STRICT_AI_SMOKE_STATUS_PATH = ".tmp/ai-smoke-status.json";
const REQUIRED_WORKFLOW_IDS = ["health", "review", "planning", "qa"];
const REQUIRED_PERSPECTIVE_IDS = ["operator", "safety", "dx", "replay", "demo-readiness"];
const REQUIRED_TODO_CATEGORY_IDS = [
  "fresh-operator-field-laptop",
  "jetson-orin-nano-readiness",
  "raspberry-pi-5-readiness",
  "real-mavlink-telemetry",
  "real-ros2-topics",
  "hil-failsafe-manual-override",
  "isaac-sim-jetson-capture",
  "hardware-actuation-policy-review"
];

export async function writeHandoffBundle(options: {
  root?: string;
  generatedAt?: string;
  label?: string;
  indexPath?: string;
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label ?? "internal-alpha";
  const safeTimestamp = safeIsoTimestampForFileName(generatedAt);
  const safeLabel = safeFileNamePart(label, "internal-alpha");
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const bundleDirectory = path.join(outDir, `seekr-handoff-bundle-${safeLabel}-${safeTimestamp}`);
  const artifactsDir = path.join(bundleDirectory, "artifacts");
  const index = await resolveIndex(root, options.indexPath);
  const indexManifest = index ? await readJson(index.absolutePath) : undefined;
  const gstackWorkflow = await latestJson(root, GSTACK_WORKFLOW_STATUS_DIR, (name) => name.startsWith("seekr-gstack-workflow-status-"));
  const gstackWorkflowManifest = gstackWorkflow ? await readJson(gstackWorkflow.absolutePath) : undefined;
  const gstackQaReport = gstackQaReportFrom(gstackWorkflowManifest);
  const todoAudit = await latestJson(root, TODO_AUDIT_DIR, (name) => name.startsWith("seekr-todo-audit-"));
  const todoAuditManifest = todoAudit ? await readJson(todoAudit.absolutePath) : undefined;
  const sourceControl = await latestJson(root, SOURCE_CONTROL_HANDOFF_DIR, (name) => name.startsWith("seekr-source-control-handoff-"));
  const sourceControlManifest = sourceControl ? await readJson(sourceControl.absolutePath) : undefined;
  const setup = await latestJson(root, PLUG_AND_PLAY_SETUP_DIR, (name) => name.startsWith("seekr-local-setup-"));
  const setupManifest = setup ? await readJson(setup.absolutePath) : undefined;
  const localAiPrepare = await latestJson(root, LOCAL_AI_PREPARE_DIR, (name) => name.startsWith("seekr-local-ai-prepare-"));
  const localAiPrepareManifest = localAiPrepare ? await readJson(localAiPrepare.absolutePath) : undefined;
  const doctor = await latestOperatorDoctorJson(root);
  const doctorManifest = doctor ? await readJson(doctor.absolutePath) : undefined;
  const rehearsalStartSmoke = await latestJson(root, REHEARSAL_START_SMOKE_DIR, (name) => name.startsWith("seekr-rehearsal-start-smoke-"));
  const rehearsalStartSmokeManifest = rehearsalStartSmoke ? await readJson(rehearsalStartSmoke.absolutePath) : undefined;
  const strictAiSmokePath = await pathExists(path.join(root, STRICT_AI_SMOKE_STATUS_PATH))
    ? STRICT_AI_SMOKE_STATUS_PATH
    : undefined;
  const strictAiSmokeManifest = strictAiSmokePath ? await readJson(path.join(root, strictAiSmokePath)) : undefined;
  const operatorQuickstart = await readText(path.join(root, OPERATOR_QUICKSTART_PATH));
  const acceptanceManifest = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const verification = await buildHandoffVerification({
    root,
    generatedAt,
    indexPath: index?.relativePath ?? options.indexPath
  });

  const blockers = [...verification.validation.blockers];
  const warnings = [...verification.validation.warnings];
  const files: HandoffBundleFile[] = [];

  if (!index) blockers.unshift("No handoff index JSON evidence exists.");
  if (index && !isInsideRoot(root, index.absolutePath)) blockers.unshift(`Handoff index path escapes root: ${index.relativePath}`);
  if (!gstackWorkflow) {
    blockers.push("No gstack workflow status artifact exists; run npm run audit:gstack before bundling for final internal-alpha review.");
  } else if (!(await gstackWorkflowStatusOk(root, gstackWorkflowManifest))) {
    blockers.push("GStack workflow status artifact must pass or pass-with-limitations, use pass-with-limitations for limitation-only evidence, preserve manifest-level limitation details, preserve limitation details for stale or missing health/QA evidence, record gstack availability, preserve helper-tool evidence when the umbrella CLI is unavailable, include required Git review evidence paths when Git metadata is present or no-Git workspace limitations when absent, preserve perspective status/score/nextAction details, and keep commandUploadEnabled false before bundling.");
  }
  if (!todoAudit) {
    blockers.push("No TODO audit artifact exists; run npm run audit:todo before bundling for final internal-alpha review.");
  } else if (!todoAuditOk(todoAuditManifest)) {
    blockers.push("TODO audit artifact must pass with commandUploadEnabled false before bundling.");
  }
  if (!sourceControl) {
    blockers.push("No source-control handoff artifact exists; run npm run audit:source-control before bundling for final internal-alpha review.");
  } else if (!sourceControlHandoffOk(sourceControlManifest)) {
    blockers.push("Source-control handoff artifact must be read-only, name the SEEKR GitHub repository, include local Git and remote-ref checks, and keep commandUploadEnabled false before bundling.");
  } else if (!sourceControlHandoffFreshForAcceptance(sourceControlManifest, acceptanceManifest)) {
    blockers.push("Ready source-control handoff artifact must be newer than or equal to the latest acceptance record before bundling.");
  } else if (isRecord(sourceControlManifest) && sourceControlManifest.ready !== true) {
    warnings.push("Source-control handoff is not ready for publication yet; review bundle preserves the local Git/GitHub limitation without blocking local alpha.");
  }
  if (!setup) {
    blockers.push("No plug-and-play setup artifact exists; run npm run setup:local before bundling for final internal-alpha review.");
  } else if (!plugAndPlaySetupOk(setupManifest)) {
    blockers.push("Plug-and-play setup artifact must pass with local env/data preparation and commandUploadEnabled false before bundling.");
  }
  if (!localAiPrepare) {
    blockers.push("No local AI prepare artifact exists; run npm run ai:prepare before bundling for final internal-alpha review.");
  } else if (!localAiPrepareManifestOk(localAiPrepareManifest)) {
    blockers.push("Local AI prepare artifact must prove a passing Ollama model preparation run with commandUploadEnabled false before bundling.");
  }
  if (!doctor) {
    blockers.push("No operator-start plug-and-play doctor artifact exists; run npm run doctor before bundling for final internal-alpha review.");
  } else if (!plugAndPlayDoctorOk(doctorManifest, acceptanceManifest, sourceControl?.relativePath)) {
    blockers.push("Plug-and-play doctor artifact must pass with repository-safety, matching source-control handoff recording, start-wrapper validation, local Ollama, startup ports, data directory, commandUploadEnabled false, and freshness against acceptance before bundling.");
  }
  if (!rehearsalStartSmoke) {
    blockers.push("No rehearsal-start smoke artifact exists; run npm run smoke:rehearsal:start before bundling for final internal-alpha review.");
  } else if (!rehearsalStartSmokeOk(rehearsalStartSmokeManifest)) {
    blockers.push("Rehearsal-start smoke artifact must pass API/client startup, source-health, readiness, clean shutdown, and commandUploadEnabled false before bundling.");
  }
  if (!strictAiSmokePath) {
    blockers.push("No strict local AI smoke status exists; run npm run test:ai:local before bundling for final internal-alpha review.");
  } else if (!strictAiSmokeStatusOk(strictAiSmokeManifest, acceptanceManifest)) {
    blockers.push("Strict local AI smoke status must match copied acceptance, use a loopback Ollama URL, require the exact strict AI scenario set, include per-case planKind and validatorOk proof, avoid hold-drone plans, avoid unsafe operator-facing text, avoid state mutation while thinking, and keep command upload disabled.");
  }
  const operatorQuickstartMissingSignals = operatorQuickstartProblems(operatorQuickstart);
  if (operatorQuickstartMissingSignals.length) {
    blockers.push(`Operator quickstart is missing required plug-and-play signal(s): ${operatorQuickstartMissingSignals.join(", ")}.`);
  }

  if (blockers.length === 0 && index) {
    const sourcePaths = bundleSourcePaths(
      index.relativePath,
      verification.digests.map((digest) => digest.path),
      [
        ...(gstackWorkflow ? [gstackWorkflow.relativePath, replaceExtension(gstackWorkflow.relativePath, ".md")] : []),
        ...(gstackQaReport?.path ? [gstackQaReport.path, ...gstackQaReport.screenshotPaths] : []),
        ...(todoAudit ? [todoAudit.relativePath, replaceExtension(todoAudit.relativePath, ".md")] : []),
        ...(sourceControl ? [sourceControl.relativePath, replaceExtension(sourceControl.relativePath, ".md")] : []),
        ...(setup ? [setup.relativePath, replaceExtension(setup.relativePath, ".md")] : []),
        ...(localAiPrepare ? [localAiPrepare.relativePath, replaceExtension(localAiPrepare.relativePath, ".md")] : []),
        ...(doctor ? [doctor.relativePath, replaceExtension(doctor.relativePath, ".md")] : []),
        ...(rehearsalStartSmoke ? [rehearsalStartSmoke.relativePath, replaceExtension(rehearsalStartSmoke.relativePath, ".md")] : []),
        ...(strictAiSmokePath ? [strictAiSmokePath] : []),
        OPERATOR_QUICKSTART_PATH
      ]
    );
    for (const sourcePath of sourcePaths) {
      const copied = await copyArtifact(root, artifactsDir, sourcePath);
      if (copied) files.push(copied);
      else blockers.push(`Bundle source artifact is missing or escapes root: ${sourcePath}`);
    }
  }

  const ok = blockers.length === 0;
  const manifest: HandoffBundleManifest = {
    schemaVersion: 1,
    generatedAt,
    label,
    status: ok ? "ready-local-alpha-review-bundle" : "blocked",
    commandUploadEnabled: false,
    sourceIndexPath: index?.relativePath,
    sourceIndexGeneratedAt: isRecord(indexManifest) ? stringOrUndefined(indexManifest.generatedAt) : undefined,
    sourceIndexStatus: isRecord(indexManifest) ? stringOrUndefined(indexManifest.status) : undefined,
    sourceIndexComplete: isRecord(indexManifest) && indexManifest.complete === true,
    gstackWorkflowStatusPath: gstackWorkflow?.relativePath,
    gstackWorkflowStatusGeneratedAt: isRecord(gstackWorkflowManifest) ? stringOrUndefined(gstackWorkflowManifest.generatedAt) : undefined,
    gstackWorkflowStatus: isRecord(gstackWorkflowManifest) ? stringOrUndefined(gstackWorkflowManifest.status) : undefined,
    gstackQaReportPath: gstackQaReport?.path,
    gstackQaReportGeneratedAt: gstackQaReport?.generatedAt,
    gstackQaReportStatus: gstackQaReport?.status,
    gstackQaScreenshotPaths: gstackQaReport?.screenshotPaths ?? [],
    todoAuditPath: todoAudit?.relativePath,
    todoAuditGeneratedAt: isRecord(todoAuditManifest) ? stringOrUndefined(todoAuditManifest.generatedAt) : undefined,
    todoAuditStatus: isRecord(todoAuditManifest) ? stringOrUndefined(todoAuditManifest.status) : undefined,
    sourceControlHandoffPath: sourceControl?.relativePath,
    sourceControlHandoffGeneratedAt: isRecord(sourceControlManifest) ? stringOrUndefined(sourceControlManifest.generatedAt) : undefined,
    sourceControlHandoffStatus: isRecord(sourceControlManifest) ? stringOrUndefined(sourceControlManifest.status) : undefined,
    sourceControlHandoffReady: isRecord(sourceControlManifest) ? Boolean(sourceControlManifest.ready) : undefined,
    sourceControlHandoffRepositoryUrl: isRecord(sourceControlManifest) ? stringOrUndefined(sourceControlManifest.repositoryUrl) : undefined,
    sourceControlHandoffPackageRepositoryUrl: isRecord(sourceControlManifest) ? stringOrUndefined(sourceControlManifest.packageRepositoryUrl) : undefined,
    sourceControlHandoffConfiguredRemoteUrls: isRecord(sourceControlManifest) ? stringArray(sourceControlManifest.configuredRemoteUrls) : [],
    sourceControlHandoffLocalHeadSha: isRecord(sourceControlManifest) ? stringOrUndefined(sourceControlManifest.localHeadSha) : undefined,
    sourceControlHandoffRemoteDefaultBranchSha: isRecord(sourceControlManifest) ? stringOrUndefined(sourceControlManifest.remoteDefaultBranchSha) : undefined,
    sourceControlHandoffWorkingTreeClean: isRecord(sourceControlManifest) ? booleanOrUndefined(sourceControlManifest.workingTreeClean) : undefined,
    sourceControlHandoffWorkingTreeStatusLineCount: isRecord(sourceControlManifest) ? numberOrUndefined(sourceControlManifest.workingTreeStatusLineCount) : undefined,
    plugAndPlaySetupPath: setup?.relativePath,
    plugAndPlaySetupGeneratedAt: isRecord(setupManifest) ? stringOrUndefined(setupManifest.generatedAt) : undefined,
    plugAndPlaySetupStatus: isRecord(setupManifest) ? stringOrUndefined(setupManifest.status) : undefined,
    localAiPreparePath: localAiPrepare?.relativePath,
    localAiPrepareGeneratedAt: isRecord(localAiPrepareManifest) ? stringOrUndefined(localAiPrepareManifest.generatedAt) : undefined,
    localAiPrepareStatus: isRecord(localAiPrepareManifest) ? stringOrUndefined(localAiPrepareManifest.status) : undefined,
    localAiPrepareModel: isRecord(localAiPrepareManifest) ? stringOrUndefined(localAiPrepareManifest.model) : undefined,
    plugAndPlayDoctorPath: doctor?.relativePath,
    plugAndPlayDoctorGeneratedAt: isRecord(doctorManifest) ? stringOrUndefined(doctorManifest.generatedAt) : undefined,
    plugAndPlayDoctorStatus: isRecord(doctorManifest) ? stringOrUndefined(doctorManifest.status) : undefined,
    rehearsalStartSmokePath: rehearsalStartSmoke?.relativePath,
    rehearsalStartSmokeGeneratedAt: isRecord(rehearsalStartSmokeManifest) ? stringOrUndefined(rehearsalStartSmokeManifest.generatedAt) : undefined,
    rehearsalStartSmokeStatus: isRecord(rehearsalStartSmokeManifest) ? stringOrUndefined(rehearsalStartSmokeManifest.status) : undefined,
    strictAiSmokeStatusPath: strictAiSmokePath,
    strictAiSmokeGeneratedAt: isRecord(strictAiSmokeManifest) ? numberOrUndefined(strictAiSmokeManifest.generatedAt) : undefined,
    strictAiSmokeProvider: isRecord(strictAiSmokeManifest) ? stringOrUndefined(strictAiSmokeManifest.provider) : undefined,
    strictAiSmokeModel: isRecord(strictAiSmokeManifest) ? stringOrUndefined(strictAiSmokeManifest.model) : undefined,
    strictAiSmokeOllamaUrl: isRecord(strictAiSmokeManifest) ? stringOrUndefined(strictAiSmokeManifest.ollamaUrl) : undefined,
    strictAiSmokeCaseCount: isRecord(strictAiSmokeManifest) ? numberOrUndefined(strictAiSmokeManifest.caseCount) : undefined,
    operatorQuickstartPath: OPERATOR_QUICKSTART_PATH,
    copiedFileCount: files.length,
    bundleDirectory: relativeFromRoot(root, bundleDirectory),
    files,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    hardwareClaims: {
      jetsonOrinNanoValidated: false,
      raspberryPi5Validated: false,
      realMavlinkBenchValidated: false,
      realRos2BenchValidated: false,
      hilFailsafeValidated: false,
      isaacJetsonCaptureValidated: false,
      hardwareActuationAuthorized: false
    },
    validation: {
      ok,
      warnings,
      blockers
    },
    realWorldBlockers: realWorldBlockersFrom(indexManifest),
    limitations: [
      "This bundle copies the linked local handoff artifacts and latest gstack workflow-status artifact after verifying the handoff index digest table.",
      "When the workflow-status artifact names a local gstack browser QA report, the bundle also copies that report and its named screenshots for review.",
      "It also copies the latest TODO audit artifact so reviewers can inspect TODO/blocker consistency with the handoff packet.",
      "It also copies the latest source-control handoff artifact so reviewers can inspect local Git metadata and GitHub publication readiness separately from hardware readiness.",
      "It also copies the latest plug-and-play setup, local AI prepare, doctor, and rehearsal-start smoke artifacts so reviewers can inspect local env/data preparation, Ollama model preparation, start-wrapper, AI, port, data-directory, startup, source-health, readiness, shutdown, and safety preflight evidence.",
      "It also copies the strict local AI smoke status so reviewers can inspect per-scenario Ollama plan-kind, validator, unsafe-text, and mutation safety proof.",
      "It also copies the operator quickstart that the plug-and-play readiness audit checks for local setup, source-control audit, start, advisory-only AI, API evidence, source-health, and safety-boundary instructions.",
      "It does not regenerate acceptance, completion-audit, demo, bench, hardware, policy, safety, API, or overnight evidence.",
      "It does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware actuation.",
      "Real MAVLink, ROS 2, PX4, ArduPilot, mission, geofence, mode, arm, takeoff, land, RTH, terminate, and waypoint command paths remain blocked outside simulator/SITL transports."
    ]
  };

  await mkdir(bundleDirectory, { recursive: true });
  const baseName = `seekr-handoff-bundle-${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);
  const bundleJsonPath = path.join(bundleDirectory, `${baseName}.json`);
  const bundleMarkdownPath = path.join(bundleDirectory, `${baseName}.md`);
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const markdown = renderMarkdown(manifest);
  await writeFile(jsonPath, json, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(bundleJsonPath, json, "utf8");
  await writeFile(bundleMarkdownPath, markdown, "utf8");

  return { manifest, bundleDirectory, jsonPath, markdownPath };
}

async function resolveIndex(root: string, requestedPath?: string) {
  if (requestedPath) {
    const absolutePath = path.resolve(root, requestedPath);
    const relativePath = normalizeRelative(root, requestedPath) ?? requestedPath;
    return { absolutePath, relativePath };
  }
  return latestJson(root, HANDOFF_INDEX_DIR, (name) => name.startsWith("seekr-handoff-index-"));
}

function bundleSourcePaths(indexPath: string, digestPaths: string[], extraPaths: string[] = []) {
  const paths = new Set<string>([indexPath, replaceExtension(indexPath, ".md")]);
  for (const digestPath of digestPaths) paths.add(digestPath);
  for (const extraPath of extraPaths) paths.add(extraPath);
  return [...paths].sort((left, right) => left.localeCompare(right));
}

async function copyArtifact(root: string, artifactsDir: string, sourcePath: string): Promise<HandoffBundleFile | undefined> {
  const relativeSource = normalizeRelative(root, sourcePath);
  if (!relativeSource) return undefined;
  const sourceAbsolute = path.resolve(root, relativeSource);
  if (!isInsideRoot(root, sourceAbsolute)) return undefined;

  try {
    const bytes = await readFile(sourceAbsolute);
    const bundlePath = path.posix.join("artifacts", relativeSource);
    const destination = path.resolve(artifactsDir, relativeSource);
    if (!isInsideRoot(artifactsDir, destination)) return undefined;
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    return {
      sourcePath: relativeSource,
      bundlePath,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  } catch {
    return undefined;
  }
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
  const absoluteDir = path.join(root, PLUG_AND_PLAY_DOCTOR_DIR);
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
        relativePath: path.posix.join(PLUG_AND_PLAY_DOCTOR_DIR, name)
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

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function realWorldBlockersFrom(manifest: unknown): string[] {
  if (!isRecord(manifest) || !Array.isArray(manifest.realWorldBlockers)) return [];
  return manifest.realWorldBlockers.map(String);
}

function renderMarkdown(manifest: HandoffBundleManifest) {
  return `${[
    "# SEEKR Handoff Bundle",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Label: ${manifest.label}`,
    `Status: ${manifest.status}`,
    manifest.sourceIndexPath ? `Source index: ${manifest.sourceIndexPath}` : undefined,
    manifest.sourceIndexGeneratedAt ? `Source index generated at: ${manifest.sourceIndexGeneratedAt}` : undefined,
    manifest.sourceIndexStatus ? `Source index status: ${manifest.sourceIndexStatus}` : undefined,
    `Source index complete: ${manifest.sourceIndexComplete}`,
    manifest.gstackWorkflowStatusPath ? `GStack workflow status: ${manifest.gstackWorkflowStatusPath}` : undefined,
    manifest.gstackWorkflowStatusGeneratedAt ? `GStack workflow generated at: ${manifest.gstackWorkflowStatusGeneratedAt}` : undefined,
    manifest.gstackWorkflowStatus ? `GStack workflow verdict: ${manifest.gstackWorkflowStatus}` : undefined,
    manifest.gstackQaReportPath ? `GStack QA report: ${manifest.gstackQaReportPath}` : undefined,
    manifest.gstackQaReportGeneratedAt ? `GStack QA report generated at: ${manifest.gstackQaReportGeneratedAt}` : undefined,
    manifest.gstackQaReportStatus ? `GStack QA report verdict: ${manifest.gstackQaReportStatus}` : undefined,
    manifest.gstackQaScreenshotPaths.length ? `GStack QA screenshots: ${manifest.gstackQaScreenshotPaths.join(", ")}` : undefined,
    manifest.todoAuditPath ? `TODO audit: ${manifest.todoAuditPath}` : undefined,
    manifest.todoAuditGeneratedAt ? `TODO audit generated at: ${manifest.todoAuditGeneratedAt}` : undefined,
    manifest.todoAuditStatus ? `TODO audit verdict: ${manifest.todoAuditStatus}` : undefined,
    manifest.sourceControlHandoffPath ? `Source-control handoff: ${manifest.sourceControlHandoffPath}` : undefined,
    manifest.sourceControlHandoffGeneratedAt ? `Source-control handoff generated at: ${manifest.sourceControlHandoffGeneratedAt}` : undefined,
    manifest.sourceControlHandoffStatus ? `Source-control handoff verdict: ${manifest.sourceControlHandoffStatus}` : undefined,
    typeof manifest.sourceControlHandoffReady === "boolean" ? `Source-control handoff ready: ${manifest.sourceControlHandoffReady}` : undefined,
    manifest.sourceControlHandoffRepositoryUrl ? `Source-control repository: ${manifest.sourceControlHandoffRepositoryUrl}` : undefined,
    manifest.sourceControlHandoffPackageRepositoryUrl ? `Source-control package repository: ${manifest.sourceControlHandoffPackageRepositoryUrl}` : undefined,
    manifest.sourceControlHandoffConfiguredRemoteUrls.length ? `Source-control configured remotes: ${manifest.sourceControlHandoffConfiguredRemoteUrls.join(", ")}` : undefined,
    manifest.sourceControlHandoffLocalHeadSha ? `Source-control local HEAD: ${manifest.sourceControlHandoffLocalHeadSha}` : undefined,
    manifest.sourceControlHandoffRemoteDefaultBranchSha ? `Source-control remote default SHA: ${manifest.sourceControlHandoffRemoteDefaultBranchSha}` : undefined,
    typeof manifest.sourceControlHandoffWorkingTreeClean === "boolean" ? `Source-control working tree clean: ${manifest.sourceControlHandoffWorkingTreeClean}` : undefined,
    typeof manifest.sourceControlHandoffWorkingTreeStatusLineCount === "number" ? `Source-control working tree status lines: ${manifest.sourceControlHandoffWorkingTreeStatusLineCount}` : undefined,
    manifest.plugAndPlaySetupPath ? `Plug-and-play setup: ${manifest.plugAndPlaySetupPath}` : undefined,
    manifest.plugAndPlaySetupGeneratedAt ? `Plug-and-play setup generated at: ${manifest.plugAndPlaySetupGeneratedAt}` : undefined,
    manifest.plugAndPlaySetupStatus ? `Plug-and-play setup verdict: ${manifest.plugAndPlaySetupStatus}` : undefined,
    manifest.localAiPreparePath ? `Local AI prepare: ${manifest.localAiPreparePath}` : undefined,
    manifest.localAiPrepareGeneratedAt ? `Local AI prepare generated at: ${manifest.localAiPrepareGeneratedAt}` : undefined,
    manifest.localAiPrepareStatus ? `Local AI prepare verdict: ${manifest.localAiPrepareStatus}` : undefined,
    manifest.localAiPrepareModel ? `Local AI prepare model: ${manifest.localAiPrepareModel}` : undefined,
    manifest.plugAndPlayDoctorPath ? `Plug-and-play doctor: ${manifest.plugAndPlayDoctorPath}` : undefined,
    manifest.plugAndPlayDoctorGeneratedAt ? `Plug-and-play doctor generated at: ${manifest.plugAndPlayDoctorGeneratedAt}` : undefined,
    manifest.plugAndPlayDoctorStatus ? `Plug-and-play doctor verdict: ${manifest.plugAndPlayDoctorStatus}` : undefined,
    manifest.rehearsalStartSmokePath ? `Rehearsal-start smoke: ${manifest.rehearsalStartSmokePath}` : undefined,
    manifest.rehearsalStartSmokeGeneratedAt ? `Rehearsal-start smoke generated at: ${manifest.rehearsalStartSmokeGeneratedAt}` : undefined,
    manifest.rehearsalStartSmokeStatus ? `Rehearsal-start smoke verdict: ${manifest.rehearsalStartSmokeStatus}` : undefined,
    manifest.strictAiSmokeStatusPath ? `Strict AI smoke status: ${manifest.strictAiSmokeStatusPath}` : undefined,
    typeof manifest.strictAiSmokeGeneratedAt === "number" ? `Strict AI smoke generated at: ${manifest.strictAiSmokeGeneratedAt}` : undefined,
    manifest.strictAiSmokeProvider ? `Strict AI smoke provider: ${manifest.strictAiSmokeProvider}` : undefined,
    manifest.strictAiSmokeModel ? `Strict AI smoke model: ${manifest.strictAiSmokeModel}` : undefined,
    manifest.strictAiSmokeOllamaUrl ? `Strict AI smoke Ollama URL: ${manifest.strictAiSmokeOllamaUrl}` : undefined,
    typeof manifest.strictAiSmokeCaseCount === "number" ? `Strict AI smoke cases: ${manifest.strictAiSmokeCaseCount}` : undefined,
    manifest.operatorQuickstartPath ? `Operator quickstart: ${manifest.operatorQuickstartPath}` : undefined,
    "",
    "Command upload enabled: false",
    "",
    "Safety boundary:",
    "",
    `- realAircraftCommandUpload: ${manifest.safetyBoundary.realAircraftCommandUpload}`,
    `- hardwareActuationEnabled: ${manifest.safetyBoundary.hardwareActuationEnabled}`,
    `- runtimePolicyInstalled: ${manifest.safetyBoundary.runtimePolicyInstalled}`,
    "",
    "Copied files:",
    "",
    "| Source | Bundle path | Bytes | SHA-256 |",
    "| --- | --- | ---: | --- |",
    ...(manifest.files.length
      ? manifest.files.map((file) => `| ${file.sourcePath} | ${file.bundlePath} | ${file.bytes} | ${file.sha256} |`)
      : ["| None | n/a | 0 | n/a |"]),
    "",
    "Real-world blockers:",
    "",
    ...(manifest.realWorldBlockers.length ? manifest.realWorldBlockers.map((blocker) => `- ${blocker}`) : ["- None"]),
    "",
    "Validation:",
    "",
    `- OK: ${manifest.validation.ok}`,
    ...(manifest.validation.blockers.length ? manifest.validation.blockers.map((item) => `- Blocker: ${item}`) : ["- Blockers: none"]),
    ...(manifest.validation.warnings.length ? manifest.validation.warnings.map((item) => `- Warning: ${item}`) : ["- Warnings: none"]),
    "",
    "Limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].filter((line): line is string => typeof line === "string").join("\n")}\n`;
}

function normalizeRelative(root: string, value: string) {
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

function relativeFromRoot(root: string, absolutePath: string) {
  const relative = path.relative(root, absolutePath);
  return relative.split(path.sep).join("/");
}

function replaceExtension(filePath: string, extension: string) {
  return filePath.replace(/\.json$/, extension);
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function booleanOrUndefined(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

async function gstackWorkflowStatusOk(root: string, manifest: unknown) {
  if (!isRecord(manifest)) return false;
  const workflows = Array.isArray(manifest.workflows) ? manifest.workflows.filter(isRecord) : [];
  const perspectives = Array.isArray(manifest.perspectives) ? manifest.perspectives.filter(isRecord) : [];
  const healthHistory = isRecord(manifest.healthHistory) ? manifest.healthHistory : undefined;
  const qaReport = isRecord(manifest.qaReport) ? manifest.qaReport : undefined;
  const requiredWorkflowSkillsAvailable = REQUIRED_WORKFLOW_IDS.every((id) =>
    workflows.some((item) => item.id === id && item.skillAvailable === true)
  );
  const hasGitMetadata = Boolean(await findGitMetadataPath(root));
  const reviewWorkspaceClaimOk = reviewWorkflowWorkspaceClaimOk(manifest, workflows, hasGitMetadata);
  return gstackTopLevelStatusOk(manifest, workflows, healthHistory, qaReport) &&
    manifestLimitationsPreserved(manifest, hasGitMetadata, healthHistory, qaReport) &&
    manifest.commandUploadEnabled === false &&
    manifest.gstackAvailable === true &&
    typeof manifest.gstackCliAvailable === "boolean" &&
    gstackHelperToolEvidenceOk(manifest) &&
    healthHistory !== undefined &&
    gstackHealthHistoryOk(healthHistory) &&
    qaReport !== undefined &&
    await gstackQaReportOk(root, qaReport) &&
    artifactIdsAreExact(workflows, REQUIRED_WORKFLOW_IDS) &&
    requiredWorkflowSkillsAvailable &&
    workflowLimitationsPreserved(workflows) &&
    reviewWorkspaceClaimOk &&
    artifactIdsAreExact(perspectives, REQUIRED_PERSPECTIVE_IDS) &&
    perspectivesSemanticallyPreserved(perspectives) &&
    !workflows.some((item) => item.status === "fail");
}

function artifactIdsAreExact(items: Record<string, unknown>[], requiredIds: string[]) {
  return items.length === requiredIds.length &&
    items.every((item, index) => String(item.id ?? "") === requiredIds[index]);
}

function gstackTopLevelStatusOk(
  manifest: Record<string, unknown>,
  workflows: Record<string, unknown>[],
  healthHistory: Record<string, unknown> | undefined,
  qaReport: Record<string, unknown> | undefined
) {
  const status = String(manifest.status);
  if (!["pass", "pass-with-limitations"].includes(status)) return false;
  const hasLimitations = manifest.gstackCliAvailable !== true ||
    workflows.some((item) => item.status !== "pass") ||
    (healthHistory !== undefined && healthHistory.status !== "pass") ||
    (qaReport !== undefined && qaReport.status !== "pass");
  return !hasLimitations || status === "pass-with-limitations";
}

function manifestLimitationsPreserved(
  manifest: Record<string, unknown>,
  hasGitMetadata: boolean,
  healthHistory: Record<string, unknown> | undefined,
  qaReport: Record<string, unknown> | undefined
) {
  const status = String(manifest.status);
  const limitations = limitationStrings(manifest);
  if (status !== "pass-with-limitations") return true;
  if (!limitations.length) return false;
  const text = limitations.join(" ");
  void hasGitMetadata;
  if (manifest.gstackCliAvailable !== true && !/gstack CLI|CLI binary|CLI execution/i.test(text)) return false;
  if (healthHistory && healthHistory.status !== "pass" && !/health history/i.test(text)) return false;
  if (qaReport && qaReport.status !== "pass" && !/(browser QA|QA report|gstack QA)/i.test(text)) return false;
  return true;
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
  const evidenceText = evidence.concat(limitationStrings(manifest)).join(" ");
  return typeof toolRoot === "string" &&
    /gstack/i.test(toolRoot) &&
    Number.isInteger(toolCount) &&
    toolCount > 0 &&
    toolNames.length === toolCount &&
    /helper tool/i.test(evidenceText) &&
    evidenceText.includes(String(toolCount));
}

function reviewWorkflowWorkspaceClaimOk(manifest: Record<string, unknown>, workflows: Record<string, unknown>[], hasGitMetadata: boolean) {
  const review = workflows.find((item) => item.id === "review");
  if (!review) return false;
  if (hasGitMetadata) {
    const gitMetadataPath = stringOrUndefined(manifest.gitMetadataPath);
    const evidence = Array.isArray(review.evidence) ? review.evidence.filter((item) => typeof item === "string") : [];
    return typeof gitMetadataPath === "string" &&
      review.status === "pass" &&
      evidence.includes(gitMetadataPath) &&
      String(review.details ?? "").includes(gitMetadataPath);
  }
  const limitations = Array.isArray(review.limitations) ? review.limitations.filter((item) => typeof item === "string") : [];
  const evidence = Array.isArray(review.evidence) ? review.evidence.filter((item) => typeof item === "string") : [];
  const reviewText = [String(review.details ?? ""), ...limitations, ...evidence].join(" ");
  return review.status === "blocked-by-workspace" &&
    /no \.?git metadata|without \.?git metadata|no git metadata/i.test(reviewText);
}

function gstackHealthHistoryOk(healthHistory: Record<string, unknown>) {
  const status = String(healthHistory.status);
  const limitations = limitationStrings(healthHistory);
  return healthHistory.commandUploadEnabled === false &&
    (status === "pass" || limitations.length > 0) &&
    (status === "missing" ||
      ((status === "pass" || status === "stale") && typeof healthHistory.path === "string" && healthHistory.path.length > 0));
}

async function gstackQaReportOk(root: string, qaReport: Record<string, unknown>) {
  const status = String(qaReport.status);
  const limitations = limitationStrings(qaReport);
  const reportPath = stringOrUndefined(qaReport.path);
  const screenshotPaths = screenshotPathsFrom(qaReport);
  const screenshotPathsStayInsideRoot = screenshotPaths.every((screenshotPath) => {
    const absolutePath = path.resolve(root, screenshotPath);
    return isInsideRoot(root, absolutePath);
  });
  const screenshotExistence = await Promise.all(screenshotPaths.map((screenshotPath) => pathExists(path.resolve(root, screenshotPath))));
  const screenshotsExist = screenshotPathsStayInsideRoot && screenshotExistence.every(Boolean);
  const reportScreenshotsMatch = !reportPath || arraysEqual(extractQaScreenshotPaths(await readText(path.resolve(root, reportPath))), screenshotPaths);
  return qaReport.commandUploadEnabled === false &&
    (status === "pass" || limitations.length > 0) &&
    (status === "missing" ||
      ((status === "pass" || status === "stale") && typeof qaReport.path === "string" && qaReport.path.length > 0)) &&
    screenshotsExist &&
    reportScreenshotsMatch;
}

function workflowLimitationsPreserved(workflows: Record<string, unknown>[]) {
  return workflows.every((workflow) => {
    const status = String(workflow.status ?? "");
    if (status !== "pass-with-limitations" && status !== "blocked-by-workspace") return true;
    return limitationStrings(workflow).length > 0;
  });
}

function perspectivesSemanticallyPreserved(perspectives: Record<string, unknown>[]) {
  return REQUIRED_PERSPECTIVE_IDS.every((id) => {
    const matches = perspectives.filter((item) => item.id === id);
    if (matches.length !== 1) return false;
    const perspective = matches[0];
    const status = String(perspective.status ?? "");
    const score = Number(perspective.score);
    return ["blocked-real-world", "ready-local-alpha"].includes(status) &&
      Number.isFinite(score) &&
      score >= 0 &&
      score <= 10 &&
      typeof perspective.nextAction === "string" &&
      perspective.nextAction.trim().length > 0;
  });
}

function limitationStrings(value: Record<string, unknown>) {
  return Array.isArray(value.limitations)
    ? value.limitations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function gstackQaReportFrom(manifest: unknown) {
  if (!isRecord(manifest) || !isRecord(manifest.qaReport)) return undefined;
  const qaReport = manifest.qaReport;
  const qaPath = stringOrUndefined(qaReport.path);
  if (!qaPath) return undefined;
  return {
    path: qaPath,
    generatedAt: stringOrUndefined(qaReport.generatedAt),
    status: stringOrUndefined(qaReport.status),
    screenshotPaths: screenshotPathsFrom(qaReport)
  };
}

function screenshotPathsFrom(value: Record<string, unknown>) {
  return Array.isArray(value.screenshotPaths)
    ? value.screenshotPaths.filter((item): item is string => typeof item === "string" && item.length > 0).sort((left, right) => left.localeCompare(right))
    : [];
}

function extractQaScreenshotPaths(content: string) {
  const paths = new Set<string>();
  const pattern = /(?:`)?((?:\.gstack\/qa-reports\/screenshots\/)[^`\s)]+\.png)(?:`)?/g;
  for (const match of content.matchAll(pattern)) {
    if (match[1]) paths.add(match[1]);
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function strictAiSmokeStatusOk(manifest: unknown, acceptance: unknown) {
  if (!isRecord(manifest) || !isRecord(acceptance)) return false;
  const strictLocalAi = isRecord(acceptance.strictLocalAi) ? acceptance.strictLocalAi : {};
  const cases = Array.isArray(manifest.cases) ? manifest.cases.filter(isRecord) : [];
  const caseNames = cases.map((item) => String(item.name ?? ""));
  const acceptanceCaseNames = stringArray(strictLocalAi.caseNames);
  const generatedAt = timeMs(manifest.generatedAt);
  const acceptanceAiGeneratedAt = timeMs(strictLocalAi.generatedAt);
  return manifest.ok === true &&
    manifest.provider === "ollama" &&
    manifest.requireOllama === true &&
    typeof manifest.model === "string" &&
    manifest.model.length > 0 &&
    isLocalOllamaUrl(manifest.ollamaUrl) &&
    strictLocalAi.ok === true &&
    strictLocalAi.provider === manifest.provider &&
    strictLocalAi.model === manifest.model &&
    strictLocalAi.ollamaUrl === manifest.ollamaUrl &&
    generatedAt !== undefined &&
    acceptanceAiGeneratedAt === generatedAt &&
    Number(manifest.caseCount) === REQUIRED_STRICT_AI_SMOKE_CASES.length &&
    Number(manifest.caseCount) === cases.length &&
    Number(strictLocalAi.caseCount) === cases.length &&
    arraysEqual(caseNames, [...REQUIRED_STRICT_AI_SMOKE_CASES]) &&
    arraysEqual(acceptanceCaseNames, caseNames) &&
    cases.every((item) => strictAiSmokeCaseOk(item, manifest.model));
}

function strictAiSmokeCaseOk(testCase: Record<string, unknown>, model: unknown) {
  const planKind = typeof testCase.planKind === "string" ? testCase.planKind.trim() : "";
  return typeof testCase.name === "string" &&
    testCase.provider === "ollama" &&
    testCase.model === model &&
    planKind.length > 0 &&
    planKind !== "hold-drone" &&
    testCase.validatorOk === true &&
    testCase.unsafeOperatorTextPresent === false &&
    testCase.mutatedWhileThinking === false;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function todoAuditOk(manifest: unknown) {
  if (!isRecord(manifest)) return false;
  const validation = isRecord(manifest.validation) ? manifest.validation : {};
  const completionAudit = isRecord(manifest.completionAudit) ? manifest.completionAudit : {};
  const categories = Array.isArray(manifest.categories) ? manifest.categories.filter(isRecord) : [];
  const status = String(manifest.status);
  const completionBlockerCount = Number(completionAudit.realWorldBlockerCount);
  const blockedCategoryCount = categories.filter((item) => item.status === "blocked").length;
  const topLevelCountsMatch =
    Number(manifest.categoryCount) === categories.length &&
    Number(manifest.realWorldBlockerCount) === completionBlockerCount &&
    Number(manifest.blockedCategoryCount) === blockedCategoryCount &&
    Number(manifest.validationBlockerCount) === (Array.isArray(validation.blockers) ? validation.blockers.length : 0);
  const exactCategories = categories.length === REQUIRED_TODO_CATEGORY_IDS.length &&
    categories.every((category, index) => String(category.id ?? "") === REQUIRED_TODO_CATEGORY_IDS[index]);
  const countsMatch = Number.isFinite(completionBlockerCount) &&
    completionBlockerCount === blockedCategoryCount &&
    (status === "pass-complete-no-blockers"
      ? completionAudit.complete === true && completionBlockerCount === 0
      : completionAudit.complete === false && completionBlockerCount > 0);
  return ["pass-real-world-blockers-tracked", "pass-complete-no-blockers"].includes(String(manifest.status)) &&
    manifest.commandUploadEnabled === false &&
    validation.ok === true &&
    completionAudit.commandUploadEnabled === false &&
    countsMatch &&
    topLevelCountsMatch &&
    Number.isFinite(Number(manifest.uncheckedTodoCount)) &&
    exactCategories &&
    categories.every(todoAuditCategoryOk);
}

function todoAuditCategoryOk(category: Record<string, unknown>) {
  const status = String(category.status);
  const todoMatches = Array.isArray(category.todoMatches) ? category.todoMatches : [];
  const completionBlockerMatches = Array.isArray(category.completionBlockerMatches) ? category.completionBlockerMatches : [];
  const todoMatchesOk = todoMatches.every(todoAuditTodoMatchOk);
  const completionBlockerMatchesOk = completionBlockerMatches.every((match) => typeof match === "string" && match.length > 0);
  if (status === "blocked") {
    return todoMatches.length > 0 &&
      completionBlockerMatches.length > 0 &&
      todoMatchesOk &&
      completionBlockerMatchesOk;
  }
  if (status === "pass") return todoMatches.length === 0 && completionBlockerMatches.length === 0;
  return false;
}

function todoAuditTodoMatchOk(match: unknown) {
  if (!isRecord(match)) return false;
  return typeof match.sourcePath === "string" &&
    match.sourcePath.length > 0 &&
    Number.isInteger(Number(match.line)) &&
    Number(match.line) > 0 &&
    typeof match.text === "string" &&
    match.text.length > 0;
}

function sourceControlHandoffOk(manifest: unknown) {
  return validateSourceControlHandoffManifest(manifest).ok;
}

function sourceControlHandoffFreshForAcceptance(manifest: unknown, acceptance: unknown) {
  if (!isRecord(manifest) || manifest.ready !== true) return true;
  if (!isRecord(acceptance)) return false;
  const acceptanceGeneratedAt = timeMs(acceptance.generatedAt);
  if (acceptanceGeneratedAt === undefined) return false;
  const generatedAt = timeMs(manifest.generatedAt);
  return generatedAt !== undefined && generatedAt >= acceptanceGeneratedAt;
}

function rehearsalStartSmokeOk(manifest: unknown) {
  return validateRehearsalStartSmokeManifest(manifest).ok;
}

function timeMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isInsideRoot(root: string, absolutePath: string) {
  return absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`);
}

async function directoryExists(directoryPath: string) {
  try {
    await readdir(directoryPath);
    return true;
  } catch {
    return false;
  }
}

async function findGitMetadataPath(start: string) {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, ".git");
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const result = await writeHandoffBundle({
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    indexPath: typeof args.index === "string" ? args.index : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    sourceIndexPath: result.manifest.sourceIndexPath,
    gstackWorkflowStatusPath: result.manifest.gstackWorkflowStatusPath,
    gstackWorkflowStatus: result.manifest.gstackWorkflowStatus,
    gstackQaReportPath: result.manifest.gstackQaReportPath,
    gstackQaReportStatus: result.manifest.gstackQaReportStatus,
    gstackQaScreenshotPaths: result.manifest.gstackQaScreenshotPaths,
    todoAuditPath: result.manifest.todoAuditPath,
    todoAuditStatus: result.manifest.todoAuditStatus,
    sourceControlHandoffPath: result.manifest.sourceControlHandoffPath,
    sourceControlHandoffStatus: result.manifest.sourceControlHandoffStatus,
    sourceControlHandoffReady: result.manifest.sourceControlHandoffReady,
    sourceControlHandoffRepositoryUrl: result.manifest.sourceControlHandoffRepositoryUrl,
    sourceControlHandoffPackageRepositoryUrl: result.manifest.sourceControlHandoffPackageRepositoryUrl,
    sourceControlHandoffConfiguredRemoteUrls: result.manifest.sourceControlHandoffConfiguredRemoteUrls,
    sourceControlHandoffLocalHeadSha: result.manifest.sourceControlHandoffLocalHeadSha,
    sourceControlHandoffRemoteDefaultBranchSha: result.manifest.sourceControlHandoffRemoteDefaultBranchSha,
    sourceControlHandoffWorkingTreeClean: result.manifest.sourceControlHandoffWorkingTreeClean,
    sourceControlHandoffWorkingTreeStatusLineCount: result.manifest.sourceControlHandoffWorkingTreeStatusLineCount,
    plugAndPlaySetupPath: result.manifest.plugAndPlaySetupPath,
    plugAndPlaySetupStatus: result.manifest.plugAndPlaySetupStatus,
    localAiPreparePath: result.manifest.localAiPreparePath,
    localAiPrepareStatus: result.manifest.localAiPrepareStatus,
    localAiPrepareModel: result.manifest.localAiPrepareModel,
    plugAndPlayDoctorPath: result.manifest.plugAndPlayDoctorPath,
    plugAndPlayDoctorStatus: result.manifest.plugAndPlayDoctorStatus,
    rehearsalStartSmokePath: result.manifest.rehearsalStartSmokePath,
    rehearsalStartSmokeStatus: result.manifest.rehearsalStartSmokeStatus,
    strictAiSmokeStatusPath: result.manifest.strictAiSmokeStatusPath,
    strictAiSmokeProvider: result.manifest.strictAiSmokeProvider,
    strictAiSmokeModel: result.manifest.strictAiSmokeModel,
    strictAiSmokeOllamaUrl: result.manifest.strictAiSmokeOllamaUrl,
    strictAiSmokeCaseCount: result.manifest.strictAiSmokeCaseCount,
    operatorQuickstartPath: result.manifest.operatorQuickstartPath,
    copiedFileCount: result.manifest.copiedFileCount,
    validation: result.manifest.validation,
    bundleDirectory: result.bundleDirectory,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
