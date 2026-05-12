import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";
import { REQUIRED_STRICT_AI_SMOKE_CASES, isLocalOllamaUrl } from "../src/server/ai/localAiEvidence";

type ChainStatus = "pass" | "warn" | "fail";

export interface HandoffIndexChainCheck {
  id: string;
  label: string;
  status: ChainStatus;
  details: string;
  evidence: string[];
}

export interface HandoffIndexArtifactDigest {
  path: string;
  bytes: number;
  sha256: string;
}

export interface HandoffIndexManifest {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  status: "ready-local-alpha-handoff" | "blocked-local-alpha-handoff";
  localAlphaOk: boolean;
  complete: boolean;
  commandUploadEnabled: false;
  artifacts: {
    acceptanceStatusPath: string;
    releaseEvidenceJsonPath?: string;
    releaseEvidenceSha256Path?: string;
    releaseEvidenceMarkdownPath?: string;
    completionAuditJsonPath?: string;
    completionAuditMarkdownPath?: string;
    demoReadinessJsonPath?: string;
    demoReadinessMarkdownPath?: string;
    benchEvidencePacketJsonPath?: string;
    benchEvidencePacketMarkdownPath?: string;
    hardwareEvidenceJsonPath?: string;
    hardwareEvidenceMarkdownPath?: string;
    policyGateJsonPath?: string;
    policyGateMarkdownPath?: string;
    safetyScanJsonPath?: string;
    safetyScanMarkdownPath?: string;
    apiProbeJsonPath?: string;
    apiProbeMarkdownPath?: string;
    overnightStatusPath?: string;
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
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
  artifactDigests: HandoffIndexArtifactDigest[];
  evidenceChain: HandoffIndexChainCheck[];
  realWorldBlockers: string[];
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/handoff-index";
const ACCEPTANCE_STATUS_PATH = ".tmp/acceptance-status.json";
const OVERNIGHT_STATUS_PATH = ".tmp/overnight/STATUS.md";

export async function buildHandoffIndex(options: {
  root?: string;
  generatedAt?: string;
  label?: string;
} = {}): Promise<HandoffIndexManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label ?? "internal-alpha";

  const acceptance = await readJson(path.join(root, ACCEPTANCE_STATUS_PATH));
  const release = await latestJson(root, ".tmp/release-evidence", (name) => name.startsWith("seekr-release-"));
  const audit = await latestJson(root, ".tmp/completion-audit", (name) => name.startsWith("seekr-completion-audit-"));
  const demo = await latestJson(root, ".tmp/demo-readiness", (name) => name.startsWith("seekr-demo-readiness-"));
  const bench = await latestJson(root, ".tmp/bench-evidence-packet", (name) => name.startsWith("seekr-bench-evidence-packet-"));
  const hardware = await latestJson(root, ".tmp/hardware-evidence", (name) => name.startsWith("seekr-hardware-evidence-"));
  const policy = await latestJson(root, ".tmp/policy-evidence", (name) => name.startsWith("seekr-hardware-actuation-gate-"));
  const safety = await latestJson(root, ".tmp/safety-evidence", (name) => name.startsWith("seekr-command-boundary-scan-"));
  const apiProbe = await latestJson(root, ".tmp/api-probe", (name) => name.startsWith("seekr-api-probe-"));
  const overnight = await readOvernight(root, generatedAt);

  const releaseManifest = release ? await readJson(release.absolutePath) : undefined;
  const auditManifest = audit ? await readJson(audit.absolutePath) : undefined;
  const demoManifest = demo ? await readJson(demo.absolutePath) : undefined;
  const benchManifest = bench ? await readJson(bench.absolutePath) : undefined;
  const safetyManifest = safety ? await readJson(safety.absolutePath) : undefined;
  const apiProbeManifest = apiProbe ? await readJson(apiProbe.absolutePath) : undefined;

  const evidenceChain: HandoffIndexChainCheck[] = [
    validateAcceptance(acceptance),
    validateRelease(release, releaseManifest, acceptance, root),
    validateCompletionAudit(audit, auditManifest),
    validateSafetyScan(safety, safetyManifest, acceptance, root),
    validateApiProbe(apiProbe, apiProbeManifest, acceptance),
    validateDemoPackage({
      demo,
      demoManifest,
      acceptance,
      release,
      releaseManifest,
      audit,
      auditManifest,
      safety,
      apiProbe,
      hardware,
      policy
    }),
    validateBenchPacket({
      bench,
      benchManifest,
      demo,
      demoManifest
    }),
    validateOptionalHardwareArchive(hardware, demoManifest),
    validateOptionalPolicyGate(policy, demoManifest),
    validateOvernight(overnight)
  ];

  const blockers = evidenceChain
    .filter((check) => check.status === "fail")
    .map((check) => `${check.label}: ${check.details}`);
  const warnings = evidenceChain
    .filter((check) => check.status === "warn")
    .map((check) => `${check.label}: ${check.details}`);
  const localAlphaOk = blockers.length === 0;
  const complete = isRecord(auditManifest) && auditManifest.complete === true &&
    isRecord(demoManifest) && demoManifest.complete === true &&
    isRecord(benchManifest) && benchManifest.complete === true;
  const artifacts = {
    acceptanceStatusPath: ACCEPTANCE_STATUS_PATH,
    releaseEvidenceJsonPath: release?.relativePath,
    releaseEvidenceSha256Path: release ? replaceExtension(release.relativePath, ".sha256") : undefined,
    releaseEvidenceMarkdownPath: release ? replaceExtension(release.relativePath, ".md") : undefined,
    completionAuditJsonPath: audit?.relativePath,
    completionAuditMarkdownPath: audit ? replaceExtension(audit.relativePath, ".md") : undefined,
    demoReadinessJsonPath: demo?.relativePath,
    demoReadinessMarkdownPath: demo ? replaceExtension(demo.relativePath, ".md") : undefined,
    benchEvidencePacketJsonPath: bench?.relativePath,
    benchEvidencePacketMarkdownPath: bench ? replaceExtension(bench.relativePath, ".md") : undefined,
    hardwareEvidenceJsonPath: hardware?.relativePath,
    hardwareEvidenceMarkdownPath: hardware ? replaceExtension(hardware.relativePath, ".md") : undefined,
    policyGateJsonPath: policy?.relativePath,
    policyGateMarkdownPath: policy ? replaceExtension(policy.relativePath, ".md") : undefined,
    safetyScanJsonPath: safety?.relativePath,
    safetyScanMarkdownPath: safety ? replaceExtension(safety.relativePath, ".md") : undefined,
    apiProbeJsonPath: apiProbe?.relativePath,
    apiProbeMarkdownPath: apiProbe ? replaceExtension(apiProbe.relativePath, ".md") : undefined,
    overnightStatusPath: overnight ? OVERNIGHT_STATUS_PATH : undefined
  };
  const artifactDigests = await buildArtifactDigests(root, artifacts);

  return {
    schemaVersion: 1,
    generatedAt,
    label,
    status: localAlphaOk ? "ready-local-alpha-handoff" : "blocked-local-alpha-handoff",
    localAlphaOk,
    complete,
    commandUploadEnabled: false,
    artifacts,
    validation: {
      ok: localAlphaOk,
      warnings,
      blockers
    },
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
    artifactDigests,
    evidenceChain,
    realWorldBlockers: realWorldBlockersFrom(demoManifest, auditManifest),
    limitations: [
      localAlphaOk
        ? "This index is ready for an internal local-alpha handoff."
        : "This index is blocked because handoff evidence is missing, stale, or inconsistent.",
      "This index only verifies local evidence links and safety-boundary metadata; it does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware actuation.",
      "Real MAVLink, ROS 2, PX4, ArduPilot, mission, geofence, mode, arm, takeoff, land, RTH, terminate, and waypoint command paths remain blocked outside simulator/SITL transports."
    ]
  };
}

export async function writeHandoffIndex(options: Parameters<typeof buildHandoffIndex>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildHandoffIndex(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const safeLabel = safeFileNamePart(manifest.label, "internal-alpha");
  const baseName = `seekr-handoff-index-${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function validateAcceptance(acceptance: unknown): HandoffIndexChainCheck {
  const ok = isRecord(acceptance) && acceptance.ok === true && acceptance.commandUploadEnabled === false;
  return {
    id: "acceptance-status",
    label: "Acceptance status",
    status: ok ? "pass" : "fail",
    details: ok
      ? "Acceptance status passes and keeps command upload disabled."
      : "Acceptance status must exist, pass, and keep commandUploadEnabled false.",
    evidence: [ACCEPTANCE_STATUS_PATH]
  };
}

function validateRelease(release: LatestJson | undefined, releaseManifest: unknown, acceptance: unknown, root: string): HandoffIndexChainCheck {
  if (!release) {
    return {
      id: "release-evidence",
      label: "Release evidence",
      status: "fail",
      details: "No release checksum JSON evidence exists.",
      evidence: [".tmp/release-evidence"]
    };
  }

  const acceptanceRelease = isRecord(acceptance) && isRecord(acceptance.releaseChecksum) ? acceptance.releaseChecksum : {};
  const expectedShaPath = replaceExtension(release.relativePath, ".sha256");
  const expectedMarkdownPath = replaceExtension(release.relativePath, ".md");
  const manifestOk = isRecord(releaseManifest) &&
    releaseManifest.commandUploadEnabled === false &&
    typeof releaseManifest.overallSha256 === "string";
  const problems: string[] = [];
  if (!manifestOk) problems.push("latest release evidence must keep commandUploadEnabled false and include an overall SHA-256");
  if (!isRecord(acceptanceRelease)) {
    problems.push("acceptance status is missing release checksum evidence");
  } else {
    if (normalizeArtifactPath(root, acceptanceRelease.jsonPath) !== release.relativePath) {
      problems.push("acceptance release checksum path does not point at the latest release evidence");
    }
    if (normalizeArtifactPath(root, acceptanceRelease.sha256Path) !== expectedShaPath) {
      problems.push("acceptance release checksum SHA-256 path does not point at the latest release evidence");
    }
    if (normalizeArtifactPath(root, acceptanceRelease.markdownPath) !== expectedMarkdownPath) {
      problems.push("acceptance release checksum Markdown path does not point at the latest release evidence");
    }
    if (acceptanceRelease.overallSha256 !== (isRecord(releaseManifest) ? releaseManifest.overallSha256 : undefined)) {
      problems.push("acceptance release checksum SHA does not match latest release evidence");
    }
    if (Number(acceptanceRelease.fileCount) !== Number(isRecord(releaseManifest) ? releaseManifest.fileCount : undefined)) {
      problems.push("acceptance release file count does not match latest release evidence");
    }
    if (Number(acceptanceRelease.totalBytes) !== Number(isRecord(releaseManifest) ? releaseManifest.totalBytes : undefined)) {
      problems.push("acceptance release byte count does not match latest release evidence");
    }
  }
  return {
    id: "release-evidence",
    label: "Release evidence",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Latest release checksum evidence is ${release.relativePath} and matches acceptance status paths and metadata.`,
    evidence: [release.relativePath]
  };
}

function validateCompletionAudit(audit: LatestJson | undefined, auditManifest: unknown): HandoffIndexChainCheck {
  if (!audit) {
    return {
      id: "completion-audit",
      label: "Completion audit",
      status: "fail",
      details: "No completion audit JSON evidence exists.",
      evidence: [".tmp/completion-audit"]
    };
  }

  const ok = isRecord(auditManifest) &&
    auditManifest.commandUploadEnabled === false &&
    auditManifest.localAlphaOk === true &&
    typeof auditManifest.status === "string";
  return {
    id: "completion-audit",
    label: "Completion audit",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Latest completion audit is ${audit.relativePath}; complete is ${auditManifest.complete === true}.`
      : "Latest completion audit must keep commandUploadEnabled false and report localAlphaOk true.",
    evidence: [audit.relativePath]
  };
}

function validateSafetyScan(
  safety: LatestJson | undefined,
  safetyManifest: unknown,
  acceptance: unknown,
  root: string
): HandoffIndexChainCheck {
  if (!safety) {
    return {
      id: "command-boundary-scan",
      label: "Command-boundary scan",
      status: "fail",
      details: "No command-boundary scan evidence exists.",
      evidence: [".tmp/safety-evidence"]
    };
  }

  const summary = isRecord(safetyManifest) && isRecord(safetyManifest.summary) ? safetyManifest.summary : {};
  const acceptanceScan = isRecord(acceptance) && isRecord(acceptance.commandBoundaryScan) ? acceptance.commandBoundaryScan : {};
  const expectedMarkdownPath = replaceExtension(safety.relativePath, ".md");
  const problems: string[] = [];
  if (!isRecord(safetyManifest) || safetyManifest.status !== "pass") problems.push("latest scan did not pass");
  if (!isRecord(safetyManifest) || safetyManifest.commandUploadEnabled !== false) problems.push("latest scan did not keep commandUploadEnabled false");
  if (Number(summary.violationCount) !== 0) problems.push("latest scan has command-boundary violations");
  if (!Number.isFinite(Number(summary.scannedFileCount)) || Number(summary.scannedFileCount) <= 0) {
    problems.push("latest scan does not report a positive scanned file count");
  }
  if (!isRecord(acceptanceScan)) problems.push("acceptance status is missing command-boundary scan evidence");
  if (normalizeArtifactPath(root, acceptanceScan.jsonPath) !== safety.relativePath) {
    problems.push("acceptance status command-boundary scan path does not point at the latest safety evidence");
  }
  if (normalizeArtifactPath(root, acceptanceScan.markdownPath) !== expectedMarkdownPath) {
    problems.push("acceptance status command-boundary scan Markdown path does not point at the latest safety evidence");
  }
  if (acceptanceScan.status !== "pass" || acceptanceScan.commandUploadEnabled !== false || Number(acceptanceScan.violationCount) !== 0) {
    problems.push("acceptance status did not preserve passing command-boundary scan safety fields");
  }
  if (Number(acceptanceScan.scannedFileCount) !== Number(summary.scannedFileCount)) {
    problems.push("acceptance status scanned file count does not match latest scan");
  }
  if (Number(acceptanceScan.allowedFindingCount) !== Number(summary.allowedFindingCount)) {
    problems.push("acceptance status allowed finding count does not match latest scan");
  }
  return {
    id: "command-boundary-scan",
    label: "Command-boundary scan",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Latest command-boundary scan passed and matches acceptance status: ${safety.relativePath}.`,
    evidence: [safety.relativePath]
  };
}

function validateApiProbe(apiProbe: LatestJson | undefined, apiProbeManifest: unknown, acceptance: unknown): HandoffIndexChainCheck {
  if (!apiProbe) {
    return {
      id: "api-probe-evidence",
      label: "API probe evidence",
      status: "fail",
      details: "No API probe evidence exists.",
      evidence: [".tmp/api-probe"]
    };
  }

  const checked = isRecord(apiProbeManifest) && Array.isArray(apiProbeManifest.checked)
    ? apiProbeManifest.checked.map(String)
    : [];
  const sessionAcceptance = isRecord(apiProbeManifest) && isRecord(apiProbeManifest.sessionAcceptance)
    ? apiProbeManifest.sessionAcceptance
    : {};
  const problems: string[] = [];
  if (!isRecord(apiProbeManifest) || apiProbeManifest.ok !== true) problems.push("probe ok is not true");
  if (!isRecord(apiProbeManifest) || apiProbeManifest.commandUploadEnabled !== false) problems.push("probe commandUploadEnabled is not false");
  if (!checked.includes("session-acceptance-evidence")) problems.push("probe did not check session-visible acceptance evidence");
  if (sessionAcceptance.commandUploadEnabled !== false) problems.push("probe session acceptance commandUploadEnabled is not false");

  if (isRecord(acceptance) && acceptance.ok === true) {
    const acceptanceRelease = isRecord(acceptance.releaseChecksum) ? acceptance.releaseChecksum : {};
    const probeRelease = isRecord(sessionAcceptance.releaseChecksum) ? sessionAcceptance.releaseChecksum : {};
    const acceptanceScan = isRecord(acceptance.commandBoundaryScan) ? acceptance.commandBoundaryScan : {};
    const probeScan = isRecord(sessionAcceptance.commandBoundaryScan) ? sessionAcceptance.commandBoundaryScan : {};
    const acceptanceAi = isRecord(acceptance.strictLocalAi) ? acceptance.strictLocalAi : {};
    const probeAi = isRecord(sessionAcceptance.strictLocalAi) ? sessionAcceptance.strictLocalAi : {};
    const acceptanceCommandCount = Array.isArray(acceptance.completedCommands) ? acceptance.completedCommands.length : undefined;
    if (sessionAcceptance.status !== "pass") problems.push("probe did not read back passing acceptance status");
    if (Number(sessionAcceptance.generatedAt) !== Number(acceptance.generatedAt)) {
      problems.push("probe generatedAt does not match acceptance status");
    }
    if (acceptanceCommandCount !== undefined && Number(sessionAcceptance.commandCount) !== acceptanceCommandCount) {
      problems.push("probe command count does not match acceptance status");
    }
    if (!strictLocalAiReadbackMatches(probeAi, acceptanceAi)) {
      problems.push("probe strict local AI scenario names do not exactly match acceptance status");
    }
    if (probeRelease.overallSha256 !== acceptanceRelease.overallSha256 ||
      Number(probeRelease.fileCount) !== Number(acceptanceRelease.fileCount) ||
      Number(probeRelease.totalBytes) !== Number(acceptanceRelease.totalBytes)) {
      problems.push("probe release checksum summary does not match acceptance status");
    }
    if (probeScan.status !== "pass" ||
      Number(probeScan.scannedFileCount) !== Number(acceptanceScan.scannedFileCount) ||
      Number(probeScan.violationCount) !== 0 ||
      Number(probeScan.allowedFindingCount) !== Number(acceptanceScan.allowedFindingCount)) {
      problems.push("probe command-boundary scan summary does not match acceptance status");
    }
  }

  return {
    id: "api-probe-evidence",
    label: "API probe evidence",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Latest API probe evidence read back session-visible acceptance evidence: ${apiProbe.relativePath}.`,
    evidence: [apiProbe.relativePath]
  };
}

function strictLocalAiReadbackMatches(probeAi: Record<string, unknown>, acceptanceAi: Record<string, unknown>) {
  const probeCaseNames = stringArray(probeAi.caseNames);
  const acceptanceCaseNames = stringArray(acceptanceAi.caseNames);
  return probeAi.ok === acceptanceAi.ok &&
    probeAi.provider === acceptanceAi.provider &&
    probeAi.model === acceptanceAi.model &&
    probeAi.ollamaUrl === acceptanceAi.ollamaUrl &&
    probeAi.commandUploadEnabled === false &&
    acceptanceAi.commandUploadEnabled === false &&
    isLocalOllamaUrl(acceptanceAi.ollamaUrl) &&
    Number(probeAi.caseCount) === REQUIRED_STRICT_AI_SMOKE_CASES.length &&
    Number(probeAi.caseCount) === Number(acceptanceAi.caseCount) &&
    arraysEqual(acceptanceCaseNames, [...REQUIRED_STRICT_AI_SMOKE_CASES]) &&
    arraysEqual(probeCaseNames, acceptanceCaseNames);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function validateDemoPackage(options: {
  demo: LatestJson | undefined;
  demoManifest: unknown;
  acceptance: unknown;
  release: LatestJson | undefined;
  releaseManifest: unknown;
  audit: LatestJson | undefined;
  auditManifest: unknown;
  safety: LatestJson | undefined;
  apiProbe: LatestJson | undefined;
  hardware: LatestJson | undefined;
  policy: LatestJson | undefined;
}): HandoffIndexChainCheck {
  if (!options.demo) {
    return {
      id: "demo-readiness-package",
      label: "Demo readiness package",
      status: "fail",
      details: "No demo readiness package exists.",
      evidence: [".tmp/demo-readiness"]
    };
  }

  const manifest = options.demoManifest;
  const artifacts = isRecord(manifest) && isRecord(manifest.artifacts) ? manifest.artifacts : {};
  const problems: string[] = [];
  if (!isRecord(manifest) || manifest.status !== "ready-local-alpha" || manifest.localAlphaOk !== true) {
    problems.push("demo package is not ready-local-alpha");
  }
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) problems.push("commandUploadEnabled is not false");
  if (!isRecord(manifest) || !demoHardwareClaimsFalse(manifest)) problems.push("hardware claims are not all false");
  if (isRecord(manifest) && isRecord(manifest.validation) && manifest.validation.ok !== true) problems.push("validation.ok is not true");
  if (artifacts.acceptanceStatusPath !== ACCEPTANCE_STATUS_PATH) problems.push("acceptance path does not match the canonical acceptance status path");
  if (options.release && artifacts.releaseEvidenceJsonPath !== options.release.relativePath) problems.push("release path does not point at the latest release evidence");
  if (options.audit && artifacts.completionAuditJsonPath !== options.audit.relativePath) problems.push("completion audit path does not point at the latest audit evidence");
  if (options.safety && artifacts.safetyScanJsonPath !== options.safety.relativePath) problems.push("safety scan path does not point at the latest command-boundary evidence");
  if (options.apiProbe && artifacts.apiProbeJsonPath !== options.apiProbe.relativePath) problems.push("API probe path does not point at the latest API probe evidence");
  if (options.hardware && artifacts.hardwareEvidenceJsonPath !== options.hardware.relativePath) problems.push("hardware archive path does not point at the latest hardware evidence");
  if (options.policy && artifacts.policyGateJsonPath !== options.policy.relativePath) problems.push("policy gate path does not point at the latest policy evidence");
  if (artifacts.overnightStatusPath !== OVERNIGHT_STATUS_PATH) problems.push("overnight status path is missing or non-canonical");
  if (!releaseChecksumMatchesDemo(manifest, options.releaseManifest)) problems.push("demo release checksum does not match latest release evidence");
  if (!arraysEqual(realWorldBlockersFrom(manifest, undefined), realWorldBlockersFrom(undefined, options.auditManifest))) {
    problems.push("demo real-world blocker list does not match the latest completion audit");
  }

  return {
    id: "demo-readiness-package",
    label: "Demo readiness package",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Latest demo package points at the current local-alpha evidence chain: ${options.demo.relativePath}.`,
    evidence: [options.demo.relativePath]
  };
}

function validateBenchPacket(options: {
  bench: LatestJson | undefined;
  benchManifest: unknown;
  demo: LatestJson | undefined;
  demoManifest: unknown;
}): HandoffIndexChainCheck {
  if (!options.bench) {
    return {
      id: "bench-evidence-packet",
      label: "Bench evidence packet",
      status: "fail",
      details: "No bench evidence packet exists.",
      evidence: [".tmp/bench-evidence-packet"]
    };
  }

  const manifest = options.benchManifest;
  const safetyBoundary = isRecord(manifest) && isRecord(manifest.safetyBoundary) ? manifest.safetyBoundary : {};
  const tasks = isRecord(manifest) && Array.isArray(manifest.tasks) ? manifest.tasks : [];
  const checklist = isRecord(options.demoManifest) && Array.isArray(options.demoManifest.nextEvidenceChecklist)
    ? options.demoManifest.nextEvidenceChecklist
    : [];
  const problems: string[] = [];
  if (!isRecord(manifest) || manifest.status !== "ready-for-bench-prep" || manifest.localAlphaOk !== true) {
    problems.push("bench packet is not ready-for-bench-prep");
  }
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) problems.push("commandUploadEnabled is not false");
  if (isRecord(manifest) && isRecord(manifest.validation) && manifest.validation.ok !== true) problems.push("validation.ok is not true");
  if (options.demo && isRecord(manifest) && manifest.sourceDemoReadinessPackagePath !== options.demo.relativePath) {
    problems.push("source demo package path does not point at the latest demo package");
  }
  if (safetyBoundary.realAircraftCommandUpload !== false ||
    safetyBoundary.hardwareActuationEnabled !== false ||
    safetyBoundary.runtimePolicyInstalled !== false) {
    problems.push("safety boundary authorization fields are not all false");
  }
  if (isRecord(options.demoManifest) && options.demoManifest.complete === false && checklist.length > 0 && tasks.length !== checklist.length) {
    problems.push("bench task count does not match the demo next-evidence checklist");
  }
  if (isRecord(options.demoManifest) && isRecord(manifest) && manifest.complete !== options.demoManifest.complete) {
    problems.push("bench completion flag does not match the demo package");
  }

