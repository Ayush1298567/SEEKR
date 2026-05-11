import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { buildCompletionAudit, type CompletionAuditManifest } from "./completion-audit";
import { EXPECTED_REPOSITORY_URL, validateSourceControlHandoffManifest } from "./source-control-handoff";
import { buildTodoAudit, type TodoAuditManifest } from "./todo-audit";
import { REQUIRED_STRICT_AI_SMOKE_CASES, isLocalOllamaUrl } from "../src/server/ai/localAiEvidence";

type GoalAuditStatus = "pass" | "warn" | "fail" | "blocked";

export interface GoalAuditItem {
  id: string;
  requirement: string;
  status: GoalAuditStatus;
  details: string;
  evidence: string[];
}

export interface GoalAuditManifest {
  schemaVersion: 1;
  generatedAt: string;
  objective: string;
  status: "local-alpha-ready-real-world-blocked" | "local-alpha-failing" | "complete";
  localAlphaOk: boolean;
  complete: boolean;
  commandUploadEnabled: false;
  summary: {
    pass: number;
    warn: number;
    fail: number;
    blocked: number;
  };
  promptToArtifactChecklist: GoalAuditItem[];
  remainingRealWorldBlockers: string[];
  remainingRealWorldBlockerCount: number;
  safetyBoundary: {
    realAircraftCommandUpload: false;
    hardwareActuationEnabled: false;
    runtimePolicyInstalled: false;
  };
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/goal-audit";
const STRICT_AI_SMOKE_STATUS_PATH = ".tmp/ai-smoke-status.json";

const OBJECTIVE =
  "Finish SEEKR as a plug-and-play serious internal alpha: local-first GCS, implemented local AI, simulator/SITL, replay/evidence, and read-only drone integration platform without real aircraft command upload or hardware actuation.";

const REQUIRED_FILES = [
  "README.md",
  "docs/SEEKR_GCS_ALPHA_TODO.md",
  "docs/SEEKR_COMPLETION_PLAN.md",
  "docs/FLIGHT_SOFTWARE.md",
  "docs/EDGE_HARDWARE_BENCH.md",
  "docs/HARDWARE_DECISION_GATE.md",
  "docs/V1_ACCEPTANCE.md",
  "docs/OPERATOR_QUICKSTART.md",
  "docs/goal.md",
  "package.json",
  ".tmp/overnight/STATUS.md"
];

const REQUIRED_COMMANDS = [
  "typecheck",
  "test",
  "build",
  "preview",
  "server",
  "client",
  "dev",
  "check",
  "acceptance",
  "setup:local",
  "ai:prepare",
  "doctor",
  "rehearsal:start",
  "smoke:rehearsal:start",
  "bridge:mavlink",
  "bridge:mavlink:serial",
  "bridge:ros2",
  "bridge:ros2:live",
  "bridge:spatial",
  "bench:edge",
  "bench:flight",
  "bench:sitl",
  "bench:sitl:io",
  "bench:dimos",
  "safety:command-boundary",
  "test:ai:local",
  "test:ui",
  "qa:gstack",
  "health:gstack",
  "smoke:preview",
  "probe:preview",
  "release:checksum",
  "acceptance:record",
  "probe:api",
  "probe:hardware",
  "probe:hardware:archive",
  "rehearsal:evidence",
  "rehearsal:note",
  "rehearsal:closeout",
  "hil:failsafe:evidence",
  "isaac:hil:evidence",
  "policy:hardware:gate",
  "audit:completion",
  "demo:package",
  "bench:evidence:packet",
  "handoff:index",
  "handoff:verify",
  "handoff:bundle",
  "handoff:bundle:verify",
  "audit:gstack",
  "audit:source-control",
  "audit:todo",
  "audit:plug-and-play",
  "audit:goal",
  "overnight"
];

const REQUIRED_WORKFLOW_IDS = ["health", "review", "planning", "qa"];
const REQUIRED_PERSPECTIVE_IDS = ["operator", "safety", "dx", "replay", "demo-readiness"];

const REQUIRED_REAL_WORLD_BLOCKERS = [
  {
    id: "fresh-operator-field-laptop",
    text: "Fresh-operator field-laptop rehearsal is not completed in this session.",
    patterns: [/fresh[- ]operator/i, /field-laptop|rehearsal/i]
  },
  {
    id: "actual-jetson-orin-nano",
    text: "No actual Jetson Orin Nano hardware readiness archive is present.",
    patterns: [/jetson-orin-nano|Jetson Orin Nano/i]
  },
  {
    id: "actual-raspberry-pi-5",
    text: "No actual Raspberry Pi 5 hardware readiness archive is present.",
    patterns: [/raspberry-pi-5|Raspberry Pi 5/i]
  },
  {
    id: "real-mavlink-telemetry",
    text: "No real read-only MAVLink serial/UDP bench telemetry source has been validated.",
    patterns: [/MAVLink/i, /serial\/UDP|serial|UDP|telemetry/i]
  },
  {
    id: "real-ros2-topics",
    text: "No real read-only ROS 2 /map, pose, detection, LiDAR, or costmap topic bridge has been validated.",
    patterns: [/ROS 2/i, /\/map|map|pose|detection|LiDAR|lidar|costmap/i]
  },
  {
    id: "hil-failsafe-manual-override",
    text: "No HIL failsafe/manual override logs from a real bench run are present.",
    patterns: [/HIL/i, /failsafe/i, /manual override/i]
  },
  {
    id: "isaac-sim-jetson-capture",
    text: "No Isaac Sim to Jetson capture from a real bench run is archived.",
    patterns: [/Isaac Sim|Isaac/i, /Jetson|jetson/i, /capture/i]
  },
  {
    id: "hardware-actuation-policy-review",
    text: "No reviewed hardware-actuation policy package exists, and runtime command authority remains disabled.",
    patterns: [/hardware-actuation/i, /policy/i]
  }
];

export async function buildGoalAudit(options: {
  root?: string;
  generatedAt?: string;
} = {}): Promise<GoalAuditManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const completionAudit = await buildCompletionAudit({ root, generatedAt });
  const checklist: GoalAuditItem[] = [];

  checklist.push(await requiredFilesItem(root));
  checklist.push(await requiredCommandsItem(root));
  checklist.push(await safetyBoundaryItem(root));
  checklist.push(await acceptanceItem(root));
  checklist.push(await apiProbeItem(root));
  checklist.push(await sourceControlHandoffItem(root));
  checklist.push(await completionAuditItem(root, completionAudit));
  checklist.push(await demoAndHandoffItem(root, completionAudit.complete));
  checklist.push(await docsGoalItem(root));
  checklist.push(await gstackWorkflowItem(root));
  checklist.push(await todoAuditItem(root, completionAudit, generatedAt));
  checklist.push(await plugAndPlayReadinessItem(root, completionAudit));
  checklist.push(realWorldBlockersItem(completionAudit));

  const summary = {
    pass: checklist.filter((item) => item.status === "pass").length,
    warn: checklist.filter((item) => item.status === "warn").length,
    fail: checklist.filter((item) => item.status === "fail").length,
    blocked: checklist.filter((item) => item.status === "blocked").length
  };
  const localAlphaOk = summary.fail === 0 && completionAudit.localAlphaOk;
  const complete = localAlphaOk && summary.blocked === 0 && completionAudit.complete;
  const blockers = remainingRealWorldBlockers(completionAudit);

  return {
    schemaVersion: 1,
    generatedAt,
    objective: OBJECTIVE,
    status: complete ? "complete" : localAlphaOk ? "local-alpha-ready-real-world-blocked" : "local-alpha-failing",
    localAlphaOk,
    complete,
    commandUploadEnabled: false,
    summary,
    promptToArtifactChecklist: checklist,
    remainingRealWorldBlockers: blockers,
    remainingRealWorldBlockerCount: blockers.length,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    limitations: [
      "This audit verifies local artifacts, package scripts, generated evidence, and fail-closed safety metadata.",
      "It does not validate physical Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, real HIL behavior, Isaac Sim to Jetson capture, or hardware actuation.",
      "Real MAVLink, ROS 2, PX4, ArduPilot, mission, geofence, mode, arm, takeoff, land, return-home, terminate, and waypoint command paths remain blocked outside simulator/SITL transports."
    ]
  };
}

