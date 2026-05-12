import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { REQUIRED_STRICT_AI_SMOKE_CASES, isLocalOllamaUrl } from "../src/server/ai/localAiEvidence";

type RecoveryStatus = "pass" | "warn" | "fail" | "blocked";

export interface LocalRecoveryStatusCheck {
  id: string;
  status: RecoveryStatus;
  details: string;
  evidence: string[];
}

export interface LocalRecoveryStatusManifest {
  schemaVersion: 1;
  generatedAt: string;
  status: "ready-local-recovery-real-world-blocked" | "blocked-local-recovery" | "complete";
  localRecoveryOk: boolean;
  complete: boolean;
  commandUploadEnabled: false;
  localHeadSha?: string;
  remoteDefaultBranchSha?: string;
  freshCloneHeadSha?: string;
  releaseChecksum?: string;
  strictAi?: {
    provider?: string;
    model?: string;
    ollamaUrl?: string;
    caseCount?: number;
  };
  plugAndPlay?: {
    status?: string;
    warningCount?: number;
    blockedCount?: number;
    fallbackApi?: number;
    fallbackClient?: number;
    defaultPortsOccupied?: boolean;
    autoRecoverable?: boolean;
    listenerDiagnostics?: string[];
    details?: string;
  };
  reviewBundle?: {
    status?: string;
    checkedFileCount?: number;
    secretScanStatus?: string;
    secretFindingCount?: number;
  };
  remainingRealWorldBlockerCount: number;
  remainingRealWorldBlockers: string[];
  checks: LocalRecoveryStatusCheck[];
  summary: Record<RecoveryStatus, number>;
  nextCommands: string[];
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/recovery-status";

export async function buildLocalRecoveryStatus(options: { root?: string; generatedAt?: string } = {}): Promise<LocalRecoveryStatusManifest> {
  const root = options.root ?? process.cwd();
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const acceptance = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const release = await latestJson(root, ".tmp/release-evidence", "seekr-release-0.2.0-");
  const safety = await latestJson(root, ".tmp/safety-evidence", "seekr-command-boundary-scan-");
  const apiProbe = await latestJson(root, ".tmp/api-probe", "seekr-api-probe-");
  const sourceControl = await latestJson(root, ".tmp/source-control-handoff", "seekr-source-control-handoff-");
  const freshClone = await latestJson(root, ".tmp/fresh-clone-smoke", "seekr-fresh-clone-smoke-");
  const plugAndPlay = await latestJson(root, ".tmp/plug-and-play-readiness", "seekr-plug-and-play-readiness-");
  const goal = await latestJson(root, ".tmp/goal-audit", "seekr-goal-audit-");
  const bundleVerify = await latestJson(root, ".tmp/handoff-bundles", "seekr-review-bundle-verification-");
  const gstack = await latestJson(root, ".tmp/gstack-workflow-status", "seekr-gstack-workflow-status-");
  const overnight = await readText(path.join(root, ".tmp/overnight/STATUS.md"));
  const sourceControlManifest = recordOrUndefined(sourceControl?.manifest);
  const freshCloneManifest = recordOrUndefined(freshClone?.manifest);
  const plugAndPlayManifest = recordOrUndefined(plugAndPlay?.manifest);
  const goalManifest = recordOrUndefined(goal?.manifest);
  const bundleVerifyManifest = recordOrUndefined(bundleVerify?.manifest);
  const expectedHeadSha = stringOrUndefined(sourceControlManifest?.localHeadSha);

  const checks = [
    acceptanceCheck(acceptance, release, safety, root),
    apiProbeCheck(apiProbe, acceptance),
    sourceControlCheck(sourceControl),
    freshCloneCheck(freshClone, expectedHeadSha),
    reviewBundleCheck(bundleVerify, expectedHeadSha),
    gstackCheck(gstack),
    plugAndPlayCheck(plugAndPlay, expectedHeadSha),
    goalCheck(goal),
    overnightCheck(overnight)
  ];
  const summary = countChecks(checks);
  const remainingRealWorldBlockers = arrayOfStrings(goalManifest?.remainingRealWorldBlockers)
    ?? arrayOfStrings(plugAndPlayManifest?.remainingRealWorldBlockers)
    ?? [];
  const remainingRealWorldBlockerCount = numberOrUndefined(goalManifest?.remainingRealWorldBlockerCount)
    ?? numberOrUndefined(plugAndPlayManifest?.remainingRealWorldBlockerCount)
    ?? remainingRealWorldBlockers.length;
  const complete = goalManifest?.complete === true && plugAndPlayManifest?.complete === true && remainingRealWorldBlockerCount === 0;
  const localRecoveryOk = summary.fail === 0;
  const status = !localRecoveryOk
    ? "blocked-local-recovery"
    : complete
      ? "complete"
      : "ready-local-recovery-real-world-blocked";

  return {
    schemaVersion: 1,
    generatedAt,
    status,
    localRecoveryOk,
    complete,
    commandUploadEnabled: false,
    localHeadSha: stringOrUndefined(sourceControlManifest?.localHeadSha) ?? stringOrUndefined(freshCloneManifest?.localHeadSha),
    remoteDefaultBranchSha: stringOrUndefined(sourceControlManifest?.remoteDefaultBranchSha),
    freshCloneHeadSha: stringOrUndefined(sourceControlManifest?.freshCloneHeadSha) ?? stringOrUndefined(freshCloneManifest?.cloneHeadSha),
    releaseChecksum: stringOrUndefined(getPath(acceptance, ["releaseChecksum", "overallSha256"])),
    strictAi: {
      provider: stringOrUndefined(getPath(acceptance, ["strictLocalAi", "provider"])) ?? stringOrUndefined(freshCloneManifest?.strictAiSmokeProvider),
      model: stringOrUndefined(getPath(acceptance, ["strictLocalAi", "model"])) ?? stringOrUndefined(freshCloneManifest?.strictAiSmokeModel),
      ollamaUrl: stringOrUndefined(getPath(acceptance, ["strictLocalAi", "ollamaUrl"])) ?? stringOrUndefined(freshCloneManifest?.strictAiSmokeOllamaUrl),
      caseCount: numberOrUndefined(getPath(acceptance, ["strictLocalAi", "caseCount"])) ?? numberOrUndefined(freshCloneManifest?.strictAiSmokeCaseCount)
    },
    plugAndPlay: {
      status: stringOrUndefined(plugAndPlayManifest?.status),
      warningCount: numberOrUndefined(getPath(plugAndPlayManifest, ["summary", "warn"])),
      blockedCount: numberOrUndefined(getPath(plugAndPlayManifest, ["summary", "blocked"])),
      fallbackApi: numberOrUndefined(getPath(plugAndPlayManifest, ["operatorStartPorts", "fallbackApi"])),
      fallbackClient: numberOrUndefined(getPath(plugAndPlayManifest, ["operatorStartPorts", "fallbackClient"])),
      defaultPortsOccupied: booleanOrUndefined(getPath(plugAndPlayManifest, ["operatorStartPorts", "defaultPortsOccupied"])),
      autoRecoverable: booleanOrUndefined(getPath(plugAndPlayManifest, ["operatorStartPorts", "autoRecoverable"])),
      listenerDiagnostics: arrayOfStrings(getPath(plugAndPlayManifest, ["operatorStartPorts", "listenerDiagnostics"])),
      details: stringOrUndefined(getPath(plugAndPlayManifest, ["operatorStartPorts", "details"]))
    },
    reviewBundle: {
      status: stringOrUndefined(bundleVerifyManifest?.status),
      checkedFileCount: numberOrUndefined(bundleVerifyManifest?.checkedFileCount),
      secretScanStatus: stringOrUndefined(getPath(bundleVerifyManifest, ["secretScan", "status"])),
      secretFindingCount: numberOrUndefined(getPath(bundleVerifyManifest, ["secretScan", "findingCount"]))
    },
    remainingRealWorldBlockerCount,
    remainingRealWorldBlockers,
    checks,
    summary,
    nextCommands: nextCommands(status),
    limitations: [
      "This status command summarizes existing local artifacts only; it does not rerun acceptance, fresh-clone smoke, hardware probes, HIL, Isaac, or policy review.",
      "It is not evidence of real Jetson/Pi, MAVLink/ROS, HIL, Isaac, or hardware-actuation readiness."
    ]
  };
}

export async function writeLocalRecoveryStatus(options: { root?: string; generatedAt?: string; outDir?: string } = {}) {
  const root = options.root ?? process.cwd();
  const manifest = await buildLocalRecoveryStatus(options);
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  await mkdir(outDir, { recursive: true });
  const fileStamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const base = `seekr-local-recovery-status-${fileStamp}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const markdownPath = path.join(outDir, `${base}.md`);
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");
  return {
    manifest,
    jsonPath,
    markdownPath
  };
}

export function localRecoveryStatusCliSummary(result: { manifest: LocalRecoveryStatusManifest; jsonPath: string; markdownPath: string }) {
  return {
    ok: result.manifest.localRecoveryOk,
    status: result.manifest.status,
    complete: result.manifest.complete,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    localHeadSha: result.manifest.localHeadSha,
    releaseChecksum: result.manifest.releaseChecksum,
    plugAndPlay: result.manifest.plugAndPlay,
    remainingRealWorldBlockerCount: result.manifest.remainingRealWorldBlockerCount,
    summary: result.manifest.summary,
    nextCommands: result.manifest.nextCommands,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  };
}

function acceptanceCheck(manifest: unknown, release: LatestArtifact | undefined, safety: LatestArtifact | undefined, root: string): LocalRecoveryStatusCheck {
  const releaseManifest = recordOrUndefined(release?.manifest);
  const safetyManifest = recordOrUndefined(safety?.manifest);
  const releaseSummary = recordOrUndefined(getPath(manifest, ["releaseChecksum"]));
  const safetySummary = recordOrUndefined(getPath(manifest, ["commandBoundaryScan"]));
  const strictAi = recordOrUndefined(getPath(manifest, ["strictLocalAi"]));
  const expectedCaseNames = [...REQUIRED_STRICT_AI_SMOKE_CASES];
  const caseNames = arrayOfStrings(strictAi?.caseNames);
  const safetySummaryCounts = recordOrUndefined(safetyManifest?.summary);
  const scannedFileCount = numberOrUndefined(safetySummaryCounts?.scannedFileCount) ?? (Array.isArray(safetyManifest?.scannedFiles) ? safetyManifest.scannedFiles.length : undefined);
  const violationCount = numberOrUndefined(safetySummaryCounts?.violationCount) ?? (Array.isArray(safetyManifest?.violations) ? safetyManifest.violations.length : undefined);
  const problems: string[] = [];

  if (!isRecord(manifest) || manifest.ok !== true) problems.push("acceptance status must be present and ok");
  if (isRecord(manifest) && manifest.commandUploadEnabled !== false) problems.push("acceptance commandUploadEnabled must be false");
  if (!release) problems.push("latest release checksum evidence is missing");
  if (!safety) problems.push("latest command-boundary scan evidence is missing");
  if (!releaseSummary) problems.push("acceptance release checksum summary is missing");
  if (!safetySummary) problems.push("acceptance command-boundary scan summary is missing");
  if (!strictAi) problems.push("acceptance strict local AI summary is missing");

  if (release && releaseSummary) {
    const acceptedReleasePath = normalizeArtifactPath(root, releaseSummary.jsonPath);
    const acceptedReleaseShaPath = normalizeArtifactPath(root, releaseSummary.sha256Path);
    const acceptedReleaseMarkdownPath = normalizeArtifactPath(root, releaseSummary.markdownPath);
    if (acceptedReleasePath !== release.relativePath) problems.push("acceptance release checksum path must point at the latest release evidence");
    if (acceptedReleaseShaPath !== replaceExtension(release.relativePath, ".sha256")) problems.push("acceptance release checksum SHA-256 path must point at the latest release evidence");
    if (acceptedReleaseMarkdownPath !== replaceExtension(release.relativePath, ".md")) problems.push("acceptance release checksum Markdown path must point at the latest release evidence");
    if (stringOrUndefined(releaseSummary.overallSha256) !== stringOrUndefined(releaseManifest?.overallSha256)) problems.push("acceptance release checksum SHA must match latest release evidence");
    if (numberOrUndefined(releaseSummary.fileCount) !== numberOrUndefined(releaseManifest?.fileCount)) problems.push("acceptance release file count must match latest release evidence");
    if (numberOrUndefined(releaseSummary.totalBytes) !== numberOrUndefined(releaseManifest?.totalBytes)) problems.push("acceptance release byte count must match latest release evidence");
    if (releaseManifest?.commandUploadEnabled !== false) problems.push("latest release evidence must keep commandUploadEnabled false");
  }

  if (safety && safetySummary) {
    const acceptedSafetyPath = normalizeArtifactPath(root, safetySummary.jsonPath);
    const acceptedSafetyMarkdownPath = normalizeArtifactPath(root, safetySummary.markdownPath);
    if (acceptedSafetyPath !== safety.relativePath) problems.push("acceptance command-boundary scan path must point at the latest safety evidence");
    if (acceptedSafetyMarkdownPath !== replaceExtension(safety.relativePath, ".md")) problems.push("acceptance command-boundary scan Markdown path must point at the latest safety evidence");
    if (safetySummary.status !== "pass" || safetyManifest?.status !== "pass") problems.push("acceptance and latest command-boundary scan must both pass");
    if (numberOrUndefined(safetySummary.scannedFileCount) !== scannedFileCount) problems.push("acceptance command-boundary scanned-file count must match latest safety evidence");
    if (numberOrUndefined(safetySummary.violationCount) !== violationCount) problems.push("acceptance command-boundary violation count must match latest safety evidence");
    if (numberOrUndefined(safetySummary.allowedFindingCount) !== numberOrUndefined(safetySummaryCounts?.allowedFindingCount)) problems.push("acceptance command-boundary allowed-finding count must match latest safety evidence");
    if (numberOrUndefined(safetySummary.violationCount) !== 0) problems.push("acceptance command-boundary scan must report zero violations");
    if (safetySummary.commandUploadEnabled !== false || safetyManifest?.commandUploadEnabled !== false) problems.push("acceptance command-boundary scan must keep commandUploadEnabled false");
  }

  if (strictAi) {
    if (strictAi.ok !== true) problems.push("strict local AI summary must be ok");
    if (strictAi.provider !== "ollama") problems.push("strict local AI provider must be ollama");
    if (!isLocalOllamaUrl(strictAi.ollamaUrl)) problems.push("strict local AI Ollama URL must be loopback");
    if (strictAi.commandUploadEnabled !== false) problems.push("strict local AI summary must keep commandUploadEnabled false");
    if (numberOrUndefined(strictAi.caseCount) !== expectedCaseNames.length) problems.push("strict local AI case count must match the required scenario count");
    if (!caseNames || !arrayEquals(caseNames, expectedCaseNames)) problems.push("strict local AI case names must exactly match the required scenario order");
  }

  const ok = problems.length === 0;
  const checksum = stringOrUndefined(getPath(manifest, ["releaseChecksum", "overallSha256"])) ?? "unknown checksum";
  const aiProvider = stringOrUndefined(getPath(manifest, ["strictLocalAi", "provider"])) ?? "unknown AI provider";
  return {
    id: "acceptance-status",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Latest acceptance is pass with ${checksum}, strict local AI provider ${aiProvider}, and commandUploadEnabled false.`
      : `Latest acceptance status is missing, stale, unsafe, or not passing: ${problems.join("; ")}.`,
    evidence: [".tmp/acceptance-status.json", release?.relativePath, safety?.relativePath].filter(isString)
  };
}