  return {
    id: "bench-evidence-packet",
    label: "Bench evidence packet",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Latest bench packet points at the latest demo package and keeps authorization fields false: ${options.bench.relativePath}.`,
    evidence: [options.bench.relativePath]
  };
}

function validateOptionalHardwareArchive(hardware: LatestJson | undefined, demoManifest: unknown): HandoffIndexChainCheck {
  if (!hardware) {
    return {
      id: "hardware-archive-pointer",
      label: "Hardware archive pointer",
      status: "warn",
      details: "No hardware archive exists for the handoff index.",
      evidence: [".tmp/hardware-evidence"]
    };
  }
  const artifacts = isRecord(demoManifest) && isRecord(demoManifest.artifacts) ? demoManifest.artifacts : {};
  const ok = artifacts.hardwareEvidenceJsonPath === hardware.relativePath;
  return {
    id: "hardware-archive-pointer",
    label: "Hardware archive pointer",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Demo package references the latest hardware archive: ${hardware.relativePath}.`
      : "Demo package hardware archive path does not point at the latest hardware evidence.",
    evidence: [hardware.relativePath]
  };
}

function validateOptionalPolicyGate(policy: LatestJson | undefined, demoManifest: unknown): HandoffIndexChainCheck {
  if (!policy) {
    return {
      id: "policy-gate-pointer",
      label: "Policy gate pointer",
      status: "warn",
      details: "No hardware-actuation policy gate artifact exists for the handoff index.",
      evidence: [".tmp/policy-evidence"]
    };
  }
  const artifacts = isRecord(demoManifest) && isRecord(demoManifest.artifacts) ? demoManifest.artifacts : {};
  const ok = artifacts.policyGateJsonPath === policy.relativePath;
  return {
    id: "policy-gate-pointer",
    label: "Policy gate pointer",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Demo package references the latest policy gate artifact: ${policy.relativePath}.`
      : "Demo package policy gate path does not point at the latest policy evidence.",
    evidence: [policy.relativePath]
  };
}

function validateOvernight(overnight: OvernightStatus | undefined): HandoffIndexChainCheck {
  if (!overnight) {
    return {
      id: "overnight-status",
      label: "Overnight status",
      status: "warn",
      details: "No overnight-loop STATUS.md exists.",
      evidence: [OVERNIGHT_STATUS_PATH]
    };
  }

  if (!overnight.ok) {
    return {
      id: "overnight-status",
      label: "Overnight status",
      status: "fail",
      details: `Latest overnight verdict is ${overnight.verdict}.`,
      evidence: [OVERNIGHT_STATUS_PATH]
    };
  }

  return {
    id: "overnight-status",
    label: "Overnight status",
    status: overnight.stale ? "warn" : "pass",
    details: overnight.stale
      ? `Latest overnight verdict is pass, but last update ${overnight.lastUpdate ?? "unknown"} is older than 48 hours.`
      : "Latest overnight verdict is pass and fresh.",
    evidence: [OVERNIGHT_STATUS_PATH]
  };
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

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function buildArtifactDigests(root: string, artifacts: HandoffIndexManifest["artifacts"]): Promise<HandoffIndexArtifactDigest[]> {
  const uniquePaths = [...new Set(Object.values(artifacts).filter((value): value is string => typeof value === "string" && value.length > 0))];
  const digests: HandoffIndexArtifactDigest[] = [];
  for (const relativePath of uniquePaths.sort((left, right) => left.localeCompare(right))) {
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) continue;
    try {
      const bytes = await readFile(absolutePath);
      digests.push({
        path: relativePath,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      });
    } catch {
      // Missing paths are already surfaced by the evidence chain validators.
    }
  }
  return digests;
}

interface OvernightStatus {
  verdict: string;
  lastUpdate?: string;
  cycle?: string;
  stale: boolean;
  ok: boolean;
}

async function readOvernight(root: string, generatedAt: string): Promise<OvernightStatus | undefined> {
  try {
    const content = await readFile(path.join(root, OVERNIGHT_STATUS_PATH), "utf8");
    const verdict = content.match(/Verdict:\s*([^\n]+)/)?.[1]?.trim() ?? "unknown";
    const lastUpdate = content.match(/Last update:\s*([^\n]+)/)?.[1]?.trim();
    const cycle = content.match(/Cycle:\s*([^\n]+)/)?.[1]?.trim();
    const ageMs = lastUpdate ? Date.parse(generatedAt) - Date.parse(lastUpdate) : undefined;
    return {
      verdict,
      lastUpdate,
      cycle,
      stale: typeof ageMs === "number" && Number.isFinite(ageMs) && ageMs > 48 * 60 * 60 * 1000,
      ok: /^pass$/i.test(verdict)
    };
  } catch {
    return undefined;
  }
}

function demoHardwareClaimsFalse(manifest: Record<string, unknown>) {
  if (!isRecord(manifest.hardwareClaims)) return false;
  const claims = manifest.hardwareClaims;
  return [
    "jetsonOrinNanoValidated",
    "raspberryPi5Validated",
    "realMavlinkBenchValidated",
    "realRos2BenchValidated",
    "hilFailsafeValidated",
    "isaacJetsonCaptureValidated",
    "hardwareActuationAuthorized"
  ].every((key) => claims[key] === false);
}

function releaseChecksumMatchesDemo(demoManifest: unknown, releaseManifest: unknown) {
  if (!isRecord(releaseManifest) || typeof releaseManifest.overallSha256 !== "string") return false;
  if (!isRecord(demoManifest) || !isRecord(demoManifest.releaseChecksum)) return false;
  return demoManifest.releaseChecksum.overallSha256 === releaseManifest.overallSha256;
}

function realWorldBlockersFrom(primary: unknown, fallback: unknown): string[] {
  if (isRecord(primary) && Array.isArray(primary.realWorldBlockers)) return primary.realWorldBlockers.map(String);
  if (isRecord(fallback) && Array.isArray(fallback.realWorldBlockers)) return fallback.realWorldBlockers.map(String);
  return [];
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function replaceExtension(filePath: string, extension: string) {
  return filePath.replace(/\.json$/, extension);
}

function normalizeArtifactPath(root: string, value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const trimmed = value.trim();
  const resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

function renderMarkdown(manifest: HandoffIndexManifest) {
  return `${[
    "# SEEKR Handoff Index",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Label: ${manifest.label}`,
    `Status: ${manifest.status}`,
    `Local alpha OK: ${manifest.localAlphaOk}`,
    `Complete: ${manifest.complete}`,
    "",
    "Command upload enabled: false",
    "",
    "Artifacts:",
    "",
    `- Acceptance status: ${manifest.artifacts.acceptanceStatusPath}`,
    manifest.artifacts.releaseEvidenceJsonPath ? `- Release evidence: ${manifest.artifacts.releaseEvidenceJsonPath}` : undefined,
    manifest.artifacts.completionAuditJsonPath ? `- Completion audit: ${manifest.artifacts.completionAuditJsonPath}` : undefined,
    manifest.artifacts.demoReadinessJsonPath ? `- Demo readiness package: ${manifest.artifacts.demoReadinessJsonPath}` : undefined,
    manifest.artifacts.benchEvidencePacketJsonPath ? `- Bench evidence packet: ${manifest.artifacts.benchEvidencePacketJsonPath}` : undefined,
    manifest.artifacts.safetyScanJsonPath ? `- Command-boundary scan: ${manifest.artifacts.safetyScanJsonPath}` : undefined,
    manifest.artifacts.apiProbeJsonPath ? `- API probe evidence: ${manifest.artifacts.apiProbeJsonPath}` : undefined,
    manifest.artifacts.hardwareEvidenceJsonPath ? `- Hardware evidence: ${manifest.artifacts.hardwareEvidenceJsonPath}` : undefined,
    manifest.artifacts.policyGateJsonPath ? `- Policy gate evidence: ${manifest.artifacts.policyGateJsonPath}` : undefined,
    manifest.artifacts.overnightStatusPath ? `- Overnight status: ${manifest.artifacts.overnightStatusPath}` : undefined,
    "",
    "Artifact digests:",
    "",
    "| Path | Bytes | SHA-256 |",
    "| --- | ---: | --- |",
    ...(manifest.artifactDigests.length
      ? manifest.artifactDigests.map((digest) => `| ${digest.path} | ${digest.bytes} | ${digest.sha256} |`)
      : ["| None | 0 | n/a |"]),
    "",
    "Safety boundary:",
    "",
    `- realAircraftCommandUpload: ${manifest.safetyBoundary.realAircraftCommandUpload}`,
    `- hardwareActuationEnabled: ${manifest.safetyBoundary.hardwareActuationEnabled}`,
    `- runtimePolicyInstalled: ${manifest.safetyBoundary.runtimePolicyInstalled}`,
    "",
    "Evidence chain:",
    "",
    "| Check | Status | Details |",
    "| --- | --- | --- |",
    ...manifest.evidenceChain.map((check) => `| ${check.label} | ${check.status} | ${escapeTable(check.details)} |`),
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

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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
  const result = await writeHandoffIndex({
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    status: result.manifest.status,
    localAlphaOk: result.manifest.localAlphaOk,
    complete: result.manifest.complete,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    chainCheckCount: result.manifest.evidenceChain.length,
    validation: result.manifest.validation,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