export async function writeGoalAudit(options: Parameters<typeof buildGoalAudit>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildGoalAudit(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-goal-audit-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function requiredFilesItem(root: string): Promise<GoalAuditItem> {
  const missing = [];
  for (const file of REQUIRED_FILES) {
    if (!(await pathExists(path.join(root, file)))) missing.push(file);
  }

  return {
    id: "named-files",
    requirement: "Every named objective file and the current overnight status file are present.",
    status: missing.length ? "fail" : "pass",
    details: missing.length
      ? `Missing required files: ${missing.join(", ")}.`
      : "All named objective files are present, including .tmp/overnight/STATUS.md.",
    evidence: REQUIRED_FILES
  };
}

async function requiredCommandsItem(root: string): Promise<GoalAuditItem> {
  const packageJson = await readJson(path.join(root, "package.json"));
  const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const missing = REQUIRED_COMMANDS.filter((command) => typeof scripts[command] !== "string");

  return {
    id: "named-commands",
    requirement: "Every named local-alpha, evidence, handoff, and audit command is exposed through package.json.",
    status: missing.length ? "fail" : "pass",
    details: missing.length
      ? `Missing package scripts: ${missing.join(", ")}.`
      : "All named local-alpha, evidence, handoff, and audit commands are present.",
    evidence: REQUIRED_COMMANDS.map((command) => `package.json scripts.${command}`)
  };
}

async function safetyBoundaryItem(root: string): Promise<GoalAuditItem> {
  const safety = await latestJson(root, ".tmp/safety-evidence", (name) => name.startsWith("seekr-command-boundary-scan-"));
  const handoff = await latestJson(root, ".tmp/handoff-index", (name) => name.startsWith("seekr-handoff-index-"));
  const verify = await latestJson(root, ".tmp/handoff-index", (name) => name.startsWith("seekr-handoff-verification-"));
  const safetyManifest = safety ? await readJson(safety.absolutePath) : undefined;
  const handoffManifest = handoff ? await readJson(handoff.absolutePath) : undefined;
  const verifyManifest = verify ? await readJson(verify.absolutePath) : undefined;
  const problems: string[] = [];

  if (!safety) problems.push("command-boundary scan evidence is missing");
  else if (!scanPassed(safetyManifest)) problems.push("latest command-boundary scan must pass with commandUploadEnabled false and zero violations");
  if (!handoff) problems.push("handoff index evidence is missing");
  else if (!authorizationFalse(handoffManifest)) problems.push("handoff index authorization fields must remain false");
  if (!verify) problems.push("handoff verification evidence is missing");
  else if (!authorizationFalse(verifyManifest) || !isRecord(verifyManifest) || verifyManifest.status !== "pass") {
    problems.push("handoff verification must pass and keep authorization fields false");
  }

  return {
    id: "critical-safety-rule",
    requirement: "Real aircraft command upload and hardware actuation remain disabled outside simulator/SITL.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "Static scan, handoff index, and handoff verification keep command upload and hardware authorization false.",
    evidence: [safety?.relativePath, handoff?.relativePath, verify?.relativePath].filter(isString)
  };
}

async function acceptanceItem(root: string): Promise<GoalAuditItem> {
  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const release = await latestJson(root, ".tmp/release-evidence", (name) => name.startsWith("seekr-release-"));
  const releaseManifest = release ? await readJson(release.absolutePath) : undefined;
  const acceptanceRelease = isRecord(acceptance) && isRecord(acceptance.releaseChecksum) ? acceptance.releaseChecksum : {};
  const strictLocalAi = isRecord(acceptance) && isRecord(acceptance.strictLocalAi) ? acceptance.strictLocalAi : {};
  const strictCaseNames = stringArray(strictLocalAi.caseNames);
  const expectedStrictCaseNames: string[] = [...REQUIRED_STRICT_AI_SMOKE_CASES];
  const missingStrictCases = expectedStrictCaseNames.filter((name) => !strictCaseNames.includes(name));
  const unexpectedStrictCases = strictCaseNames.filter((name) => !expectedStrictCaseNames.includes(name));
  const problems: string[] = [];

  if (!isRecord(acceptance) || acceptance.ok !== true) problems.push("acceptance status must pass");
  if (!isRecord(acceptance) || acceptance.commandUploadEnabled !== false) problems.push("acceptance status must keep commandUploadEnabled false");
  if (!isRecord(strictLocalAi) || strictLocalAi.ok !== true) problems.push("strict local AI evidence must pass");
  if (isRecord(strictLocalAi) && strictLocalAi.provider !== "ollama") problems.push("strict local AI should use the local Ollama provider");
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
  if (!release) problems.push("release checksum evidence is missing");
  if (release && normalizeArtifactPath(root, acceptanceRelease.jsonPath) !== release.relativePath) {
    problems.push("acceptance status must point at the latest release checksum evidence");
  }
  if (
    release &&
    (!isRecord(releaseManifest) ||
      releaseManifest.commandUploadEnabled !== false ||
      releaseManifest.overallSha256 !== acceptanceRelease.overallSha256)
  ) {
    problems.push("acceptance release checksum summary must match latest release evidence and keep commandUploadEnabled false");
  }

  return {
    id: "acceptance-and-release",
    requirement: "Acceptance, simulator/SITL/replay checks, UI checks, strict local AI, release checksum, and acceptance record are current.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Acceptance is current and tied to release checksum ${String(acceptanceRelease.overallSha256 ?? "").slice(0, 12)}...`,
    evidence: [".tmp/acceptance-status.json", release?.relativePath].filter(isString)
  };
}

async function apiProbeItem(root: string): Promise<GoalAuditItem> {
  const probe = await latestJson(root, ".tmp/api-probe", (name) => name.startsWith("seekr-api-probe-"));
  if (!probe) {
    return {
      id: "api-readback",
      requirement: "Final API probe persists session-visible acceptance and malformed-JSON evidence.",
      status: "fail",
      details: "No API probe evidence exists under .tmp/api-probe.",
      evidence: [".tmp/api-probe"]
    };
  }

  const manifest = await readJson(probe.absolutePath);
  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const checked = isRecord(manifest) && Array.isArray(manifest.checked) ? manifest.checked.map(String) : [];
  const sessionAcceptance = isRecord(manifest) && isRecord(manifest.sessionAcceptance) ? manifest.sessionAcceptance : {};
  const problems: string[] = [];

  if (!isRecord(manifest) || manifest.ok !== true) problems.push("probe ok is not true");
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) problems.push("probe commandUploadEnabled is not false");
  if (!checked.includes("session-acceptance-evidence")) problems.push("probe did not check session-acceptance-evidence");
  if (!checked.includes("malformed-json")) problems.push("probe did not check malformed-json handling");
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
    requirement: "Final API probe persists session-visible acceptance and malformed-JSON evidence.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Final API probe evidence matches session-visible acceptance evidence and is command-upload-disabled: ${probe.relativePath}.`,
    evidence: [probe.relativePath]
  };
}

async function completionAuditItem(root: string, computed: { localAlphaOk: boolean; complete: boolean; status: string; summary: Record<string, number> }): Promise<GoalAuditItem> {
  const latest = await latestJson(root, ".tmp/completion-audit", (name) => name.startsWith("seekr-completion-audit-"));
  if (!latest) {
    return {
      id: "completion-audit",
      requirement: "Completion audit separates local-alpha readiness from real-world hardware blockers.",
      status: "fail",
      details: "No completion audit evidence exists.",
      evidence: [".tmp/completion-audit"]
    };
  }

  const manifest = await readJson(latest.absolutePath);
  const summary = isRecord(manifest) && isRecord(manifest.summary) ? manifest.summary : {};
  const ok = isRecord(manifest) &&
    manifest.commandUploadEnabled === false &&
    manifest.localAlphaOk === true &&
    manifest.complete === computed.complete &&
    manifest.status === computed.status &&
    Number(summary.pass) === Number(computed.summary.pass) &&
    Number(summary.fail) === Number(computed.summary.fail) &&
    Number(summary.blocked) === Number(computed.summary.blocked);

  return {
    id: "completion-audit",
    requirement: "Completion audit separates local-alpha readiness from real-world hardware blockers.",
    status: ok ? "pass" : "fail",
    details: ok
      ? computed.complete
        ? `Completion audit is current and complete with all real-world evidence present: ${latest.relativePath}.`
        : `Completion audit is current enough for local alpha and still incomplete on real-world evidence: ${latest.relativePath}.`
      : "Latest completion audit must match the current computed audit, keep commandUploadEnabled false, report localAlphaOk true, and match the computed complete status.",
    evidence: [latest.relativePath]
  };
}