function apiProbeCheck(artifact: LatestArtifact | undefined, acceptance: unknown): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const checked = Array.isArray(manifest?.checked) ? manifest.checked.map(String) : [];
  const sessionAcceptance = recordOrUndefined(manifest?.sessionAcceptance) ?? {};
  const acceptanceRecord = recordOrUndefined(acceptance);
  const requiredChecks = [
    "config",
    "session-acceptance",
    "session-acceptance-evidence",
    "readiness",
    "hardware-readiness",
    "source-health",
    "verify",
    "replays",
    "malformed-json"
  ];
  const missing = requiredChecks.filter((check) => !checked.includes(check));
  const problems: string[] = [];

  if (!artifact) problems.push("latest API probe evidence is missing");
  if (!manifest || manifest.ok !== true) problems.push("API probe ok must be true");
  if (!manifest || manifest.commandUploadEnabled !== false) problems.push("API probe commandUploadEnabled must be false");
  if (missing.length) problems.push(`API probe missing check(s): ${missing.join(", ")}`);
  if (!acceptanceRecord || acceptanceRecord.ok !== true) problems.push("acceptance status must pass before API readback can be trusted");
  if (acceptanceRecord && acceptanceRecord.commandUploadEnabled !== false) problems.push("acceptance status commandUploadEnabled must be false");
  if (sessionAcceptance.ok !== true) problems.push("API probe session acceptance ok must be true");
  if (sessionAcceptance.commandUploadEnabled !== false) problems.push("API probe session acceptance commandUploadEnabled must be false");

  if (acceptanceRecord?.ok === true) {
    const acceptanceRelease = recordOrUndefined(acceptanceRecord.releaseChecksum) ?? {};
    const probeRelease = recordOrUndefined(sessionAcceptance.releaseChecksum) ?? {};
    const acceptanceScan = recordOrUndefined(acceptanceRecord.commandBoundaryScan) ?? {};
    const probeScan = recordOrUndefined(sessionAcceptance.commandBoundaryScan) ?? {};
    const acceptanceAi = recordOrUndefined(acceptanceRecord.strictLocalAi) ?? {};
    const probeAi = recordOrUndefined(sessionAcceptance.strictLocalAi) ?? {};
    const acceptanceGeneratedAt = numberOrUndefined(acceptanceRecord.generatedAt);
    const acceptanceCommandCount = Array.isArray(acceptanceRecord.completedCommands) ? acceptanceRecord.completedCommands.length : undefined;
    const acceptanceAiCaseNames = arrayOfStrings(acceptanceAi.caseNames);
    const probeAiCaseNames = arrayOfStrings(probeAi.caseNames);

    if (sessionAcceptance.status !== "pass") problems.push("API probe did not read back passing acceptance status");
    if (acceptanceGeneratedAt !== undefined && numberOrUndefined(sessionAcceptance.generatedAt) !== acceptanceGeneratedAt) {
      problems.push("API probe acceptance timestamp must match acceptance status");
    }
    if (acceptanceCommandCount !== undefined && numberOrUndefined(sessionAcceptance.commandCount) !== acceptanceCommandCount) {
      problems.push("API probe acceptance command count must match acceptance status");
    }
    if (
      probeAi.ok !== acceptanceAi.ok ||
      probeAi.provider !== acceptanceAi.provider ||
      probeAi.model !== acceptanceAi.model ||
      probeAi.ollamaUrl !== acceptanceAi.ollamaUrl ||
      probeAi.commandUploadEnabled !== false ||
      acceptanceAi.commandUploadEnabled !== false ||
      !isLocalOllamaUrl(acceptanceAi.ollamaUrl) ||
      numberOrUndefined(probeAi.caseCount) !== numberOrUndefined(acceptanceAi.caseCount) ||
      !acceptanceAiCaseNames ||
      !probeAiCaseNames ||
      !arrayEquals(probeAiCaseNames, acceptanceAiCaseNames)
    ) {
      problems.push("API probe strict local AI summary must match acceptance status");
    }
    if (
      probeRelease.overallSha256 !== acceptanceRelease.overallSha256 ||
      numberOrUndefined(probeRelease.fileCount) !== numberOrUndefined(acceptanceRelease.fileCount) ||
      numberOrUndefined(probeRelease.totalBytes) !== numberOrUndefined(acceptanceRelease.totalBytes)
    ) {
      problems.push("API probe release checksum summary must match acceptance status");
    }
    if (
      probeScan.status !== "pass" ||
      numberOrUndefined(probeScan.scannedFileCount) !== numberOrUndefined(acceptanceScan.scannedFileCount) ||
      numberOrUndefined(probeScan.violationCount) !== 0 ||
      numberOrUndefined(probeScan.allowedFindingCount) !== numberOrUndefined(acceptanceScan.allowedFindingCount)
    ) {
      problems.push("API probe command-boundary scan summary must match acceptance status");
    }
  }

  const ok = problems.length === 0;
  return {
    id: "api-readback",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Latest API probe matches session-visible acceptance evidence and keeps command upload disabled: ${artifact?.relativePath}.`
      : `Latest API probe evidence is missing, stale, unsafe, or not matching acceptance: ${problems.join("; ")}.`,
    evidence: [artifact?.relativePath ?? ".tmp/api-probe"]
  };
}

function sourceControlCheck(artifact: LatestArtifact | undefined): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const localHead = stringOrUndefined(manifest?.localHeadSha);
  const remoteHead = stringOrUndefined(manifest?.remoteDefaultBranchSha);
  const cloneHead = stringOrUndefined(manifest?.freshCloneHeadSha);
  const ok = isRecord(manifest) &&
    manifest.status === "ready-source-control-handoff" &&
    manifest.ready === true &&
    manifest.workingTreeClean === true &&
    manifest.commandUploadEnabled === false &&
    numberOrUndefined(manifest.blockedCheckCount) === 0 &&
    numberOrUndefined(manifest.warningCheckCount) === 0 &&
    !!localHead &&
    localHead === remoteHead &&
    localHead === cloneHead;
  return {
    id: "source-control-handoff",
    status: ok ? "pass" : "fail",
    details: ok
      ? `GitHub handoff is clean and published at ${localHead}.`
      : "Latest source-control handoff is missing, dirty, unpublished, warning-bearing, or not aligned with the GitHub default branch.",
    evidence: [artifact?.relativePath ?? ".tmp/source-control-handoff"]
  };
}

function freshCloneCheck(artifact: LatestArtifact | undefined, expectedHeadSha: string | undefined): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const localHead = stringOrUndefined(manifest?.localHeadSha);
  const cloneHead = stringOrUndefined(manifest?.cloneHeadSha);
  const provider = stringOrUndefined(manifest?.strictAiSmokeProvider);
  const url = stringOrUndefined(manifest?.strictAiSmokeOllamaUrl);
  const caseCount = numberOrUndefined(manifest?.strictAiSmokeCaseCount);
  const headValues = [
    localHead,
    cloneHead,
    stringOrUndefined(manifest?.sourceControlHandoffLocalHeadSha),
    stringOrUndefined(manifest?.sourceControlHandoffRemoteDefaultBranchSha),
    stringOrUndefined(manifest?.sourceControlHandoffFreshCloneHeadSha)
  ];
  const headOk = expectedHeadSha
    ? headValues.every((value) => value === expectedHeadSha)
    : !!localHead && localHead === cloneHead;
  const ok = isRecord(manifest) &&
    manifest.status === "pass" &&
    manifest.commandUploadEnabled === false &&
    headOk &&
    provider === "ollama" &&
    !!url &&
    isLoopbackUrl(url) &&
    caseCount === 4;
  return {
    id: "fresh-clone-ai-proof",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Fresh clone proof passed at ${cloneHead} with Ollama strict AI smoke (${caseCount} cases).`
      : expectedHeadSha
        ? `Fresh clone proof is missing, stale against current source-control HEAD ${expectedHeadSha}, not SHA-aligned, or lacks strict loopback Ollama AI smoke evidence.`
        : "Fresh clone proof is missing, stale, not SHA-aligned, or lacks strict loopback Ollama AI smoke evidence.",
    evidence: [artifact?.relativePath ?? ".tmp/fresh-clone-smoke"]
  };
}