async function sourceControlHandoffItem(root: string): Promise<GoalAuditItem> {
  const latest = await latestJson(root, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
  const manifest = latest ? await readJson(latest.absolutePath) : undefined;
  const validation = validateSourceControlHandoffManifest(manifest);
  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const acceptanceGeneratedAt = isRecord(acceptance) ? timeMs(acceptance.generatedAt) : undefined;
  const generatedAt = isRecord(manifest) ? timeMs(manifest.generatedAt) : undefined;
  const problems = [
    ...(!latest ? ["source-control handoff artifact is missing"] : []),
    ...(validation.ok ? [] : validation.problems),
    ...(isRecord(manifest) && manifest.ready !== true ? ["source-control handoff must be ready"] : []),
    ...(isRecord(manifest) && manifest.status !== "ready-source-control-handoff" ? ["source-control handoff must have no warning or blocked checks"] : []),
    ...(isRecord(manifest) && Number(manifest.blockedCheckCount) !== 0 ? ["source-control handoff blockedCheckCount must be 0"] : []),
    ...(isRecord(manifest) && Number(manifest.warningCheckCount) !== 0 ? ["source-control handoff warningCheckCount must be 0"] : []),
    ...(isRecord(manifest) && acceptanceGeneratedAt !== undefined && generatedAt === undefined ? ["source-control handoff must record a parseable generatedAt timestamp"] : []),
    ...(generatedAt !== undefined && acceptanceGeneratedAt !== undefined && generatedAt < acceptanceGeneratedAt ? ["source-control handoff must be newer than or equal to the latest acceptance record"] : [])
  ];

  return {
    id: "source-control-handoff",
    requirement: "GitHub/source-control handoff proves the checked local source is published, clean, and separate from hardware readiness.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Source-control handoff is ready for ${EXPECTED_REPOSITORY_URL}, local HEAD matches the GitHub default branch, and the worktree is clean.`,
    evidence: [latest?.relativePath, "package.json", "../README.md", "docs/OPERATOR_QUICKSTART.md"].filter(isString)
  };
}

async function demoAndHandoffItem(root: string, expectedComplete: boolean): Promise<GoalAuditItem> {
  const demo = await latestJson(root, ".tmp/demo-readiness", (name) => name.startsWith("seekr-demo-readiness-"));
  const bench = await latestJson(root, ".tmp/bench-evidence-packet", (name) => name.startsWith("seekr-bench-evidence-packet-"));
  const handoff = await latestJson(root, ".tmp/handoff-index", (name) => name.startsWith("seekr-handoff-index-"));
  const verify = await latestJson(root, ".tmp/handoff-index", (name) => name.startsWith("seekr-handoff-verification-"));
  const bundle = await latestJson(root, ".tmp/handoff-bundles", (name) => name.startsWith("seekr-handoff-bundle-"));
  const bundleVerify = await latestJson(root, ".tmp/handoff-bundles", (name) => name.startsWith("seekr-review-bundle-verification-"));
  const gstackWorkflow = await latestJson(root, ".tmp/gstack-workflow-status", (name) => name.startsWith("seekr-gstack-workflow-status-"));
  const todoAudit = await latestJson(root, ".tmp/todo-audit", (name) => name.startsWith("seekr-todo-audit-"));
  const sourceControl = await latestJson(root, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
  const localAiPrepare = await latestJson(root, ".tmp/local-ai-prepare", (name) => name.startsWith("seekr-local-ai-prepare-"));
  const rehearsalStartSmoke = await latestJson(root, ".tmp/rehearsal-start-smoke", (name) => name.startsWith("seekr-rehearsal-start-smoke-"));
  const demoManifest = demo ? await readJson(demo.absolutePath) : undefined;
  const benchManifest = bench ? await readJson(bench.absolutePath) : undefined;
  const handoffManifest = handoff ? await readJson(handoff.absolutePath) : undefined;
  const verifyManifest = verify ? await readJson(verify.absolutePath) : undefined;
  const bundleManifest = bundle ? await readJson(bundle.absolutePath) : undefined;
  const bundleVerifyManifest = bundleVerify ? await readJson(bundleVerify.absolutePath) : undefined;
  const gstackWorkflowManifest = gstackWorkflow ? await readJson(gstackWorkflow.absolutePath) : undefined;
  const problems: string[] = [];

  if (!demo || !isRecord(demoManifest) || demoManifest.localAlphaOk !== true || demoManifest.commandUploadEnabled !== false) {
    problems.push("demo readiness package must be local-alpha ready with commandUploadEnabled false");
  }
  if (isRecord(demoManifest) && demoManifest.complete !== expectedComplete) {
    problems.push("demo readiness package complete flag must match the current completion audit");
  }
  const demoBlockers = isRecord(demoManifest) && Array.isArray(demoManifest.realWorldBlockers)
    ? demoManifest.realWorldBlockers
    : [];
  if (expectedComplete && demoBlockers.length > 0) {
    problems.push("complete demo readiness package must have no real-world blockers");
  }
  const perspectiveReview = isRecord(demoManifest) && Array.isArray(demoManifest.perspectiveReview)
    ? demoManifest.perspectiveReview.filter(isRecord)
    : [];
  const perspectiveIds = new Set(perspectiveReview.map((item) => String(item.id ?? "")));
  for (const requiredPerspective of ["operator", "safety", "dx", "replay", "demo-readiness"]) {
    if (!perspectiveIds.has(requiredPerspective)) {
      problems.push("demo readiness package must include operator, safety, DX, replay, and demo-readiness perspective review");
      break;
    }
  }
  if (!bench || !isRecord(benchManifest) || benchManifest.localAlphaOk !== true || benchManifest.commandUploadEnabled !== false) {
    problems.push("bench evidence packet must be ready for bench prep with commandUploadEnabled false");
  }
  if (isRecord(benchManifest) && benchManifest.complete !== expectedComplete) {
    problems.push("bench evidence packet complete flag must match the current completion audit");
  }
  const benchTasks = isRecord(benchManifest) && Array.isArray(benchManifest.tasks) ? benchManifest.tasks : [];
  if (expectedComplete && benchTasks.length > 0) {
    problems.push("complete bench evidence packet must have no remaining task cards");
  }
  if (!handoff || !isRecord(handoffManifest) || handoffManifest.localAlphaOk !== true || handoffManifest.commandUploadEnabled !== false) {
    problems.push("handoff index must be local-alpha ready with commandUploadEnabled false");
  }
  if (isRecord(handoffManifest) && handoffManifest.complete !== expectedComplete) {
    problems.push("handoff index complete flag must match the current completion audit");
  }
  const handoffBlockers = isRecord(handoffManifest) && Array.isArray(handoffManifest.realWorldBlockers)
    ? handoffManifest.realWorldBlockers
    : [];
  if (expectedComplete && handoffBlockers.length > 0) {
    problems.push("complete handoff index must have no real-world blockers");
  }
  if (!verify || !isRecord(verifyManifest) || verifyManifest.status !== "pass" || verifyManifest.commandUploadEnabled !== false) {
    problems.push("handoff verification must pass with commandUploadEnabled false");
  }
  if (!bundle || !isRecord(bundleManifest) || bundleManifest.status !== "ready-local-alpha-review-bundle" || bundleManifest.commandUploadEnabled !== false) {
    problems.push("handoff bundle must be ready for local-alpha review with commandUploadEnabled false");
  }
  if (isRecord(bundleManifest) && bundleManifest.sourceIndexComplete !== expectedComplete) {
    problems.push("handoff bundle sourceIndexComplete flag must match the current completion audit");
  }
  const bundleBlockers = isRecord(bundleManifest) && Array.isArray(bundleManifest.realWorldBlockers)
    ? bundleManifest.realWorldBlockers
    : [];
  if (expectedComplete && bundleBlockers.length > 0) {
    problems.push("complete handoff bundle must have no real-world blockers");
  }
  if (!bundleVerify || !isRecord(bundleVerifyManifest) || bundleVerifyManifest.status !== "pass" || bundleVerifyManifest.commandUploadEnabled !== false) {
    problems.push("handoff bundle verification must pass with commandUploadEnabled false");
  }
  const bundleSecretScan = isRecord(bundleVerifyManifest) && isRecord(bundleVerifyManifest.secretScan)
    ? bundleVerifyManifest.secretScan
    : undefined;
  const bundleVerifyCheckedFileCount = isRecord(bundleVerifyManifest)
    ? Number(bundleVerifyManifest.checkedFileCount)
    : Number.NaN;
  if (!bundleSecretScan || bundleSecretScan.status !== "pass" || Number(bundleSecretScan.findingCount) !== 0) {
    problems.push("handoff bundle verification secret scan must pass with zero findings");
  }
  if (
    bundleSecretScan &&
    (Number(bundleSecretScan.scannedFileCount) !== bundleVerifyCheckedFileCount ||
      Number(bundleSecretScan.expectedFileCount) !== bundleVerifyCheckedFileCount)
  ) {
    problems.push("handoff bundle verification secret scan must cover every checked copied file");
  }
  const benchSourceDemo = isRecord(benchManifest)
    ? normalizeArtifactPath(root, benchManifest.sourceDemoReadinessPackagePath ?? benchManifest.sourceDemoReadinessPath)
    : undefined;
  if (bench && demo && benchSourceDemo !== demo.relativePath) {
    problems.push("bench packet must point at the latest demo package");
  }
  const verifyIndex = isRecord(verifyManifest) ? normalizeArtifactPath(root, verifyManifest.indexPath) : undefined;
  if (verify && handoff && verifyIndex !== handoff.relativePath) {
    problems.push("handoff verification must point at the latest handoff index");
  }
  const bundleIndex = isRecord(bundleManifest) ? normalizeArtifactPath(root, bundleManifest.sourceIndexPath) : undefined;
  if (bundle && handoff && bundleIndex !== handoff.relativePath) {
    problems.push("handoff bundle must point at the latest handoff index");
  }
  const bundleGstackWorkflow = isRecord(bundleManifest) ? normalizeArtifactPath(root, bundleManifest.gstackWorkflowStatusPath) : undefined;
  if (bundle && gstackWorkflow && bundleGstackWorkflow !== gstackWorkflow.relativePath) {
    problems.push("handoff bundle must include the latest gstack workflow status artifact");
  }
  const latestGstackQaReport = isRecord(gstackWorkflowManifest) && isRecord(gstackWorkflowManifest.qaReport)
    ? normalizeArtifactPath(root, gstackWorkflowManifest.qaReport.path)
    : undefined;
  const latestGstackQaScreenshots = isRecord(gstackWorkflowManifest) && isRecord(gstackWorkflowManifest.qaReport)
    ? normalizeArtifactPaths(root, gstackWorkflowManifest.qaReport.screenshotPaths)
    : [];
  const bundleGstackQaReport = isRecord(bundleManifest) ? normalizeArtifactPath(root, bundleManifest.gstackQaReportPath) : undefined;
  if (bundle && latestGstackQaReport && bundleGstackQaReport !== latestGstackQaReport) {
    problems.push("handoff bundle must include the latest local gstack QA report referenced by workflow status");
  }
  const bundleGstackQaScreenshots = isRecord(bundleManifest) ? normalizeArtifactPaths(root, bundleManifest.gstackQaScreenshotPaths) : [];
  if (bundle && latestGstackQaScreenshots.length && !arraysEqual(bundleGstackQaScreenshots, latestGstackQaScreenshots)) {
    problems.push("handoff bundle must include the gstack QA screenshots referenced by workflow status");
  }
  const bundleTodoAudit = isRecord(bundleManifest) ? normalizeArtifactPath(root, bundleManifest.todoAuditPath) : undefined;
  if (bundle && todoAudit && bundleTodoAudit !== todoAudit.relativePath) {
    problems.push("handoff bundle must include the latest TODO audit artifact");
  }
  const bundleSourceControl = isRecord(bundleManifest) ? normalizeArtifactPath(root, bundleManifest.sourceControlHandoffPath) : undefined;
  if (bundle && sourceControl && bundleSourceControl !== sourceControl.relativePath) {
    problems.push("handoff bundle must include the latest source-control handoff artifact");
  }
  const bundleLocalAiPrepare = isRecord(bundleManifest) ? normalizeArtifactPath(root, bundleManifest.localAiPreparePath) : undefined;
  if (bundle && localAiPrepare && bundleLocalAiPrepare !== localAiPrepare.relativePath) {
    problems.push("handoff bundle must include the latest local AI prepare artifact");
  }
  const bundleRehearsalStartSmoke = isRecord(bundleManifest) ? normalizeArtifactPath(root, bundleManifest.rehearsalStartSmokePath) : undefined;
  if (bundle && rehearsalStartSmoke && bundleRehearsalStartSmoke !== rehearsalStartSmoke.relativePath) {
    problems.push("handoff bundle must include the latest rehearsal-start smoke artifact");
  }
  const bundleStrictAiSmoke = isRecord(bundleManifest) ? normalizeArtifactPath(root, bundleManifest.strictAiSmokeStatusPath) : undefined;
  if (bundle && bundleStrictAiSmoke !== STRICT_AI_SMOKE_STATUS_PATH) {
    problems.push("handoff bundle must include the strict local AI smoke status artifact");
  }
  const verifiedBundle = isRecord(bundleVerifyManifest) ? normalizeArtifactPath(root, bundleVerifyManifest.sourceBundlePath) : undefined;
  if (bundleVerify && bundle && verifiedBundle !== bundle.relativePath) {
    problems.push("handoff bundle verification must point at the latest handoff bundle");
  }
  const verifiedGstackWorkflow = isRecord(bundleVerifyManifest) ? normalizeArtifactPath(root, bundleVerifyManifest.gstackWorkflowStatusPath) : undefined;
  if (bundleVerify && gstackWorkflow && verifiedGstackWorkflow !== gstackWorkflow.relativePath) {
    problems.push("handoff bundle verification must point at the bundled latest gstack workflow status artifact");
  }
  const verifiedGstackQaReport = isRecord(bundleVerifyManifest) ? normalizeArtifactPath(root, bundleVerifyManifest.gstackQaReportPath) : undefined;
  if (bundleVerify && latestGstackQaReport && verifiedGstackQaReport !== latestGstackQaReport) {
    problems.push("handoff bundle verification must point at the bundled latest gstack QA report artifact");
  }
  const verifiedGstackQaScreenshots = isRecord(bundleVerifyManifest) ? normalizeArtifactPaths(root, bundleVerifyManifest.gstackQaScreenshotPaths) : [];
  if (bundleVerify && latestGstackQaScreenshots.length && !arraysEqual(verifiedGstackQaScreenshots, latestGstackQaScreenshots)) {
    problems.push("handoff bundle verification must point at the bundled gstack QA screenshot artifacts");
  }
  const verifiedTodoAudit = isRecord(bundleVerifyManifest) ? normalizeArtifactPath(root, bundleVerifyManifest.todoAuditPath) : undefined;
  if (bundleVerify && todoAudit && verifiedTodoAudit !== todoAudit.relativePath) {
    problems.push("handoff bundle verification must point at the bundled latest TODO audit artifact");
  }
  const verifiedSourceControl = isRecord(bundleVerifyManifest) ? normalizeArtifactPath(root, bundleVerifyManifest.sourceControlHandoffPath) : undefined;
  if (bundleVerify && sourceControl && verifiedSourceControl !== sourceControl.relativePath) {
    problems.push("handoff bundle verification must point at the bundled latest source-control handoff artifact");
  }
  const verifiedLocalAiPrepare = isRecord(bundleVerifyManifest) ? normalizeArtifactPath(root, bundleVerifyManifest.localAiPreparePath) : undefined;
  if (bundleVerify && localAiPrepare && verifiedLocalAiPrepare !== localAiPrepare.relativePath) {
    problems.push("handoff bundle verification must point at the bundled latest local AI prepare artifact");
  }
  const verifiedRehearsalStartSmoke = isRecord(bundleVerifyManifest) ? normalizeArtifactPath(root, bundleVerifyManifest.rehearsalStartSmokePath) : undefined;
  if (bundleVerify && rehearsalStartSmoke && verifiedRehearsalStartSmoke !== rehearsalStartSmoke.relativePath) {
    problems.push("handoff bundle verification must point at the bundled latest rehearsal-start smoke artifact");
  }
  const verifiedStrictAiSmoke = isRecord(bundleVerifyManifest) ? normalizeArtifactPath(root, bundleVerifyManifest.strictAiSmokeStatusPath) : undefined;
  if (bundleVerify && verifiedStrictAiSmoke !== STRICT_AI_SMOKE_STATUS_PATH) {
    problems.push("handoff bundle verification must point at the bundled strict local AI smoke status artifact");
  }

  return {
    id: "demo-handoff-chain",
    requirement: "Demo, bench packet, handoff index, digest verification, gstack workflow status, TODO audit, source-control handoff, local AI prepare, rehearsal-start smoke, strict local AI smoke status, review bundle, and bundle verification form a current handoff chain.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "Demo readiness, bench packet, handoff index, digest verification, gstack workflow status, TODO audit, source-control handoff, local AI prepare, rehearsal-start smoke, strict local AI smoke status, review bundle, and bundle verification are current and local-alpha ready with zero bundle secret findings.",
    evidence: [demo?.relativePath, bench?.relativePath, handoff?.relativePath, verify?.relativePath, gstackWorkflow?.relativePath, todoAudit?.relativePath, sourceControl?.relativePath, localAiPrepare?.relativePath, rehearsalStartSmoke?.relativePath, STRICT_AI_SMOKE_STATUS_PATH, bundle?.relativePath, bundleVerify?.relativePath].filter(isString)
  };
}

async function docsGoalItem(root: string): Promise<GoalAuditItem> {
  const content = await readText(path.join(root, "docs/goal.md"));
  const required = [
    "Prompt-To-Artifact",
    "Acceptance Expectations",
    "Latest Verification",
    "Real-World Blockers"
  ];
  const missing = required.filter((section) => !content.includes(section));

  return {
    id: "goal-doc-details",
    requirement: "docs/goal.md contains the long-form implementation details and acceptance expectations.",
    status: missing.length ? "fail" : "pass",
    details: missing.length
      ? `docs/goal.md is missing sections: ${missing.join(", ")}.`
      : "docs/goal.md contains prompt-to-artifact mapping, acceptance expectations, latest verification, and remaining blockers.",
    evidence: ["docs/goal.md"]
  };
}

async function gstackWorkflowItem(root: string): Promise<GoalAuditItem> {
  const content = await readText(path.join(root, "docs/goal.md"));
  const packageJson = await readJson(path.join(root, "package.json"));
  const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const workflow = await latestJson(root, ".tmp/gstack-workflow-status", (name) => name.startsWith("seekr-gstack-workflow-status-"));
  const workflowManifest = workflow ? await readJson(workflow.absolutePath) : undefined;
  const requiredDocSignals = [
    "GStack Workflow Status",
    "Health:",
    "Review:",
    "Planning:",
    "QA:",
    "operator",
    "safety",
    "DX",
    "replay",
    "demo-readiness"
  ];
  const missingSignals = requiredDocSignals.filter((signal) => !content.includes(signal));
  const missingScripts = ["test", "test:ui", "health:gstack", "audit:gstack", "audit:goal"].filter((script) => typeof scripts[script] !== "string");
  const workflowItems = isRecord(workflowManifest) && Array.isArray(workflowManifest.workflows)
    ? workflowManifest.workflows.filter(isRecord)
    : [];
  const missingWorkflows = REQUIRED_WORKFLOW_IDS.filter((id) =>
    !workflowItems.some((item) => item.id === id)
  );
  const workflowOrderOk = artifactIdsAreExact(workflowItems, REQUIRED_WORKFLOW_IDS);
  const unavailableWorkflowSkills = REQUIRED_WORKFLOW_IDS.filter((id) =>
    !workflowItems.some((item) => item.id === id && item.skillAvailable === true)
  );
  const hasGitMetadata = Boolean(await findGitMetadataPath(root));
  const reviewWorkspaceClaimOk = isRecord(workflowManifest) && reviewWorkflowWorkspaceClaimOk(workflowManifest, workflowItems, hasGitMetadata);
  const perspectives = isRecord(workflowManifest) && Array.isArray(workflowManifest.perspectives)
    ? workflowManifest.perspectives.filter(isRecord)
    : [];
  const missingPerspectives = REQUIRED_PERSPECTIVE_IDS.filter((id) =>
    !perspectives.some((item) => item.id === id)
  );
  const perspectiveOrderOk = artifactIdsAreExact(perspectives, REQUIRED_PERSPECTIVE_IDS);
  const healthHistory = isRecord(workflowManifest) && isRecord(workflowManifest.healthHistory) ? workflowManifest.healthHistory : undefined;
  const healthHistoryOk = Boolean(healthHistory &&
    gstackHealthHistoryOk(healthHistory));
  const qaReport = isRecord(workflowManifest) && isRecord(workflowManifest.qaReport) ? workflowManifest.qaReport : undefined;
  const qaReportOk = Boolean(qaReport && await gstackQaReportOk(root, qaReport));
  const workflowStatusOk = isRecord(workflowManifest) &&
    gstackTopLevelStatusOk(workflowManifest, workflowItems, healthHistory, qaReport) &&
    manifestLimitationsPreserved(workflowManifest, hasGitMetadata, healthHistory, qaReport) &&
    workflowManifest.commandUploadEnabled === false &&
    workflowManifest.gstackAvailable === true &&
    typeof workflowManifest.gstackCliAvailable === "boolean" &&
    gstackHelperToolEvidenceOk(workflowManifest) &&
    healthHistoryOk &&
    qaReportOk &&
    missingWorkflows.length === 0 &&
    workflowOrderOk &&
    unavailableWorkflowSkills.length === 0 &&
    workflowLimitationsPreserved(workflowItems) &&
    reviewWorkspaceClaimOk &&
    missingPerspectives.length === 0 &&
    perspectiveOrderOk &&
    perspectivesSemanticallyPreserved(perspectives) &&
    !workflowItems.some((item) => item.status === "fail");
  const problems = [
    ...missingSignals.map((signal) => `docs/goal.md missing ${signal}`),
    ...missingScripts.map((script) => `package.json missing ${script}`),
    ...(!workflow ? ["gstack workflow status artifact is missing"] : []),
    ...(workflow && !workflowStatusOk ? ["gstack workflow status artifact must pass or pass with documented workspace limitations, use pass-with-limitations for limitation-only evidence, include all workflows with installed skill availability, preserve manifest-level limitation details, preserve limitation details for stale or missing health/QA evidence, preserve Git metadata review evidence when present or no-Git review limitations when absent, include perspective status/score/nextAction details, health history status/path, local QA report status/path, record gstack CLI availability, preserve helper-tool evidence when the umbrella CLI is unavailable, and keep commandUploadEnabled false"] : [])
  ];

  return {
    id: "gstack-workflow-status",
    requirement: "The gstack planning/review/QA/health request is mapped to concrete local evidence and limitations.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "docs/goal.md and the gstack workflow artifact record health history, planning, review, QA report status, and operator, safety, DX, replay, and demo-readiness perspectives.",
    evidence: ["docs/goal.md", "package.json scripts.test", "package.json scripts.test:ui", "package.json scripts.health:gstack", "package.json scripts.audit:gstack", "package.json scripts.audit:goal", workflow?.relativePath, isRecord(healthHistory) ? stringOrUndefined(healthHistory.path) : undefined, isRecord(qaReport) ? stringOrUndefined(qaReport.path) : undefined, ...normalizeArtifactPaths(root, isRecord(qaReport) ? qaReport.screenshotPaths : undefined)].filter(isString)
  };
}

async function todoAuditItem(root: string, completionAudit: CompletionAuditManifest, generatedAt: string): Promise<GoalAuditItem> {
  const todo = await latestJson(root, ".tmp/todo-audit", (name) => name.startsWith("seekr-todo-audit-"));
  const todoManifest = todo ? await readJson(todo.absolutePath) : undefined;
  const current = await buildTodoAudit({ root, generatedAt, completionAudit });
  const problems = [
    ...(!todo ? ["todo audit artifact is missing"] : []),
    ...(current.validation.ok ? [] : current.validation.blockers),
    ...(todo && !todoAuditArtifactMatches(todoManifest, current)
      ? ["latest todo audit artifact must match current docs, current completion-audit blockers, and keep commandUploadEnabled false"]
      : [])
  ];

  return {
    id: "todo-blocker-consistency",
    requirement: "Unchecked planning TODOs stay aligned with current real-world blocker categories.",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "TODO audit confirms unchecked planning items still cover the current completion-audit real-world blocker categories.",
    evidence: [
      "docs/SEEKR_GCS_ALPHA_TODO.md",
      "docs/SEEKR_COMPLETION_PLAN.md",
      ".tmp/completion-audit",
      todo?.relativePath
    ].filter(isString)
  };
}

async function plugAndPlayReadinessItem(root: string, completionAudit: CompletionAuditManifest): Promise<GoalAuditItem> {
  const readiness = await latestJson(root, ".tmp/plug-and-play-readiness", (name) => name.startsWith("seekr-plug-and-play-readiness-"));
  const manifest = readiness ? await readJson(readiness.absolutePath) : undefined;
  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const apiProbe = await latestJson(root, ".tmp/api-probe", (name) => name.startsWith("seekr-api-probe-"));
  const setup = await latestJson(root, ".tmp/plug-and-play-setup", (name) => name.startsWith("seekr-local-setup-"));
  const doctor = await latestOperatorDoctorJson(root);
  const sourceControl = await latestJson(root, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
  const sourceControlManifest = sourceControl ? await readJson(sourceControl.absolutePath) : undefined;
  const localAiPrepare = await latestJson(root, ".tmp/local-ai-prepare", (name) => name.startsWith("seekr-local-ai-prepare-"));
  const rehearsalStartSmoke = await latestJson(root, ".tmp/rehearsal-start-smoke", (name) => name.startsWith("seekr-rehearsal-start-smoke-"));
  const bundle = await latestJson(root, ".tmp/handoff-bundles", (name) => name.startsWith("seekr-handoff-bundle-"));
  const bundleVerification = await latestJson(root, ".tmp/handoff-bundles", (name) => name.startsWith("seekr-review-bundle-verification-"));
  const bundleVerificationManifest = bundleVerification ? await readJson(bundleVerification.absolutePath) : undefined;
  const workflow = await latestJson(root, ".tmp/gstack-workflow-status", (name) => name.startsWith("seekr-gstack-workflow-status-"));
  const todo = await latestJson(root, ".tmp/todo-audit", (name) => name.startsWith("seekr-todo-audit-"));
  const ai = isRecord(manifest) && isRecord(manifest.ai) ? manifest.ai : {};
  const readinessSourceControl = isRecord(manifest) && isRecord(manifest.sourceControl) ? manifest.sourceControl : undefined;
  const readinessReviewBundle = isRecord(manifest) && isRecord(manifest.reviewBundle) ? manifest.reviewBundle : undefined;
  const bundleSecretScan = isRecord(bundleVerificationManifest) && isRecord(bundleVerificationManifest.secretScan) ? bundleVerificationManifest.secretScan : undefined;
  const blockers = isRecord(manifest) && Array.isArray(manifest.remainingRealWorldBlockers)
    ? manifest.remainingRealWorldBlockers.map(String)
    : [];
  const readinessEvidence = plugAndPlayReadinessEvidencePaths(root, manifest);
  const readinessWarnings = plugAndPlayReadinessWarningDetails(manifest);
  const problems: string[] = [];

  if (!readiness) problems.push("plug-and-play readiness artifact is missing");
  if (!isRecord(manifest)) problems.push("plug-and-play readiness artifact is malformed");
  if (isRecord(manifest) && !Array.isArray(manifest.checks)) problems.push("plug-and-play readiness must include check evidence paths");
  if (isRecord(manifest) && manifest.commandUploadEnabled !== false) problems.push("plug-and-play readiness must keep commandUploadEnabled false");
  if (isRecord(manifest) && manifest.localPlugAndPlayOk !== true) problems.push("plug-and-play readiness must report localPlugAndPlayOk true");
  if (isRecord(manifest) && manifest.complete !== completionAudit.complete) problems.push("plug-and-play readiness complete flag must match the current completion audit");
  if (isRecord(ai) && ai.implemented !== true) problems.push("plug-and-play readiness must prove local AI is implemented");
  if (isRecord(ai) && ai.provider !== "ollama") problems.push("plug-and-play readiness must preserve local Ollama AI evidence");
  const persistedBlockerCount = isRecord(manifest) && typeof manifest.remainingRealWorldBlockerCount === "number"
    ? manifest.remainingRealWorldBlockerCount
    : undefined;
  if (isRecord(manifest) && persistedBlockerCount === undefined) {
    problems.push("plug-and-play readiness must persist the current real-world blocker count");
  }
  if (persistedBlockerCount !== undefined && persistedBlockerCount !== blockers.length) {
    problems.push("plug-and-play readiness blocker count must match its blocker list");
  }
  if (isRecord(manifest) && blockers.length !== completionAudit.realWorldBlockers.length) {
    problems.push("plug-and-play readiness must preserve the current real-world blocker count");
  }
  if (completionAudit.realWorldBlockers.length && isRecord(manifest) && manifest.status !== "ready-local-plug-and-play-real-world-blocked") {
    problems.push("plug-and-play readiness must stay real-world-blocked while physical evidence is missing");
  }
  const readinessGeneratedAt = isRecord(manifest) ? timeMs(manifest.generatedAt) : undefined;
  const acceptanceGeneratedAt = isRecord(acceptance) ? timeMs(acceptance.generatedAt) : undefined;
  if (isRecord(manifest) && acceptanceGeneratedAt !== undefined && readinessGeneratedAt === undefined) {
    problems.push("plug-and-play readiness must record a parseable generatedAt timestamp");
  } else if (readinessGeneratedAt !== undefined && acceptanceGeneratedAt !== undefined && readinessGeneratedAt < acceptanceGeneratedAt) {
    problems.push("plug-and-play readiness must be newer than or equal to the latest acceptance record");
  }
  for (const [label, artifact] of [
    ["latest API probe", apiProbe],
    ["latest plug-and-play setup", setup],
    ["latest plug-and-play doctor", doctor],
    ["latest source-control handoff", sourceControl],
    ["latest local AI prepare", localAiPrepare],
    ["latest rehearsal-start smoke", rehearsalStartSmoke],
    ["latest handoff bundle", bundle],
    ["latest handoff bundle verification", bundleVerification],
    ["latest gstack workflow status", workflow],
    ["latest TODO audit", todo]
  ] as const) {
    if (!artifact) {
      problems.push(`${label} artifact is missing`);
    } else if (isRecord(manifest) && !readinessEvidence.has(artifact.relativePath)) {
      problems.push(`plug-and-play readiness must reference the ${label} artifact`);
    }
  }
  if (isRecord(manifest) && !readinessEvidence.has("docs/OPERATOR_QUICKSTART.md")) {
    problems.push("plug-and-play readiness must reference docs/OPERATOR_QUICKSTART.md");
  }
  if (isRecord(manifest) && !readinessSourceControl) {
    problems.push("plug-and-play readiness must publish a source-control summary");
  }
  if (readinessSourceControl && sourceControl && normalizeArtifactPath(root, readinessSourceControl.path) !== sourceControl.relativePath) {
    problems.push("plug-and-play readiness source-control summary must point at the latest source-control handoff");
  }
  if (readinessSourceControl && isRecord(sourceControlManifest) && sourceControlManifest.ready === true) {
    if (stringOrUndefined(readinessSourceControl.generatedAt) !== stringOrUndefined(sourceControlManifest.generatedAt)) {
      problems.push("plug-and-play readiness source-control generatedAt summary must match the latest source-control handoff");
    }
    if (stringOrUndefined(readinessSourceControl.status) !== stringOrUndefined(sourceControlManifest.status)) {
      problems.push("plug-and-play readiness source-control status summary must match the latest source-control handoff");
    }
    if (booleanOrUndefined(readinessSourceControl.ready) !== booleanOrUndefined(sourceControlManifest.ready)) {
      problems.push("plug-and-play readiness source-control ready summary must match the latest source-control handoff");
    }
    if (stringOrUndefined(readinessSourceControl.repositoryUrl) !== stringOrUndefined(sourceControlManifest.repositoryUrl)) {
      problems.push("plug-and-play readiness source-control repository URL summary must match the latest source-control handoff");
    }
    if (stringOrUndefined(readinessSourceControl.packageRepositoryUrl) !== stringOrUndefined(sourceControlManifest.packageRepositoryUrl)) {
      problems.push("plug-and-play readiness source-control package repository summary must match the latest source-control handoff");
    }
    if (!sameStringArray(stringArray(readinessSourceControl.configuredRemoteUrls), stringArray(sourceControlManifest.configuredRemoteUrls))) {
      problems.push("plug-and-play readiness source-control configured-remotes summary must match the latest source-control handoff");
    }
    if (stringOrUndefined(readinessSourceControl.remoteDefaultBranch) !== stringOrUndefined(sourceControlManifest.remoteDefaultBranch)) {
      problems.push("plug-and-play readiness source-control remote default branch summary must match the latest source-control handoff");
    }
    if (numberOrUndefined(readinessSourceControl.remoteRefCount) !== numberOrUndefined(sourceControlManifest.remoteRefCount)) {
      problems.push("plug-and-play readiness source-control remote ref-count summary must match the latest source-control handoff");
    }
    if (stringOrUndefined(readinessSourceControl.localHeadSha) !== stringOrUndefined(sourceControlManifest.localHeadSha)) {
      problems.push("plug-and-play readiness source-control local HEAD summary must match the latest source-control handoff");
    }
    if (stringOrUndefined(readinessSourceControl.remoteDefaultBranchSha) !== stringOrUndefined(sourceControlManifest.remoteDefaultBranchSha)) {
      problems.push("plug-and-play readiness source-control remote default SHA summary must match the latest source-control handoff");
    }
    if (booleanOrUndefined(readinessSourceControl.workingTreeClean) !== booleanOrUndefined(sourceControlManifest.workingTreeClean)) {
      problems.push("plug-and-play readiness source-control clean-worktree summary must match the latest source-control handoff");
    }
    if (numberOrUndefined(readinessSourceControl.workingTreeStatusLineCount) !== numberOrUndefined(sourceControlManifest.workingTreeStatusLineCount)) {
      problems.push("plug-and-play readiness source-control working-tree status line summary must match the latest source-control handoff");
    }
  }
  if (isRecord(manifest) && !readinessReviewBundle) {
    problems.push("plug-and-play readiness must publish a review-bundle summary");
  }
  if (readinessReviewBundle && bundle && normalizeArtifactPath(root, readinessReviewBundle.path) !== bundle.relativePath) {
    problems.push("plug-and-play readiness review-bundle summary must point at the latest handoff bundle");
  }
  if (readinessReviewBundle && bundleVerification && normalizeArtifactPath(root, readinessReviewBundle.verificationPath) !== bundleVerification.relativePath) {
    problems.push("plug-and-play readiness review-bundle summary must point at the latest bundle verification");
  }
  if (readinessReviewBundle && isRecord(bundleVerificationManifest)) {
    if (stringOrUndefined(readinessReviewBundle.status) !== stringOrUndefined(bundleVerificationManifest.status)) {
      problems.push("plug-and-play readiness review-bundle status summary must match the latest bundle verification");
    }
    if (numberOrUndefined(readinessReviewBundle.checkedFileCount) !== numberOrUndefined(bundleVerificationManifest.checkedFileCount)) {
      problems.push("plug-and-play readiness review-bundle checked-file summary must match the latest bundle verification");
    }
    if (stringOrUndefined(readinessReviewBundle.secretScanStatus) !== (isRecord(bundleSecretScan) ? stringOrUndefined(bundleSecretScan.status) : undefined)) {
      problems.push("plug-and-play readiness review-bundle secret-scan summary must match the latest bundle verification");
    }
    if (normalizeArtifactPath(root, readinessReviewBundle.sourceControlHandoffPath) !== normalizeArtifactPath(root, bundleVerificationManifest.sourceControlHandoffPath)) {
      problems.push("plug-and-play readiness review-bundle source-control path summary must match the latest bundle verification");
    }
    if (stringOrUndefined(readinessReviewBundle.sourceControlHandoffRepositoryUrl) !== stringOrUndefined(bundleVerificationManifest.sourceControlHandoffRepositoryUrl)) {
      problems.push("plug-and-play readiness review-bundle source-control repository URL summary must match the latest bundle verification");
    }
    if (stringOrUndefined(readinessReviewBundle.sourceControlHandoffPackageRepositoryUrl) !== stringOrUndefined(bundleVerificationManifest.sourceControlHandoffPackageRepositoryUrl)) {
      problems.push("plug-and-play readiness review-bundle source-control package repository summary must match the latest bundle verification");
    }
    if (!sameStringArray(stringArray(readinessReviewBundle.sourceControlHandoffConfiguredRemoteUrls), stringArray(bundleVerificationManifest.sourceControlHandoffConfiguredRemoteUrls))) {
      problems.push("plug-and-play readiness review-bundle source-control configured-remotes summary must match the latest bundle verification");
    }
    if (stringOrUndefined(readinessReviewBundle.sourceControlHandoffRemoteDefaultBranch) !== stringOrUndefined(bundleVerificationManifest.sourceControlHandoffRemoteDefaultBranch)) {
      problems.push("plug-and-play readiness review-bundle source-control remote default branch summary must match the latest bundle verification");
    }
    if (numberOrUndefined(readinessReviewBundle.sourceControlHandoffRemoteRefCount) !== numberOrUndefined(bundleVerificationManifest.sourceControlHandoffRemoteRefCount)) {
      problems.push("plug-and-play readiness review-bundle source-control remote ref-count summary must match the latest bundle verification");
    }
    if (stringOrUndefined(readinessReviewBundle.sourceControlHandoffLocalHeadSha) !== stringOrUndefined(bundleVerificationManifest.sourceControlHandoffLocalHeadSha)) {
      problems.push("plug-and-play readiness review-bundle source-control local HEAD summary must match the latest bundle verification");
    }
    if (stringOrUndefined(readinessReviewBundle.sourceControlHandoffRemoteDefaultBranchSha) !== stringOrUndefined(bundleVerificationManifest.sourceControlHandoffRemoteDefaultBranchSha)) {
      problems.push("plug-and-play readiness review-bundle source-control remote default SHA summary must match the latest bundle verification");
    }
    if (booleanOrUndefined(readinessReviewBundle.sourceControlHandoffWorkingTreeClean) !== booleanOrUndefined(bundleVerificationManifest.sourceControlHandoffWorkingTreeClean)) {
      problems.push("plug-and-play readiness review-bundle source-control clean-worktree summary must match the latest bundle verification");
    }
    if (numberOrUndefined(readinessReviewBundle.sourceControlHandoffWorkingTreeStatusLineCount) !== numberOrUndefined(bundleVerificationManifest.sourceControlHandoffWorkingTreeStatusLineCount)) {
      problems.push("plug-and-play readiness review-bundle source-control working-tree status line summary must match the latest bundle verification");
    }
  }

  return {
    id: "plug-and-play-readiness",
    requirement: "The system has concrete local plug-and-play readiness evidence with implemented local AI and explicit real-world blockers.",
    status: problems.length ? "fail" : readinessWarnings.length ? "warn" : "pass",
    details: problems.length
      ? problems.join("; ")
      : readinessWarnings.length
        ? `Plug-and-play readiness confirms local app, AI, API, QA, setup, local AI prepare, doctor, rehearsal-start smoke, acceptance, and review-bundle evidence with warning(s): ${readinessWarnings.join("; ")}.`
      : "Plug-and-play readiness confirms local app, AI, API, QA, setup, local AI prepare, doctor, rehearsal-start smoke, acceptance, and review-bundle evidence while preserving real-world blockers.",
    evidence: [
      readiness?.relativePath,
      apiProbe?.relativePath,
      setup?.relativePath,
      doctor?.relativePath,
      sourceControl?.relativePath,
      localAiPrepare?.relativePath,
      rehearsalStartSmoke?.relativePath,
      bundle?.relativePath,
      bundleVerification?.relativePath,
      workflow?.relativePath,
      todo?.relativePath,
      "docs/OPERATOR_QUICKSTART.md",
      ".tmp/acceptance-status.json"
    ].filter(isString)
  };
}

function plugAndPlayReadinessWarningDetails(manifest: unknown) {
  if (!isRecord(manifest)) return [];
  const checks = Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  return checks
    .filter((check) => check.status === "warn")
    .map((check) => {
      const id = String(check.id ?? "unknown");
      const details = typeof check.details === "string" && check.details.length ? check.details : "warning details unavailable";
      return `${id}: ${details}`;
    });
}

function plugAndPlayReadinessEvidencePaths(root: string, manifest: unknown) {
  const paths = new Set<string>();
  const checks = isRecord(manifest) && Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  for (const check of checks) {
    for (const item of normalizeArtifactPaths(root, check.evidence)) paths.add(item);
  }
  return paths;
}

function remainingRealWorldBlockers(completionAudit: { complete: boolean; realWorldBlockers: string[] }) {
  if (completionAudit.complete && completionAudit.realWorldBlockers.length === 0) return [];
  return blockerCategoryTexts(completionAudit.realWorldBlockers);
}

function realWorldBlockersItem(completionAudit: { complete: boolean; realWorldBlockers: string[] }): GoalAuditItem {
  if (completionAudit.complete && completionAudit.realWorldBlockers.length === 0) {
    return {
      id: "real-world-blockers",
      requirement: "The audit must not mark the goal complete while fresh-operator and real hardware evidence are absent.",
      status: "pass",
      details: "Completion audit reports no remaining real-world blockers; physical evidence is present and validated.",
      evidence: ["docs/goal.md", "docs/SEEKR_GCS_ALPHA_TODO.md", "docs/SEEKR_COMPLETION_PLAN.md", ".tmp/completion-audit"]
    };
  }

  const categories = blockerCategoryTexts(completionAudit.realWorldBlockers);

  return {
    id: "real-world-blockers",
    requirement: "The audit must not mark the goal complete while fresh-operator and real hardware evidence are absent.",
    status: "blocked",
    details: `Local alpha evidence is ready, but ${categories.length} real-world blocker category/categories remain. Completion audit currently reports ${completionAudit.realWorldBlockers.length} blocker item(s).`,
    evidence: ["docs/goal.md", "docs/SEEKR_GCS_ALPHA_TODO.md", "docs/SEEKR_COMPLETION_PLAN.md", ".tmp/completion-audit"]
  };
}

function blockerCategoryTexts(realWorldBlockers: string[]) {
  const matched = REQUIRED_REAL_WORLD_BLOCKERS
    .filter((definition) => realWorldBlockers.some((blocker) => matchesAllPatterns(blocker, definition.patterns)))
    .map((definition) => definition.text);
  const unmatched = realWorldBlockers.filter((blocker) =>
    !REQUIRED_REAL_WORLD_BLOCKERS.some((definition) => matchesAllPatterns(blocker, definition.patterns))
  );
  return [...matched, ...unmatched];
}

async function gstackQaReportOk(root: string, qaReport: Record<string, unknown>) {
  const status = String(qaReport.status);
  const limitations = limitationStrings(qaReport);
  const reportPath = normalizeArtifactPath(root, qaReport.path);
  const screenshotPaths = normalizeArtifactPaths(root, qaReport.screenshotPaths);
  const screenshotExistence = await Promise.all(screenshotPaths.map((screenshotPath) => pathExists(path.resolve(root, screenshotPath))));
  const screenshotsExist = screenshotExistence.every(Boolean);
  const reportScreenshotsMatch = !reportPath || arraysEqual(extractQaScreenshotPaths(await readText(path.resolve(root, reportPath))), screenshotPaths);
  return qaReport.commandUploadEnabled === false &&
    (status === "pass" || limitations.length > 0) &&
    (status === "missing" ||
      ((status === "pass" || status === "stale") && typeof qaReport.path === "string" && qaReport.path.length > 0)) &&
    screenshotsExist &&
    reportScreenshotsMatch;
}

function artifactIdsAreExact(items: Record<string, unknown>[], requiredIds: string[]) {
  return items.length === requiredIds.length &&
    items.every((item, index) => String(item.id ?? "") === requiredIds[index]);
}

function gstackHealthHistoryOk(healthHistory: Record<string, unknown>) {
  const status = String(healthHistory.status);
  const limitations = limitationStrings(healthHistory);
  return healthHistory.commandUploadEnabled === false &&
    (status === "pass" || limitations.length > 0) &&
    (status === "missing" ||
      ((status === "pass" || status === "stale") && typeof healthHistory.path === "string" && healthHistory.path.length > 0));
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

function limitationStrings(value: Record<string, unknown>) {
  return Array.isArray(value.limitations)
    ? value.limitations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function matchesAllPatterns(value: string, patterns: RegExp[]) {
  return patterns.every((pattern) => pattern.test(value));
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
    if (await metadataPathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function metadataPathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function renderMarkdown(manifest: GoalAuditManifest) {
  const lines = [
    "# SEEKR Goal Audit",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `Local alpha ok: ${manifest.localAlphaOk}`,
    `Complete: ${manifest.complete}`,
    `Command upload enabled: ${manifest.commandUploadEnabled}`,
    "",
    "## Objective",
    "",
    manifest.objective,
    "",
    "## Prompt-To-Artifact Checklist",
    "",
    "| Requirement | Status | Evidence | Details |",
    "| --- | --- | --- | --- |",
    ...manifest.promptToArtifactChecklist.map((item) =>
      `| ${escapeMarkdown(item.requirement)} | ${item.status} | ${escapeMarkdown(item.evidence.join(", "))} | ${escapeMarkdown(item.details)} |`
    ),
    "",
    "## Remaining Real-World Blockers",
    "",
    `Count: ${manifest.remainingRealWorldBlockerCount}`,
    "",
    ...manifest.remainingRealWorldBlockers.map((blocker) => `- ${blocker}`),
    "",
    "## Safety Boundary",
    "",
    "- realAircraftCommandUpload: false",
    "- hardwareActuationEnabled: false",
    "- runtimePolicyInstalled: false",
    "",
    "## Limitations",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

async function latestJson(root: string, directory: string, predicate: (name: string) => boolean) {
  const absoluteDir = path.join(root, directory);
  try {
    const names = (await readdir(absoluteDir)).filter((name) => name.endsWith(".json") && predicate(name)).sort();
    const latest = names.at(-1);
    if (!latest) return undefined;
    return {
      absolutePath: path.join(absoluteDir, latest),
      relativePath: path.join(directory, latest).split(path.sep).join("/")
    };
  } catch {
    return undefined;
  }
}

async function latestOperatorDoctorJson(root: string) {
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
        relativePath: path.join(directory, name).split(path.sep).join("/")
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
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function scanPassed(manifest: unknown) {
  const summary = isRecord(manifest) && isRecord(manifest.summary) ? manifest.summary : {};
  return isRecord(manifest) &&
    manifest.status === "pass" &&
    manifest.commandUploadEnabled === false &&
    Number(summary.violationCount) === 0;
}

function authorizationFalse(manifest: unknown) {
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) return false;
  const safety = isRecord(manifest.safetyBoundary) ? manifest.safetyBoundary : {};
  const authorization = isRecord(manifest.authorization) ? manifest.authorization : {};
  return (safety.realAircraftCommandUpload ?? authorization.realAircraftCommandUpload ?? false) === false &&
    (safety.hardwareActuationEnabled ?? authorization.hardwareActuationEnabled ?? false) === false &&
    (safety.runtimePolicyInstalled ?? authorization.runtimePolicyInstalled ?? false) === false;
}

function normalizeArtifactPath(root: string, value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const absolute = path.isAbsolute(value) ? value : path.resolve(root, value);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

function normalizeArtifactPaths(root: string, value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeArtifactPath(root, item))
    .filter(isString)
    .sort((left, right) => left.localeCompare(right));
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

function todoAuditArtifactMatches(manifest: unknown, current: TodoAuditManifest) {
  if (!isRecord(manifest)) return false;
  const completion = isRecord(manifest.completionAudit) ? manifest.completionAudit : {};
  const validation = isRecord(manifest.validation) ? manifest.validation : {};
  return manifest.schemaVersion === 1 &&
    manifest.commandUploadEnabled === false &&
    manifest.status === current.status &&
    Number(manifest.uncheckedTodoCount) === current.uncheckedTodoCount &&
    Number(manifest.categoryCount) === current.categoryCount &&
    Number(manifest.realWorldBlockerCount) === current.realWorldBlockerCount &&
    Number(manifest.blockedCategoryCount) === current.blockedCategoryCount &&
    Number(manifest.validationBlockerCount) === current.validationBlockerCount &&
    validation.ok === current.validation.ok &&
    completion.status === current.completionAudit.status &&
    completion.localAlphaOk === current.completionAudit.localAlphaOk &&
    completion.complete === current.completionAudit.complete &&
    completion.commandUploadEnabled === false &&
    Number(completion.realWorldBlockerCount) === current.completionAudit.realWorldBlockerCount &&
    sameStringArray(todoSignaturesFromUnknown(manifest.uncheckedTodos), todoSignaturesFromManifest(current.uncheckedTodos)) &&
    sameStringArray(categorySignaturesFromUnknown(manifest.categories), categorySignaturesFromManifest(current.categories));
}

function todoSignaturesFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((todo) =>
    `${String(todo.sourcePath ?? "")}:${Number(todo.line)}:${String(todo.text ?? "")}`
  );
}

function todoSignaturesFromManifest(value: TodoAuditManifest["uncheckedTodos"]) {
  return value.map((todo) => `${todo.sourcePath}:${todo.line}:${todo.text}`);
}

function categorySignaturesFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((category) => {
    const todoMatches = Array.isArray(category.todoMatches) ? category.todoMatches.length : 0;
    const blockerMatches = Array.isArray(category.completionBlockerMatches) ? category.completionBlockerMatches.length : 0;
    return `${String(category.id ?? "")}:${String(category.status ?? "")}:${todoMatches}:${blockerMatches}`;
  });
}

function categorySignaturesFromManifest(value: TodoAuditManifest["categories"]) {
  return value.map((category) =>
    `${category.id}:${category.status}:${category.todoMatches.length}:${category.completionBlockerMatches.length}`
  );
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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

function timeMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function escapeMarkdown(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  writeGoalAudit()
    .then(({ manifest, jsonPath, markdownPath }) => {
      console.log(JSON.stringify({
        ok: manifest.localAlphaOk,
        complete: manifest.complete,
        status: manifest.status,
        commandUploadEnabled: manifest.commandUploadEnabled,
        summary: manifest.summary,
        remainingRealWorldBlockerCount: manifest.remainingRealWorldBlockerCount,
        jsonPath,
        markdownPath
      }, null, 2));
      process.exit(manifest.localAlphaOk ? 0 : 1);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