function reviewBundleCheck(artifact: LatestArtifact | undefined, expectedHeadSha: string | undefined): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const secretScan = isRecord(manifest?.secretScan) ? manifest.secretScan : undefined;
  const checked = numberOrUndefined(manifest?.checkedFileCount);
  const scanned = numberOrUndefined(secretScan?.scannedFileCount);
  const expected = numberOrUndefined(secretScan?.expectedFileCount);
  const headOk = expectedHeadSha ? [
    stringOrUndefined(manifest?.sourceControlHandoffLocalHeadSha),
    stringOrUndefined(manifest?.sourceControlHandoffRemoteDefaultBranchSha),
    stringOrUndefined(manifest?.sourceControlHandoffFreshCloneHeadSha),
    stringOrUndefined(manifest?.freshCloneSmokeLocalHeadSha),
    stringOrUndefined(manifest?.freshCloneSmokeCloneHeadSha),
    stringOrUndefined(manifest?.freshCloneSmokeSourceControlHandoffLocalHeadSha),
    stringOrUndefined(manifest?.freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha),
    stringOrUndefined(manifest?.freshCloneSmokeSourceControlHandoffFreshCloneHeadSha)
  ].every((value) => value === expectedHeadSha) : true;
  const ok = isRecord(manifest) &&
    manifest.status === "pass" &&
    manifest.commandUploadEnabled === false &&
    secretScan?.status === "pass" &&
    numberOrUndefined(secretScan.findingCount) === 0 &&
    checked !== undefined &&
    checked === scanned &&
    checked === expected &&
    headOk;
  return {
    id: "review-bundle-verification",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Review bundle verification passed with ${checked} copied files scanned and 0 secret findings.`
      : expectedHeadSha
        ? `Latest review bundle verification is missing, failing, stale against current source-control HEAD ${expectedHeadSha}, incompletely scanned, or has secret findings.`
        : "Latest review bundle verification is missing, failing, incompletely scanned, or has secret findings.",
    evidence: [artifact?.relativePath ?? ".tmp/handoff-bundles"]
  };
}

function gstackCheck(artifact: LatestArtifact | undefined): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const status = stringOrUndefined(manifest?.status);
  const healthStatus = stringOrUndefined(getPath(manifest, ["healthHistory", "status"]));
  const qaStatus = stringOrUndefined(getPath(manifest, ["qaReport", "status"]));
  const ok = isRecord(manifest) &&
    (status === "pass" || status === "pass-with-limitations") &&
    manifest.commandUploadEnabled === false &&
    healthStatus === "pass" &&
    qaStatus === "pass";
  return {
    id: "gstack-health-qa",
    status: ok ? "pass" : "fail",
    details: ok
      ? `GStack workflow status is ${status}; health history and browser QA are pass.`
      : "Latest gstack workflow status is missing, failing, or lacks current health/browser QA proof.",
    evidence: [artifact?.relativePath ?? ".tmp/gstack-workflow-status"]
  };
}

function plugAndPlayCheck(artifact: LatestArtifact | undefined, expectedHeadSha: string | undefined): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const summary = isRecord(manifest?.summary) ? manifest.summary : undefined;
  const warnCount = numberOrUndefined(summary?.warn) ?? 0;
  const failCount = numberOrUndefined(summary?.fail) ?? 0;
  const sourceControl = isRecord(manifest?.sourceControl) ? manifest.sourceControl : undefined;
  const freshClone = isRecord(manifest?.freshClone) ? manifest.freshClone : undefined;
  const reviewBundle = isRecord(manifest?.reviewBundle) ? manifest.reviewBundle : undefined;
  const headOk = expectedHeadSha ? [
    stringOrUndefined(sourceControl?.localHeadSha),
    stringOrUndefined(sourceControl?.remoteDefaultBranchSha),
    stringOrUndefined(sourceControl?.freshCloneHeadSha),
    stringOrUndefined(freshClone?.localHeadSha),
    stringOrUndefined(freshClone?.cloneHeadSha),
    stringOrUndefined(freshClone?.sourceControlHandoffLocalHeadSha),
    stringOrUndefined(freshClone?.sourceControlHandoffRemoteDefaultBranchSha),
    stringOrUndefined(freshClone?.sourceControlHandoffFreshCloneHeadSha),
    stringOrUndefined(reviewBundle?.sourceControlHandoffLocalHeadSha),
    stringOrUndefined(reviewBundle?.sourceControlHandoffRemoteDefaultBranchSha),
    stringOrUndefined(reviewBundle?.sourceControlHandoffFreshCloneHeadSha)
  ].every((value) => value === expectedHeadSha) : true;
  const ok = isRecord(manifest) &&
    manifest.localPlugAndPlayOk === true &&
    manifest.commandUploadEnabled === false &&
    failCount === 0 &&
    headOk;
  return {
    id: "plug-and-play-readiness",
    status: !ok ? "fail" : warnCount > 0 ? "warn" : "pass",
    details: ok
      ? `Plug-and-play readiness is ${manifest.status}${warnCount ? ` with ${warnCount} warning(s)` : ""}.`
      : expectedHeadSha
        ? `Latest plug-and-play readiness artifact is missing, failing, unsafe, stale against current source-control HEAD ${expectedHeadSha}, or not locally ready.`
        : "Latest plug-and-play readiness artifact is missing, failing, unsafe, or not locally ready.",
    evidence: [artifact?.relativePath ?? ".tmp/plug-and-play-readiness"]
  };
}

function goalCheck(artifact: LatestArtifact | undefined): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const blockerCount = numberOrUndefined(manifest?.remainingRealWorldBlockerCount) ?? 0;
  const ok = isRecord(manifest) && manifest.commandUploadEnabled === false && numberOrUndefined(getPath(manifest, ["summary", "fail"])) === 0;
  return {
    id: "goal-audit",
    status: !ok ? "fail" : blockerCount > 0 ? "blocked" : "pass",
    details: ok
      ? `Goal audit is ${manifest.status} with ${blockerCount} remaining real-world blocker(s).`
      : "Latest goal audit is missing, failing, or unsafe.",
    evidence: [artifact?.relativePath ?? ".tmp/goal-audit"]
  };
}

function overnightCheck(content: string | undefined): LocalRecoveryStatusCheck {
  const ok = !!content && /Verdict:\s*pass/.test(content);
  const update = content?.match(/Last update:\s*(.+)/)?.[1]?.trim();
  return {
    id: "overnight-status",
    status: ok ? "pass" : "warn",
    details: ok
      ? `Latest overnight status is pass${update ? ` at ${update}` : ""}.`
      : "Overnight status is missing or not pass; rerun npm run overnight before final handoff confidence.",
    evidence: [".tmp/overnight/STATUS.md"]
  };
}

function nextCommands(status: LocalRecoveryStatusManifest["status"]) {
  if (status === "complete") return ["npm run plug-and-play"];
  if (status === "ready-local-recovery-real-world-blocked") {
    return [
      "npm run plug-and-play",
      "Collect the eight real-world evidence items before any hardware authority review."
    ];
  }
  return [
    "npm run acceptance",
    "npm run audit:completion",
    "npm run audit:plug-and-play",
    "npm run audit:goal"
  ];
}

function countChecks(checks: LocalRecoveryStatusCheck[]) {
  return {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    blocked: checks.filter((check) => check.status === "blocked").length
  };
}

function renderMarkdown(manifest: LocalRecoveryStatusManifest) {
  return [
    "# SEEKR Local Recovery Status",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `Local recovery ok: ${manifest.localRecoveryOk}`,
    `Complete: ${manifest.complete}`,
    `Command upload enabled: ${manifest.commandUploadEnabled}`,
    manifest.localHeadSha ? `Local HEAD: ${manifest.localHeadSha}` : undefined,
    manifest.remoteDefaultBranchSha ? `Remote default SHA: ${manifest.remoteDefaultBranchSha}` : undefined,
    manifest.freshCloneHeadSha ? `Fresh clone SHA: ${manifest.freshCloneHeadSha}` : undefined,
    manifest.releaseChecksum ? `Release checksum: ${manifest.releaseChecksum}` : undefined,
    manifest.plugAndPlay?.defaultPortsOccupied !== undefined ? `Default ports occupied: ${manifest.plugAndPlay.defaultPortsOccupied}` : undefined,
    manifest.plugAndPlay?.autoRecoverable !== undefined ? `Port fallback auto-recoverable: ${manifest.plugAndPlay.autoRecoverable}` : undefined,
    manifest.plugAndPlay?.fallbackApi ? `Fallback API port candidate: ${manifest.plugAndPlay.fallbackApi}` : undefined,
    manifest.plugAndPlay?.fallbackClient ? `Fallback client port candidate: ${manifest.plugAndPlay.fallbackClient}` : undefined,
    manifest.plugAndPlay?.details ? `Port recovery details: ${manifest.plugAndPlay.details}` : undefined,
    ...(manifest.plugAndPlay?.listenerDiagnostics?.length
      ? ["Port listener diagnostics:", ...manifest.plugAndPlay.listenerDiagnostics.map((diagnostic) => `- ${diagnostic}`)]
      : []),
    "",
    "## Checks",
    "",
    "| Check | Status | Details |",
    "| --- | --- | --- |",
    ...manifest.checks.map((check) => `| ${check.id} | ${check.status} | ${escapeTable(check.details)} |`),
    "",
    "## Remaining Real-World Blockers",
    "",
    `Count: ${manifest.remainingRealWorldBlockerCount}`,
    ...manifest.remainingRealWorldBlockers.map((blocker) => `- ${blocker}`),
    "",
    "## Next Commands",
    "",
    ...manifest.nextCommands.map((command) => `- ${command}`),
    "",
    "## Limitations",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].filter((line): line is string => line !== undefined).join("\n");
}

interface LatestArtifact {
  relativePath: string;
  manifest: unknown;
}

async function latestJson(root: string, directory: string, prefix: string): Promise<LatestArtifact | undefined> {
  const absoluteDirectory = path.join(root, directory);
  try {
    const entries = await readdir(absoluteDirectory);
    const fileName = entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith(".json")).sort().at(-1);
    if (!fileName) return undefined;
    const relativePath = path.join(directory, fileName);
    return {
      relativePath,
      manifest: await readJson(path.join(root, relativePath))
    };
  } catch {
    return undefined;
  }
}

async function readJson(absolutePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function readText(absolutePath: string) {
  try {
    return await readFile(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOrUndefined(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function getPath(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function normalizeArtifactPath(root: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const absolutePath = path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
  const relativePath = path.relative(root, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return undefined;
  return relativePath.split(path.sep).join(path.posix.sep);
}

function arrayEquals(left: string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function replaceExtension(filePath: string, extension: string) {
  return filePath.replace(/\.json$/, extension);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

async function main() {
  const result = await writeLocalRecoveryStatus();
  console.log(JSON.stringify(localRecoveryStatusCliSummary(result), null, 2));
  if (!result.manifest.localRecoveryOk) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
