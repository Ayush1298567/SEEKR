import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { localAiPrepareFreshForAcceptance, localAiPrepareManifestOk, localAiPrepareMatchesAcceptanceModel } from "./local-ai-prepare";
import { freshCloneOperatorSmokeOk } from "./fresh-clone-operator-smoke";
import { OPERATOR_QUICKSTART_PATH, operatorQuickstartProblems } from "./operator-quickstart-contract";
import { plugAndPlayDoctorOk, plugAndPlaySetupFreshForAcceptance, plugAndPlaySetupOk } from "./plug-and-play-artifact-contract";
import { validateRehearsalStartSmokeManifest } from "./rehearsal-start-smoke";
import { validateSourceControlHandoffManifest } from "./source-control-handoff";
import { REQUIRED_STRICT_AI_SMOKE_CASES, isLocalOllamaUrl } from "../src/server/ai/localAiEvidence";

type VerificationStatus = "pass" | "fail";

export interface HandoffBundleFileVerification {
  sourcePath: string;
  bundlePath: string;
  status: VerificationStatus;
  expectedBytes: number;
  actualBytes?: number;
  expectedSha256: string;
  actualSha256?: string;
  details: string;
}

export interface HandoffBundleVerificationManifest {
  schemaVersion: 1;
  generatedAt: string;
  status: VerificationStatus;
  commandUploadEnabled: false;
  sourceBundlePath?: string;
  sourceBundleStatus?: string;
  sourceIndexPath?: string;
  gstackWorkflowStatusPath?: string;
  gstackQaReportPath?: string;
  gstackQaScreenshotPaths: string[];
  todoAuditPath?: string;
  sourceControlHandoffPath?: string;
  sourceControlHandoffRepositoryUrl?: string;
  sourceControlHandoffPackageRepositoryUrl?: string;
  sourceControlHandoffConfiguredRemoteUrls: string[];
  sourceControlHandoffLocalBranch?: string;
  sourceControlHandoffRemoteDefaultBranch?: string;
  sourceControlHandoffRemoteRefCount?: number;
  sourceControlHandoffBlockedCheckCount?: number;
  sourceControlHandoffWarningCheckCount?: number;
  sourceControlHandoffLocalHeadSha?: string;
  sourceControlHandoffRemoteDefaultBranchSha?: string;
  sourceControlHandoffFreshCloneHeadSha?: string;
  sourceControlHandoffFreshCloneInstallDryRunOk?: boolean;
  sourceControlHandoffFreshCloneCheckedPathCount?: number;
  sourceControlHandoffWorkingTreeClean?: boolean;
  sourceControlHandoffWorkingTreeStatusLineCount?: number;
  plugAndPlaySetupPath?: string;
  plugAndPlaySetupGeneratedAt?: string;
  plugAndPlaySetupStatus?: string;
  localAiPreparePath?: string;
  plugAndPlayDoctorPath?: string;
  rehearsalStartSmokePath?: string;
  freshCloneSmokePath?: string;
  freshCloneSmokeLocalHeadSha?: string;
  freshCloneSmokeCloneHeadSha?: string;
  freshCloneSmokeSourceControlHandoffLocalHeadSha?: string;
  freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha?: string;
  freshCloneSmokeSourceControlHandoffFreshCloneHeadSha?: string;
  freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk?: boolean;
  freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount?: number;
  strictAiSmokeStatusPath?: string;
  operatorQuickstartPath?: string;
  checkedFileCount: number;
  safetyBoundary: {
    realAircraftCommandUpload: false;
    hardwareActuationEnabled: false;
    runtimePolicyInstalled: false;
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  files: HandoffBundleFileVerification[];
  secretScan: HandoffBundleSecretScan;
  limitations: string[];
}

export interface HandoffBundleSecretFinding {
  bundlePath: string;
  rule: string;
  details: string;
}

export interface HandoffBundleSecretScan {
  status: VerificationStatus;
  expectedFileCount: number;
  scannedFileCount: number;
  findingCount: number;
  findings: HandoffBundleSecretFinding[];
}

const DEFAULT_OUT_DIR = ".tmp/handoff-bundles";
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
const STRICT_AI_SMOKE_STATUS_PATH = ".tmp/ai-smoke-status.json";
const SECRET_PATTERNS: Array<{ rule: string; pattern: RegExp; details: string }> = [
  {
    rule: "private-key-block",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    details: "Copied bundle file contains a private-key block marker."
  },
  {
    rule: "openai-style-api-key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/,
    details: "Copied bundle file contains an API-key shaped token."
  },
  {
    rule: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    details: "Copied bundle file contains a GitHub-token shaped value."
  },
  {
    rule: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    details: "Copied bundle file contains an AWS access-key shaped value."
  },
  {
    rule: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    details: "Copied bundle file contains a Slack-token shaped value."
  },
  {
    rule: "seekr-internal-token-assignment",
    pattern: /\bSEEKR_INTERNAL_TOKEN\s*[:=]\s*["']?[^"',\s]{8,}/,
    details: "Copied bundle file appears to contain a SEEKR_INTERNAL_TOKEN assignment."
  }
];

export async function buildHandoffBundleVerification(options: {
  root?: string;
  generatedAt?: string;
  bundlePath?: string;
} = {}): Promise<HandoffBundleVerificationManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const bundle = options.bundlePath
    ? { absolutePath: path.resolve(root, options.bundlePath), relativePath: normalizeRelative(root, options.bundlePath) ?? options.bundlePath }
    : await latestJson(root, DEFAULT_OUT_DIR, isBundleManifestName);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const files: HandoffBundleFileVerification[] = [];

  if (!bundle) {
    blockers.push("No handoff bundle JSON manifest exists.");
    return emptyManifest(generatedAt, blockers, warnings);
  }

  if (!isInsideRoot(root, bundle.absolutePath)) {
    blockers.push(`Handoff bundle manifest path escapes root: ${bundle.relativePath}`);
    return emptyManifest(generatedAt, blockers, warnings, bundle.relativePath);
  }

  const manifest = await readJson(bundle.absolutePath);
  if (!isRecord(manifest)) blockers.push("Handoff bundle manifest is missing or malformed.");
  else {
    if (manifest.commandUploadEnabled !== false) blockers.push("Handoff bundle must keep commandUploadEnabled false.");
    if (manifest.status !== "ready-local-alpha-review-bundle") blockers.push("Handoff bundle must be ready-local-alpha-review-bundle.");
    if (!isRecord(manifest.validation) || manifest.validation.ok !== true) blockers.push("Handoff bundle validation must be ok.");
    if (!safetyBoundaryFalse(manifest)) blockers.push("Handoff bundle safety boundary authorization fields must remain false.");
    if (!hardwareClaimsFalse(manifest)) blockers.push("Handoff bundle hardware claims must remain false.");
    const manifestWarnings = isRecord(manifest.validation) && Array.isArray(manifest.validation.warnings)
      ? manifest.validation.warnings.map(String)
      : [];
    warnings.push(...manifestWarnings);
  }

  const bundleDirectory = isRecord(manifest) && typeof manifest.bundleDirectory === "string"
    ? path.resolve(root, manifest.bundleDirectory)
    : undefined;
  const bundleDirectoryOk = Boolean(bundleDirectory && isInsideRoot(root, bundleDirectory));
  let secretScan = emptySecretScan();
  if (!bundleDirectoryOk) {
    blockers.push("Handoff bundle directory is missing or escapes the project root.");
  }

  const manifestFiles = isRecord(manifest) && Array.isArray(manifest.files)
    ? manifest.files.filter(isRecord)
    : [];
  if (!manifestFiles.length) blockers.push("Handoff bundle has no copied file entries.");
  if (isRecord(manifest) && Number(manifest.copiedFileCount) !== manifestFiles.length) {
    blockers.push("Handoff bundle copiedFileCount does not match files length.");
  }

  if (bundleDirectory && bundleDirectoryOk) {
    for (const file of manifestFiles) files.push(await verifyCopiedFile(bundleDirectory, file));
    secretScan = await scanCopiedFilesForSecrets(bundleDirectory, manifestFiles);
  }

  blockers.push(...files
    .filter((file) => file.status === "fail")
    .map((file) => `${file.bundlePath}: ${file.details}`));
  if (secretScan.scannedFileCount !== secretScan.expectedFileCount) {
    blockers.push(`Handoff bundle secret scan covered ${secretScan.scannedFileCount}/${secretScan.expectedFileCount} copied files.`);
  }
  blockers.push(...secretScan.findings.map((finding) => `${finding.bundlePath}: ${finding.details}`));

  const sourceIndexPath = isRecord(manifest) ? stringOrUndefined(manifest.sourceIndexPath) : undefined;
  if (sourceIndexPath && !manifestFiles.some((file) => file.sourcePath === sourceIndexPath)) {
    blockers.push("Handoff bundle does not include the source handoff index JSON.");
  }
  const copiedAcceptance = manifestFiles.some((file) => file.sourcePath === ".tmp/acceptance-status.json")
    ? await readCopiedJson(bundleDirectory ?? root, ".tmp/acceptance-status.json")
    : undefined;
  if (!copiedAcceptance) {
    blockers.push("Handoff bundle does not include copied acceptance status JSON.");
  } else if (!acceptanceStrictLocalAiOk(copiedAcceptance)) {
    blockers.push("Copied acceptance status must pass, keep commandUploadEnabled false, and include the exact required strict local AI scenario names.");
  }
  const strictAiSmokeStatusPath = isRecord(manifest) ? stringOrUndefined(manifest.strictAiSmokeStatusPath) : undefined;
  if (strictAiSmokeStatusPath !== STRICT_AI_SMOKE_STATUS_PATH) {
    blockers.push(`Handoff bundle must name ${STRICT_AI_SMOKE_STATUS_PATH} as the strict local AI smoke status JSON.`);
  } else if (!manifestFiles.some((file) => file.sourcePath === strictAiSmokeStatusPath)) {
    blockers.push("Handoff bundle does not include the strict local AI smoke status JSON.");
  }
  if (bundleDirectory && bundleDirectoryOk && strictAiSmokeStatusPath === STRICT_AI_SMOKE_STATUS_PATH) {
    const strictAiSmoke = await readCopiedJson(bundleDirectory, strictAiSmokeStatusPath);
    if (!strictAiSmokeStatusOk(strictAiSmoke, copiedAcceptance)) {
      blockers.push("Copied strict local AI smoke status must match copied acceptance, use a loopback Ollama URL, require the exact strict AI scenario set, include per-case planKind and validatorOk proof, avoid hold-drone plans, avoid unsafe operator-facing text, avoid state mutation while thinking, and keep command upload disabled.");
    }
  }
  const copiedApiProbeFile = manifestFiles
    .map((file) => String(file.sourcePath ?? ""))
    .filter((sourcePath) => sourcePath.startsWith(".tmp/api-probe/") && sourcePath.endsWith(".json"))
    .sort()
    .at(-1);
  if (!copiedApiProbeFile) {
    blockers.push("Handoff bundle does not include copied API probe JSON.");
  } else if (bundleDirectory && bundleDirectoryOk) {
    const copiedApiProbe = await readCopiedJson(bundleDirectory, copiedApiProbeFile);
    if (!apiProbeAcceptanceReadbackOk(copiedApiProbe, copiedAcceptance)) {
      blockers.push("Copied API probe must read back the copied acceptance timestamp, command count, strict local AI scenario names, release checksum, command-boundary scan, and commandUploadEnabled false.");
    }
  }
  const gstackWorkflowStatusPath = isRecord(manifest) ? stringOrUndefined(manifest.gstackWorkflowStatusPath) : undefined;
  let gstackStatus: unknown;
  if (gstackWorkflowStatusPath && !manifestFiles.some((file) => file.sourcePath === gstackWorkflowStatusPath)) {
    blockers.push("Handoff bundle does not include the source gstack workflow status JSON.");
  }
  if (bundleDirectory && bundleDirectoryOk && gstackWorkflowStatusPath) {
    gstackStatus = await readCopiedJson(bundleDirectory, gstackWorkflowStatusPath);
    if (!(await gstackWorkflowStatusOk(root, gstackStatus))) {
      blockers.push("Copied gstack workflow status must pass or pass-with-limitations, use pass-with-limitations for limitation-only evidence, preserve manifest-level limitation details, preserve limitation details for stale or missing health/QA evidence, record gstack availability, preserve helper-tool evidence when the umbrella CLI is unavailable, include all required workflows, perspective status/score/nextAction details, Git review evidence paths when Git metadata is present or no-Git workspace limitations when absent, and keep commandUploadEnabled false.");
    }
  }
  const gstackQaReportPath = isRecord(manifest) ? stringOrUndefined(manifest.gstackQaReportPath) : undefined;
  const gstackQaScreenshotPaths = isRecord(manifest) && Array.isArray(manifest.gstackQaScreenshotPaths)
    ? manifest.gstackQaScreenshotPaths.filter((item): item is string => typeof item === "string" && item.length > 0).sort((left, right) => left.localeCompare(right))
    : [];
  if (gstackQaReportPath && !manifestFiles.some((file) => file.sourcePath === gstackQaReportPath)) {
    blockers.push("Handoff bundle does not include the source gstack browser QA report.");
  }
  for (const screenshotPath of gstackQaScreenshotPaths) {
    if (!manifestFiles.some((file) => file.sourcePath === screenshotPath)) {
      blockers.push(`Handoff bundle does not include gstack browser QA screenshot ${screenshotPath}.`);
    }
  }
  if (bundleDirectory && bundleDirectoryOk && gstackQaReportPath) {
    const copiedQaReport = await readCopiedText(bundleDirectory, gstackQaReportPath);
    if (!gstackQaReportContentOk(copiedQaReport)) {
      blockers.push("Copied gstack browser QA report must contain a passing verdict, no failing check rows, and commandUploadEnabled false.");
    }
    const reportScreenshotPaths = extractQaScreenshotPaths(copiedQaReport ?? "");
    if (!arraysEqual(reportScreenshotPaths, gstackQaScreenshotPaths)) {
      blockers.push("Handoff bundle gstack QA screenshot paths must match the copied QA report.");
    }
    const workflowQaPath = isRecord(gstackStatus) && isRecord(gstackStatus.qaReport)
      ? stringOrUndefined(gstackStatus.qaReport.path)
      : undefined;
    if (workflowQaPath && workflowQaPath !== gstackQaReportPath) {
      blockers.push("Handoff bundle gstack QA report path does not match the copied workflow-status artifact.");
    }
    const workflowScreenshotPaths = isRecord(gstackStatus) && isRecord(gstackStatus.qaReport) && Array.isArray(gstackStatus.qaReport.screenshotPaths)
      ? gstackStatus.qaReport.screenshotPaths.filter((item): item is string => typeof item === "string" && item.length > 0).sort((left, right) => left.localeCompare(right))
      : [];
    if (!arraysEqual(workflowScreenshotPaths, gstackQaScreenshotPaths)) {
      blockers.push("Handoff bundle gstack QA screenshot paths do not match the copied workflow-status artifact.");
    }
  }
  const todoAuditPath = isRecord(manifest) ? stringOrUndefined(manifest.todoAuditPath) : undefined;
  if (todoAuditPath && !manifestFiles.some((file) => file.sourcePath === todoAuditPath)) {
    blockers.push("Handoff bundle does not include the source TODO audit JSON.");
  }
  if (bundleDirectory && bundleDirectoryOk && todoAuditPath) {
    const todoAudit = await readCopiedJson(bundleDirectory, todoAuditPath);
    if (!todoAuditOk(todoAudit)) {
      blockers.push("Copied TODO audit must pass, include blocker categories, and keep commandUploadEnabled false.");
    }
  }
  const sourceControlHandoffPath = isRecord(manifest) ? stringOrUndefined(manifest.sourceControlHandoffPath) : undefined;
  const manifestSourceControlRepositoryUrl = isRecord(manifest) ? stringOrUndefined(manifest.sourceControlHandoffRepositoryUrl) : undefined;
  const manifestSourceControlPackageRepositoryUrl = isRecord(manifest) ? stringOrUndefined(manifest.sourceControlHandoffPackageRepositoryUrl) : undefined;
  const manifestSourceControlConfiguredRemoteUrls = isRecord(manifest) ? stringArray(manifest.sourceControlHandoffConfiguredRemoteUrls) : [];
  const manifestSourceControlLocalBranch = isRecord(manifest) ? stringOrUndefined(manifest.sourceControlHandoffLocalBranch) : undefined;
  const manifestSourceControlRemoteDefaultBranch = isRecord(manifest) ? stringOrUndefined(manifest.sourceControlHandoffRemoteDefaultBranch) : undefined;
  const manifestSourceControlRemoteRefCount = isRecord(manifest) ? numberOrUndefined(manifest.sourceControlHandoffRemoteRefCount) : undefined;
  const manifestSourceControlBlockedCheckCount = isRecord(manifest) ? numberOrUndefined(manifest.sourceControlHandoffBlockedCheckCount) : undefined;
  const manifestSourceControlWarningCheckCount = isRecord(manifest) ? numberOrUndefined(manifest.sourceControlHandoffWarningCheckCount) : undefined;
  const manifestSourceControlLocalHeadSha = isRecord(manifest) ? stringOrUndefined(manifest.sourceControlHandoffLocalHeadSha) : undefined;
  const manifestSourceControlRemoteDefaultBranchSha = isRecord(manifest) ? stringOrUndefined(manifest.sourceControlHandoffRemoteDefaultBranchSha) : undefined;
  const manifestSourceControlFreshCloneHeadSha = isRecord(manifest) ? stringOrUndefined(manifest.sourceControlHandoffFreshCloneHeadSha) : undefined;
  const manifestSourceControlFreshCloneInstallDryRunOk = isRecord(manifest) ? booleanOrUndefined(manifest.sourceControlHandoffFreshCloneInstallDryRunOk) : undefined;
  const manifestSourceControlFreshCloneCheckedPathCount = isRecord(manifest) ? numberOrUndefined(manifest.sourceControlHandoffFreshCloneCheckedPathCount) : undefined;
  const manifestSourceControlWorkingTreeClean = isRecord(manifest) ? booleanOrUndefined(manifest.sourceControlHandoffWorkingTreeClean) : undefined;
  const manifestSourceControlWorkingTreeStatusLineCount = isRecord(manifest) ? numberOrUndefined(manifest.sourceControlHandoffWorkingTreeStatusLineCount) : undefined;
  let sourceControlHandoffRepositoryUrl = manifestSourceControlRepositoryUrl;
  let sourceControlHandoffPackageRepositoryUrl = manifestSourceControlPackageRepositoryUrl;
  let sourceControlHandoffConfiguredRemoteUrls = manifestSourceControlConfiguredRemoteUrls;
  let sourceControlHandoffLocalBranch = manifestSourceControlLocalBranch;
  let sourceControlHandoffRemoteDefaultBranch = manifestSourceControlRemoteDefaultBranch;
  let sourceControlHandoffRemoteRefCount = manifestSourceControlRemoteRefCount;
  let sourceControlHandoffBlockedCheckCount = manifestSourceControlBlockedCheckCount;
  let sourceControlHandoffWarningCheckCount = manifestSourceControlWarningCheckCount;
  let sourceControlHandoffLocalHeadSha = manifestSourceControlLocalHeadSha;
  let sourceControlHandoffRemoteDefaultBranchSha = manifestSourceControlRemoteDefaultBranchSha;
  let sourceControlHandoffFreshCloneHeadSha = manifestSourceControlFreshCloneHeadSha;
  let sourceControlHandoffFreshCloneInstallDryRunOk = manifestSourceControlFreshCloneInstallDryRunOk;
  let sourceControlHandoffFreshCloneCheckedPathCount = manifestSourceControlFreshCloneCheckedPathCount;
  let sourceControlHandoffWorkingTreeClean = manifestSourceControlWorkingTreeClean;
  let sourceControlHandoffWorkingTreeStatusLineCount = manifestSourceControlWorkingTreeStatusLineCount;
  if (!sourceControlHandoffPath) {
    blockers.push("Handoff bundle must name the source-control handoff JSON.");
  } else if (!manifestFiles.some((file) => file.sourcePath === sourceControlHandoffPath)) {
    blockers.push("Handoff bundle does not include the source-control handoff JSON.");
  }
  if (bundleDirectory && bundleDirectoryOk && sourceControlHandoffPath) {
    const sourceControl = await readCopiedJson(bundleDirectory, sourceControlHandoffPath);
    const copiedRepositoryUrl = isRecord(sourceControl) ? stringOrUndefined(sourceControl.repositoryUrl) : undefined;
    const copiedPackageRepositoryUrl = isRecord(sourceControl) ? stringOrUndefined(sourceControl.packageRepositoryUrl) : undefined;
    const copiedConfiguredRemoteUrls = isRecord(sourceControl) ? stringArray(sourceControl.configuredRemoteUrls) : [];
    const copiedLocalBranch = isRecord(sourceControl) ? stringOrUndefined(sourceControl.localBranch) : undefined;
    const copiedRemoteDefaultBranch = isRecord(sourceControl) ? stringOrUndefined(sourceControl.remoteDefaultBranch) : undefined;
    const copiedRemoteRefCount = isRecord(sourceControl) ? numberOrUndefined(sourceControl.remoteRefCount) : undefined;
    const copiedBlockedCheckCount = isRecord(sourceControl) ? numberOrUndefined(sourceControl.blockedCheckCount) : undefined;
    const copiedWarningCheckCount = isRecord(sourceControl) ? numberOrUndefined(sourceControl.warningCheckCount) : undefined;
    const copiedLocalHeadSha = isRecord(sourceControl) ? stringOrUndefined(sourceControl.localHeadSha) : undefined;
    const copiedRemoteDefaultBranchSha = isRecord(sourceControl) ? stringOrUndefined(sourceControl.remoteDefaultBranchSha) : undefined;
    const copiedFreshCloneHeadSha = isRecord(sourceControl) ? stringOrUndefined(sourceControl.freshCloneHeadSha) : undefined;
    const copiedFreshCloneInstallDryRunOk = isRecord(sourceControl) ? booleanOrUndefined(sourceControl.freshCloneInstallDryRunOk) : undefined;
    const copiedFreshCloneCheckedPathCount = isRecord(sourceControl) ? numberOrUndefined(sourceControl.freshCloneCheckedPathCount) : undefined;
    const copiedWorkingTreeClean = isRecord(sourceControl) ? booleanOrUndefined(sourceControl.workingTreeClean) : undefined;
    const copiedWorkingTreeStatusLineCount = isRecord(sourceControl) ? numberOrUndefined(sourceControl.workingTreeStatusLineCount) : undefined;
    sourceControlHandoffRepositoryUrl = copiedRepositoryUrl ?? sourceControlHandoffRepositoryUrl;
    sourceControlHandoffPackageRepositoryUrl = copiedPackageRepositoryUrl ?? sourceControlHandoffPackageRepositoryUrl;
    sourceControlHandoffConfiguredRemoteUrls = copiedConfiguredRemoteUrls.length ? copiedConfiguredRemoteUrls : sourceControlHandoffConfiguredRemoteUrls;
    sourceControlHandoffLocalBranch = copiedLocalBranch ?? sourceControlHandoffLocalBranch;
    sourceControlHandoffRemoteDefaultBranch = copiedRemoteDefaultBranch ?? sourceControlHandoffRemoteDefaultBranch;
    sourceControlHandoffRemoteRefCount = copiedRemoteRefCount ?? sourceControlHandoffRemoteRefCount;
    sourceControlHandoffBlockedCheckCount = copiedBlockedCheckCount ?? sourceControlHandoffBlockedCheckCount;
    sourceControlHandoffWarningCheckCount = copiedWarningCheckCount ?? sourceControlHandoffWarningCheckCount;
    sourceControlHandoffLocalHeadSha = copiedLocalHeadSha ?? sourceControlHandoffLocalHeadSha;
    sourceControlHandoffRemoteDefaultBranchSha = copiedRemoteDefaultBranchSha ?? sourceControlHandoffRemoteDefaultBranchSha;
    sourceControlHandoffFreshCloneHeadSha = copiedFreshCloneHeadSha ?? sourceControlHandoffFreshCloneHeadSha;
    sourceControlHandoffFreshCloneInstallDryRunOk = copiedFreshCloneInstallDryRunOk ?? sourceControlHandoffFreshCloneInstallDryRunOk;
    sourceControlHandoffFreshCloneCheckedPathCount = copiedFreshCloneCheckedPathCount ?? sourceControlHandoffFreshCloneCheckedPathCount;
    sourceControlHandoffWorkingTreeClean = copiedWorkingTreeClean ?? sourceControlHandoffWorkingTreeClean;
    sourceControlHandoffWorkingTreeStatusLineCount = copiedWorkingTreeStatusLineCount ?? sourceControlHandoffWorkingTreeStatusLineCount;
    const sourceControlValidation = validateSourceControlHandoffManifest(sourceControl);
    if (!sourceControlValidation.ok) {
      blockers.push("Copied source-control handoff must be read-only, name the SEEKR GitHub repository, include local Git, remote-ref, published-HEAD, and clean-worktree checks, and keep commandUploadEnabled false.");
    } else if (!sourceControlHandoffFreshForAcceptance(sourceControl, copiedAcceptance)) {
      blockers.push("Copied ready source-control handoff must be newer than or equal to the copied acceptance record.");
    } else {
      if (isRecord(sourceControl) && sourceControl.ready !== true) {
        warnings.push("Copied source-control handoff remains not ready for publication; local Git/GitHub limitation is preserved for review.");
      }
      if (sourceControlValidation.warningCheckIds.length) {
        warnings.push(`Copied source-control handoff has warning check(s): ${sourceControlValidation.warningCheckIds.join(", ")}.`);
      }
    }
    if (isRecord(sourceControl) && sourceControl.ready === true) {
      if (manifestSourceControlRepositoryUrl !== copiedRepositoryUrl) {
        blockers.push("Handoff bundle source-control repository URL must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlPackageRepositoryUrl !== copiedPackageRepositoryUrl) {
        blockers.push("Handoff bundle source-control package repository URL must match the copied source-control handoff artifact.");
      }
      if (!sameStringArray(manifestSourceControlConfiguredRemoteUrls, copiedConfiguredRemoteUrls)) {
        blockers.push("Handoff bundle source-control configured remotes must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlLocalBranch !== copiedLocalBranch) {
        blockers.push("Handoff bundle source-control local branch must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlRemoteDefaultBranch !== copiedRemoteDefaultBranch) {
        blockers.push("Handoff bundle source-control remote default branch must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlRemoteRefCount !== copiedRemoteRefCount) {
        blockers.push("Handoff bundle source-control remote ref count must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlBlockedCheckCount !== copiedBlockedCheckCount) {
        blockers.push("Handoff bundle source-control blocked-check count must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlWarningCheckCount !== copiedWarningCheckCount) {
        blockers.push("Handoff bundle source-control warning-check count must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlLocalHeadSha !== copiedLocalHeadSha) {
        blockers.push("Handoff bundle source-control local HEAD must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlRemoteDefaultBranchSha !== copiedRemoteDefaultBranchSha) {
        blockers.push("Handoff bundle source-control remote default SHA must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlFreshCloneHeadSha !== copiedFreshCloneHeadSha) {
        blockers.push("Handoff bundle source-control fresh-clone HEAD must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlFreshCloneInstallDryRunOk !== copiedFreshCloneInstallDryRunOk) {
        blockers.push("Handoff bundle source-control fresh-clone npm ci dry-run flag must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlFreshCloneCheckedPathCount !== copiedFreshCloneCheckedPathCount) {
        blockers.push("Handoff bundle source-control fresh-clone checked-path count must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlWorkingTreeClean !== copiedWorkingTreeClean) {
        blockers.push("Handoff bundle source-control clean-worktree flag must match the copied source-control handoff artifact.");
      }
      if (manifestSourceControlWorkingTreeStatusLineCount !== copiedWorkingTreeStatusLineCount) {
        blockers.push("Handoff bundle source-control working-tree status line count must match the copied source-control handoff artifact.");
      }
    }
  }
  const plugAndPlayDoctorPath = isRecord(manifest) ? stringOrUndefined(manifest.plugAndPlayDoctorPath) : undefined;
  const plugAndPlaySetupPath = isRecord(manifest) ? stringOrUndefined(manifest.plugAndPlaySetupPath) : undefined;
  let plugAndPlaySetupGeneratedAt = isRecord(manifest) ? stringOrUndefined(manifest.plugAndPlaySetupGeneratedAt) : undefined;
  let plugAndPlaySetupStatus = isRecord(manifest) ? stringOrUndefined(manifest.plugAndPlaySetupStatus) : undefined;
  const localAiPreparePath = isRecord(manifest) ? stringOrUndefined(manifest.localAiPreparePath) : undefined;
  const rehearsalStartSmokePath = isRecord(manifest) ? stringOrUndefined(manifest.rehearsalStartSmokePath) : undefined;
  const freshCloneSmokePath = isRecord(manifest) ? stringOrUndefined(manifest.freshCloneSmokePath) : undefined;
  const manifestFreshCloneSmokeLocalHeadSha = isRecord(manifest) ? stringOrUndefined(manifest.freshCloneSmokeLocalHeadSha) : undefined;
  const manifestFreshCloneSmokeCloneHeadSha = isRecord(manifest) ? stringOrUndefined(manifest.freshCloneSmokeCloneHeadSha) : undefined;
  const manifestFreshCloneSmokeSourceControlHandoffLocalHeadSha = isRecord(manifest) ? stringOrUndefined(manifest.freshCloneSmokeSourceControlHandoffLocalHeadSha) : undefined;
  const manifestFreshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha = isRecord(manifest) ? stringOrUndefined(manifest.freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha) : undefined;
  const manifestFreshCloneSmokeSourceControlHandoffFreshCloneHeadSha = isRecord(manifest) ? stringOrUndefined(manifest.freshCloneSmokeSourceControlHandoffFreshCloneHeadSha) : undefined;
  const manifestFreshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk = isRecord(manifest) ? booleanOrUndefined(manifest.freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk) : undefined;
  const manifestFreshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount = isRecord(manifest) ? numberOrUndefined(manifest.freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount) : undefined;
  let freshCloneSmokeLocalHeadSha = manifestFreshCloneSmokeLocalHeadSha;
  let freshCloneSmokeCloneHeadSha = manifestFreshCloneSmokeCloneHeadSha;
  let freshCloneSmokeSourceControlHandoffLocalHeadSha = manifestFreshCloneSmokeSourceControlHandoffLocalHeadSha;
  let freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha = manifestFreshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha;
  let freshCloneSmokeSourceControlHandoffFreshCloneHeadSha = manifestFreshCloneSmokeSourceControlHandoffFreshCloneHeadSha;
  let freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk = manifestFreshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk;
  let freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount = manifestFreshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount;
  const operatorQuickstartPath = isRecord(manifest) ? stringOrUndefined(manifest.operatorQuickstartPath) : undefined;
  if (!plugAndPlaySetupPath) {
    blockers.push("Handoff bundle must name the source plug-and-play setup JSON.");
  } else if (!manifestFiles.some((file) => file.sourcePath === plugAndPlaySetupPath)) {
    blockers.push("Handoff bundle does not include the source plug-and-play setup JSON.");
  }
  if (bundleDirectory && bundleDirectoryOk && plugAndPlaySetupPath) {
    const setup = await readCopiedJson(bundleDirectory, plugAndPlaySetupPath);
    if (isRecord(setup)) {
      plugAndPlaySetupGeneratedAt = stringOrUndefined(setup.generatedAt);
      plugAndPlaySetupStatus = stringOrUndefined(setup.status);
    }
    if (!plugAndPlaySetupOk(setup)) {
      blockers.push("Copied plug-and-play setup must pass local env/data preparation and keep commandUploadEnabled false.");
    } else if (!plugAndPlaySetupFreshForAcceptance(setup, copiedAcceptance)) {
      blockers.push("Copied plug-and-play setup must be newer than or equal to the copied acceptance record.");
    }
  }
  if (!localAiPreparePath) {
    blockers.push("Handoff bundle must name the source local AI prepare JSON.");
  } else if (!manifestFiles.some((file) => file.sourcePath === localAiPreparePath)) {
    blockers.push("Handoff bundle does not include the source local AI prepare JSON.");
  }
  if (bundleDirectory && bundleDirectoryOk && localAiPreparePath) {
    const localAiPrepare = await readCopiedJson(bundleDirectory, localAiPreparePath);
    if (!localAiPrepareManifestOk(localAiPrepare)) {
      blockers.push("Copied local AI prepare artifact must prove a passing Ollama model preparation run with commandUploadEnabled false.");
    } else if (!localAiPrepareMatchesAcceptanceModel(localAiPrepare, copiedAcceptance)) {
      blockers.push("Copied local AI prepare artifact must match the copied acceptance strict local AI model.");
    } else if (!localAiPrepareFreshForAcceptance(localAiPrepare, copiedAcceptance)) {
      blockers.push("Copied local AI prepare artifact must be newer than or equal to the copied acceptance record.");
    }
  }
  if (!plugAndPlayDoctorPath) {
    blockers.push("Handoff bundle must name the source plug-and-play doctor JSON.");
  } else if (!manifestFiles.some((file) => file.sourcePath === plugAndPlayDoctorPath)) {
    blockers.push("Handoff bundle does not include the source plug-and-play doctor JSON.");
  }
  if (bundleDirectory && bundleDirectoryOk && plugAndPlayDoctorPath) {
    const doctor = await readCopiedJson(bundleDirectory, plugAndPlayDoctorPath);
    if (!plugAndPlayDoctorOk(doctor, copiedAcceptance, sourceControlHandoffPath)) {
      blockers.push("Copied plug-and-play doctor must pass repository-safety, matching source-control handoff recording, local startup, start-wrapper, local Ollama, ports, data directory, commandUploadEnabled false, and acceptance-freshness semantic checks.");
    }
  }
  if (!rehearsalStartSmokePath) {
    blockers.push("Handoff bundle must name the source rehearsal-start smoke JSON.");
  } else if (!manifestFiles.some((file) => file.sourcePath === rehearsalStartSmokePath)) {
    blockers.push("Handoff bundle does not include the source rehearsal-start smoke JSON.");
  }
  if (bundleDirectory && bundleDirectoryOk && rehearsalStartSmokePath) {
    const rehearsalStartSmoke = await readCopiedJson(bundleDirectory, rehearsalStartSmokePath);
    if (!rehearsalStartSmokeOk(rehearsalStartSmoke, copiedAcceptance)) {
      blockers.push("Copied rehearsal-start smoke must pass local API/client startup, source-health, readiness, clean shutdown, commandUploadEnabled false, and acceptance-freshness semantic checks.");
    }
  }
  if (!freshCloneSmokePath) {
    blockers.push("Handoff bundle must name the source fresh-clone operator smoke JSON.");
  } else if (!manifestFiles.some((file) => file.sourcePath === freshCloneSmokePath)) {
    blockers.push("Handoff bundle does not include the source fresh-clone operator smoke JSON.");
  }
  if (bundleDirectory && bundleDirectoryOk && freshCloneSmokePath) {
    const freshCloneSmoke = await readCopiedJson(bundleDirectory, freshCloneSmokePath);
    const copiedFreshCloneSmokeLocalHeadSha = isRecord(freshCloneSmoke) ? stringOrUndefined(freshCloneSmoke.localHeadSha) : undefined;
    const copiedFreshCloneSmokeCloneHeadSha = isRecord(freshCloneSmoke) ? stringOrUndefined(freshCloneSmoke.cloneHeadSha) : undefined;
    const copiedFreshCloneSmokeSourceControlHandoffLocalHeadSha = isRecord(freshCloneSmoke) ? stringOrUndefined(freshCloneSmoke.sourceControlHandoffLocalHeadSha) : undefined;
    const copiedFreshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha = isRecord(freshCloneSmoke) ? stringOrUndefined(freshCloneSmoke.sourceControlHandoffRemoteDefaultBranchSha) : undefined;
    const copiedFreshCloneSmokeSourceControlHandoffFreshCloneHeadSha = isRecord(freshCloneSmoke) ? stringOrUndefined(freshCloneSmoke.sourceControlHandoffFreshCloneHeadSha) : undefined;
    const copiedFreshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk = isRecord(freshCloneSmoke) ? booleanOrUndefined(freshCloneSmoke.sourceControlHandoffFreshCloneInstallDryRunOk) : undefined;
    const copiedFreshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount = isRecord(freshCloneSmoke) ? numberOrUndefined(freshCloneSmoke.sourceControlHandoffFreshCloneCheckedPathCount) : undefined;
    freshCloneSmokeLocalHeadSha = copiedFreshCloneSmokeLocalHeadSha ?? freshCloneSmokeLocalHeadSha;
    freshCloneSmokeCloneHeadSha = copiedFreshCloneSmokeCloneHeadSha ?? freshCloneSmokeCloneHeadSha;
    freshCloneSmokeSourceControlHandoffLocalHeadSha = copiedFreshCloneSmokeSourceControlHandoffLocalHeadSha ?? freshCloneSmokeSourceControlHandoffLocalHeadSha;
    freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha = copiedFreshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha ?? freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha;
    freshCloneSmokeSourceControlHandoffFreshCloneHeadSha = copiedFreshCloneSmokeSourceControlHandoffFreshCloneHeadSha ?? freshCloneSmokeSourceControlHandoffFreshCloneHeadSha;
    freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk = copiedFreshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk ?? freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk;
    freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount = copiedFreshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount ?? freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount;
    if (!freshCloneOperatorSmokeOk(freshCloneSmoke, copiedAcceptance)) {
      blockers.push("Copied fresh-clone operator smoke must pass clone/install/operator-start/final-doctor checks, match the copied acceptance strict AI model, and keep commandUploadEnabled false.");
    }
    if (manifestFreshCloneSmokeLocalHeadSha !== copiedFreshCloneSmokeLocalHeadSha) {
      blockers.push("Handoff bundle fresh-clone local HEAD must match the copied fresh-clone operator smoke artifact.");
    }
    if (manifestFreshCloneSmokeCloneHeadSha !== copiedFreshCloneSmokeCloneHeadSha) {
      blockers.push("Handoff bundle fresh-clone clone HEAD must match the copied fresh-clone operator smoke artifact.");
    }
    if (manifestFreshCloneSmokeSourceControlHandoffLocalHeadSha !== copiedFreshCloneSmokeSourceControlHandoffLocalHeadSha) {
      blockers.push("Handoff bundle fresh-clone source-control local HEAD must match the copied fresh-clone operator smoke artifact.");
    }
    if (manifestFreshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha !== copiedFreshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha) {
      blockers.push("Handoff bundle fresh-clone source-control remote default SHA must match the copied fresh-clone operator smoke artifact.");
    }
    if (manifestFreshCloneSmokeSourceControlHandoffFreshCloneHeadSha !== copiedFreshCloneSmokeSourceControlHandoffFreshCloneHeadSha) {
      blockers.push("Handoff bundle fresh-clone source-control fresh-clone HEAD must match the copied fresh-clone operator smoke artifact.");
    }
    if (manifestFreshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk !== copiedFreshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk) {
      blockers.push("Handoff bundle fresh-clone source-control fresh-clone npm ci dry-run must match the copied fresh-clone operator smoke artifact.");
    }
    if (manifestFreshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount !== copiedFreshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount) {
      blockers.push("Handoff bundle fresh-clone source-control fresh-clone checked-path count must match the copied fresh-clone operator smoke artifact.");
    }
  }
  if (operatorQuickstartPath !== OPERATOR_QUICKSTART_PATH) {
    blockers.push(`Handoff bundle must name ${OPERATOR_QUICKSTART_PATH} as the operator quickstart.`);
  } else if (!manifestFiles.some((file) => file.sourcePath === operatorQuickstartPath)) {
    blockers.push("Handoff bundle does not include the operator quickstart document.");
  }
  if (bundleDirectory && bundleDirectoryOk && operatorQuickstartPath) {
    const quickstart = await readCopiedText(bundleDirectory, operatorQuickstartPath);
    const missingSignals = operatorQuickstartProblems(quickstart ?? "");
    if (missingSignals.length) {
      blockers.push(`Copied operator quickstart is missing required plug-and-play signal(s): ${missingSignals.join(", ")}.`);
    }
  }

  const ok = blockers.length === 0;
  return {
    schemaVersion: 1,
    generatedAt,
    status: ok ? "pass" : "fail",
    commandUploadEnabled: false,
    sourceBundlePath: bundle.relativePath,
    sourceBundleStatus: isRecord(manifest) ? stringOrUndefined(manifest.status) : undefined,
    sourceIndexPath,
    gstackWorkflowStatusPath,
    gstackQaReportPath,
    gstackQaScreenshotPaths,
    todoAuditPath,
    sourceControlHandoffPath,
    sourceControlHandoffRepositoryUrl,
    sourceControlHandoffPackageRepositoryUrl,
    sourceControlHandoffConfiguredRemoteUrls,
    sourceControlHandoffLocalBranch,
    sourceControlHandoffRemoteDefaultBranch,
    sourceControlHandoffRemoteRefCount,
    sourceControlHandoffBlockedCheckCount,
    sourceControlHandoffWarningCheckCount,
    sourceControlHandoffLocalHeadSha,
    sourceControlHandoffRemoteDefaultBranchSha,
    sourceControlHandoffFreshCloneHeadSha,
    sourceControlHandoffFreshCloneInstallDryRunOk,
    sourceControlHandoffFreshCloneCheckedPathCount,
    sourceControlHandoffWorkingTreeClean,
    sourceControlHandoffWorkingTreeStatusLineCount,
    plugAndPlaySetupPath,
    plugAndPlaySetupGeneratedAt,
    plugAndPlaySetupStatus,
    localAiPreparePath,
    plugAndPlayDoctorPath,
    rehearsalStartSmokePath,
    freshCloneSmokePath,
    freshCloneSmokeLocalHeadSha,
    freshCloneSmokeCloneHeadSha,
    freshCloneSmokeSourceControlHandoffLocalHeadSha,
    freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha,
    freshCloneSmokeSourceControlHandoffFreshCloneHeadSha,
    freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk,
    freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount,
    strictAiSmokeStatusPath,
    operatorQuickstartPath,
    checkedFileCount: files.length,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    validation: {
      ok,
      warnings,
      blockers
    },
    files,
    secretScan,
    limitations: [
      "This verification checks a copied local handoff bundle manifest and the SHA-256 digests it recorded for copied artifacts.",
      "It scans copied text artifacts for high-confidence secret patterns before review handoff.",
      "It semantically checks the copied acceptance status, strict local AI smoke status, API-probe acceptance readback, gstack workflow-status, TODO audit, source-control handoff, plug-and-play setup, plug-and-play doctor, rehearsal-start smoke, fresh-clone operator smoke, and operator quickstart artifacts included in the review packet.",
      "When the bundle names a local gstack browser QA report, this verifier checks that the report and named screenshots were copied and secret-scanned with the rest of the packet.",
      "It does not regenerate acceptance, completion-audit, demo, bench, hardware, policy, safety, API, overnight, handoff index, or handoff verification evidence.",
      "It does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware actuation."
    ]
  };
}

export async function writeHandoffBundleVerification(options: Parameters<typeof buildHandoffBundleVerification>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildHandoffBundleVerification(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-review-bundle-verification-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function verifyCopiedFile(bundleDirectory: string, file: Record<string, unknown>): Promise<HandoffBundleFileVerification> {
  const sourcePath = String(file.sourcePath ?? "");
  const bundlePath = String(file.bundlePath ?? "");
  const expectedBytes = Number(file.bytes);
  const expectedSha256 = String(file.sha256 ?? "");
  const target = path.resolve(bundleDirectory, bundlePath);

  if (!bundlePath || !isInsideRoot(bundleDirectory, target)) {
    return failedFile(sourcePath, bundlePath || "(missing bundle path)", expectedBytes, expectedSha256, "Bundle path is missing or escapes the bundle directory.");
  }
  if (!Number.isFinite(expectedBytes) || expectedBytes < 0 || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return failedFile(sourcePath, bundlePath, Number.isFinite(expectedBytes) ? expectedBytes : 0, expectedSha256, "Bundle file entry is malformed.");
  }

  try {
    const bytes = await readFile(target);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    const bytesMatch = bytes.byteLength === expectedBytes;
    const shaMatches = actualSha256 === expectedSha256;
    return {
      sourcePath,
      bundlePath,
      status: bytesMatch && shaMatches ? "pass" : "fail",
      expectedBytes,
      actualBytes: bytes.byteLength,
      expectedSha256,
      actualSha256,
      details: bytesMatch && shaMatches ? "Digest matches." : "Copied file bytes or SHA-256 no longer match the bundle manifest."
    };
  } catch {
    return failedFile(sourcePath, bundlePath, expectedBytes, expectedSha256, "Copied bundle file is missing.");
  }
}

function failedFile(
  sourcePath: string,
  bundlePath: string,
  expectedBytes: number,
  expectedSha256: string,
  details: string
): HandoffBundleFileVerification {
  return {
    sourcePath,
    bundlePath,
    status: "fail",
    expectedBytes: Number.isFinite(expectedBytes) ? expectedBytes : 0,
    expectedSha256,
    details
  };
}

function emptyManifest(
  generatedAt: string,
  blockers: string[],
  warnings: string[],
  sourceBundlePath?: string
): HandoffBundleVerificationManifest {
  return {
    schemaVersion: 1,
    generatedAt,
    status: "fail",
    commandUploadEnabled: false,
    sourceBundlePath,
    gstackQaScreenshotPaths: [],
    sourceControlHandoffConfiguredRemoteUrls: [],
    checkedFileCount: 0,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    validation: {
      ok: false,
      warnings,
      blockers
    },
    files: [],
    secretScan: emptySecretScan(),
    limitations: [
      "This verification checks a copied local handoff bundle manifest and the SHA-256 digests it recorded for copied artifacts.",
      "It does not validate hardware or authorize command upload."
    ]
  };
}

async function scanCopiedFilesForSecrets(bundleDirectory: string, files: Record<string, unknown>[]): Promise<HandoffBundleSecretScan> {
  const findings: HandoffBundleSecretFinding[] = [];
  let scannedFileCount = 0;
  for (const file of files) {
    const bundlePath = String(file.bundlePath ?? "");
    const target = path.resolve(bundleDirectory, bundlePath);
    if (!bundlePath || !isInsideRoot(bundleDirectory, target)) continue;
    try {
      const content = await readFile(target, "utf8");
      scannedFileCount += 1;
      for (const rule of SECRET_PATTERNS) {
        if (rule.pattern.test(content)) {
          findings.push({
            bundlePath,
            rule: rule.rule,
            details: rule.details
          });
        }
      }
    } catch {
      // Missing or non-text files are handled by the digest verifier.
    }
  }
  const coverageOk = scannedFileCount === files.length;
  return {
    status: findings.length || !coverageOk ? "fail" : "pass",
    expectedFileCount: files.length,
    scannedFileCount,
    findingCount: findings.length,
    findings
  };
}

function emptySecretScan(): HandoffBundleSecretScan {
  return {
    status: "pass",
    expectedFileCount: 0,
    scannedFileCount: 0,
    findingCount: 0,
    findings: []
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

function isBundleManifestName(name: string) {
  return name.startsWith("seekr-handoff-bundle-") && !name.startsWith("seekr-handoff-bundle-verification-");
}

function safetyBoundaryFalse(manifest: Record<string, unknown>) {
  if (!isRecord(manifest.safetyBoundary)) return false;
  return manifest.safetyBoundary.realAircraftCommandUpload === false &&
    manifest.safetyBoundary.hardwareActuationEnabled === false &&
    manifest.safetyBoundary.runtimePolicyInstalled === false;
}

function hardwareClaimsFalse(manifest: Record<string, unknown>) {
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

function renderMarkdown(manifest: HandoffBundleVerificationManifest) {
  return `${[
    "# SEEKR Handoff Bundle Verification",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    manifest.sourceBundlePath ? `Bundle: ${manifest.sourceBundlePath}` : undefined,
    manifest.sourceBundleStatus ? `Bundle status: ${manifest.sourceBundleStatus}` : undefined,
    manifest.sourceIndexPath ? `Source index: ${manifest.sourceIndexPath}` : undefined,
    manifest.gstackWorkflowStatusPath ? `GStack workflow status: ${manifest.gstackWorkflowStatusPath}` : undefined,
    manifest.gstackQaReportPath ? `GStack QA report: ${manifest.gstackQaReportPath}` : undefined,
    manifest.gstackQaScreenshotPaths.length ? `GStack QA screenshots: ${manifest.gstackQaScreenshotPaths.join(", ")}` : undefined,
    manifest.todoAuditPath ? `TODO audit: ${manifest.todoAuditPath}` : undefined,
    manifest.sourceControlHandoffPath ? `Source-control handoff: ${manifest.sourceControlHandoffPath}` : undefined,
    manifest.sourceControlHandoffRepositoryUrl ? `Source-control repository: ${manifest.sourceControlHandoffRepositoryUrl}` : undefined,
    manifest.sourceControlHandoffPackageRepositoryUrl ? `Source-control package repository: ${manifest.sourceControlHandoffPackageRepositoryUrl}` : undefined,
    manifest.sourceControlHandoffConfiguredRemoteUrls.length ? `Source-control configured remotes: ${manifest.sourceControlHandoffConfiguredRemoteUrls.join(", ")}` : undefined,
    manifest.sourceControlHandoffLocalBranch ? `Source-control local branch: ${manifest.sourceControlHandoffLocalBranch}` : undefined,
    manifest.sourceControlHandoffRemoteDefaultBranch ? `Source-control remote default branch: ${manifest.sourceControlHandoffRemoteDefaultBranch}` : undefined,
    typeof manifest.sourceControlHandoffRemoteRefCount === "number" ? `Source-control remote ref count: ${manifest.sourceControlHandoffRemoteRefCount}` : undefined,
    typeof manifest.sourceControlHandoffBlockedCheckCount === "number" ? `Source-control blocked checks: ${manifest.sourceControlHandoffBlockedCheckCount}` : undefined,
    typeof manifest.sourceControlHandoffWarningCheckCount === "number" ? `Source-control warning checks: ${manifest.sourceControlHandoffWarningCheckCount}` : undefined,
    manifest.sourceControlHandoffLocalHeadSha ? `Source-control local HEAD: ${manifest.sourceControlHandoffLocalHeadSha}` : undefined,
    manifest.sourceControlHandoffRemoteDefaultBranchSha ? `Source-control remote default SHA: ${manifest.sourceControlHandoffRemoteDefaultBranchSha}` : undefined,
    manifest.sourceControlHandoffFreshCloneHeadSha ? `Source-control fresh-clone HEAD: ${manifest.sourceControlHandoffFreshCloneHeadSha}` : undefined,
    typeof manifest.sourceControlHandoffFreshCloneInstallDryRunOk === "boolean" ? `Source-control fresh-clone npm ci dry-run: ${manifest.sourceControlHandoffFreshCloneInstallDryRunOk}` : undefined,
    typeof manifest.sourceControlHandoffFreshCloneCheckedPathCount === "number" ? `Source-control fresh-clone checked paths: ${manifest.sourceControlHandoffFreshCloneCheckedPathCount}` : undefined,
    typeof manifest.sourceControlHandoffWorkingTreeClean === "boolean" ? `Source-control working tree clean: ${manifest.sourceControlHandoffWorkingTreeClean}` : undefined,
    typeof manifest.sourceControlHandoffWorkingTreeStatusLineCount === "number" ? `Source-control working tree status lines: ${manifest.sourceControlHandoffWorkingTreeStatusLineCount}` : undefined,
    manifest.plugAndPlaySetupPath ? `Plug-and-play setup: ${manifest.plugAndPlaySetupPath}` : undefined,
    manifest.plugAndPlaySetupGeneratedAt ? `Plug-and-play setup generated at: ${manifest.plugAndPlaySetupGeneratedAt}` : undefined,
    manifest.plugAndPlaySetupStatus ? `Plug-and-play setup verdict: ${manifest.plugAndPlaySetupStatus}` : undefined,
    manifest.localAiPreparePath ? `Local AI prepare: ${manifest.localAiPreparePath}` : undefined,
    manifest.plugAndPlayDoctorPath ? `Plug-and-play doctor: ${manifest.plugAndPlayDoctorPath}` : undefined,
    manifest.rehearsalStartSmokePath ? `Rehearsal-start smoke: ${manifest.rehearsalStartSmokePath}` : undefined,
    manifest.freshCloneSmokePath ? `Fresh-clone smoke: ${manifest.freshCloneSmokePath}` : undefined,
    manifest.freshCloneSmokeLocalHeadSha ? `Fresh-clone local HEAD: ${manifest.freshCloneSmokeLocalHeadSha}` : undefined,
    manifest.freshCloneSmokeCloneHeadSha ? `Fresh-clone clone HEAD: ${manifest.freshCloneSmokeCloneHeadSha}` : undefined,
    manifest.freshCloneSmokeSourceControlHandoffLocalHeadSha ? `Fresh-clone source-control local HEAD: ${manifest.freshCloneSmokeSourceControlHandoffLocalHeadSha}` : undefined,
    manifest.freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha ? `Fresh-clone source-control remote default SHA: ${manifest.freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha}` : undefined,
    manifest.freshCloneSmokeSourceControlHandoffFreshCloneHeadSha ? `Fresh-clone source-control fresh-clone HEAD: ${manifest.freshCloneSmokeSourceControlHandoffFreshCloneHeadSha}` : undefined,
    typeof manifest.freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk === "boolean" ? `Fresh-clone source-control fresh-clone npm ci dry-run: ${manifest.freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk}` : undefined,
    typeof manifest.freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount === "number" ? `Fresh-clone source-control fresh-clone checked paths: ${manifest.freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount}` : undefined,
    manifest.strictAiSmokeStatusPath ? `Strict AI smoke status: ${manifest.strictAiSmokeStatusPath}` : undefined,
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
    "Copied file verification:",
    "",
    "| Source | Bundle path | Status | Expected bytes | Actual bytes | Details |",
    "| --- | --- | --- | ---: | ---: | --- |",
    ...(manifest.files.length
      ? manifest.files.map((file) => `| ${file.sourcePath} | ${file.bundlePath} | ${file.status} | ${file.expectedBytes} | ${file.actualBytes ?? "n/a"} | ${escapeTable(file.details)} |`)
      : ["| None | n/a | fail | 0 | n/a | No copied files checked. |"]),
    "",
    "Validation:",
    "",
    `- OK: ${manifest.validation.ok}`,
    ...(manifest.validation.blockers.length ? manifest.validation.blockers.map((item) => `- Blocker: ${item}`) : ["- Blockers: none"]),
    ...(manifest.validation.warnings.length ? manifest.validation.warnings.map((item) => `- Warning: ${item}`) : ["- Warnings: none"]),
    "",
    "Secret scan:",
    "",
    `- Status: ${manifest.secretScan.status}`,
    `- Expected files: ${manifest.secretScan.expectedFileCount}`,
    `- Scanned files: ${manifest.secretScan.scannedFileCount}`,
    `- Findings: ${manifest.secretScan.findingCount}`,
    ...(manifest.secretScan.findings.length
      ? manifest.secretScan.findings.map((finding) => `- Finding: ${finding.bundlePath} (${finding.rule})`)
      : ["- Findings: none"]),
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

function normalizeRelative(root: string, value: string) {
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

async function readCopiedJson(bundleDirectory: string, sourcePath: string): Promise<unknown> {
  const target = path.resolve(bundleDirectory, "artifacts", sourcePath);
  if (!isInsideRoot(bundleDirectory, target)) return undefined;
  return await readJson(target);
}

async function readCopiedText(bundleDirectory: string, sourcePath: string): Promise<string | undefined> {
  const target = path.resolve(bundleDirectory, "artifacts", sourcePath);
  if (!isInsideRoot(bundleDirectory, target)) return undefined;
  try {
    return await readFile(target, "utf8");
  } catch {
    return undefined;
  }
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
    gstackQaReportOk(qaReport) &&
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

function gstackQaReportOk(qaReport: Record<string, unknown>) {
  const status = String(qaReport.status);
  const limitations = limitationStrings(qaReport);
  return qaReport.commandUploadEnabled === false &&
    (status === "pass" || limitations.length > 0) &&
    (status === "missing" ||
      ((status === "pass" || status === "stale") && typeof qaReport.path === "string" && qaReport.path.length > 0));
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

function gstackQaReportContentOk(content: string | undefined) {
  if (!content) return false;
  const pass = content.includes("Pass for local internal-alpha browser/API QA") ||
    /## Verdict\s+Pass\b/is.test(content) ||
    /Status:\s*pass\b/i.test(content);
  const commandSafe = content.includes("commandUploadEnabled` stayed `false`") ||
    content.includes("commandUploadEnabled: false") ||
    content.includes("Command upload enabled: false");
  return pass && commandSafe && qaReportFailedRows(content).length === 0;
}

function qaReportFailedRows(content: string) {
  return content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2 && cells[0] !== "Check" && !/^[-: ]+$/.test(cells.join("")))
    .filter((cells) => /^fail\b/i.test(cells[1]));
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

function acceptanceStrictLocalAiOk(manifest: unknown) {
  if (!isRecord(manifest)) return false;
  const strictLocalAi = isRecord(manifest.strictLocalAi) ? manifest.strictLocalAi : {};
  const caseNames = stringArray(strictLocalAi.caseNames);
  return manifest.ok === true &&
    manifest.commandUploadEnabled === false &&
    strictLocalAi.ok === true &&
    strictLocalAi.provider === "ollama" &&
    typeof strictLocalAi.model === "string" &&
    isLocalOllamaUrl(strictLocalAi.ollamaUrl) &&
    Number(strictLocalAi.caseCount) === REQUIRED_STRICT_AI_SMOKE_CASES.length &&
    Number(strictLocalAi.caseCount) === caseNames.length &&
    arraysEqual(caseNames, [...REQUIRED_STRICT_AI_SMOKE_CASES]);
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

function apiProbeAcceptanceReadbackOk(apiProbe: unknown, acceptance: unknown) {
  if (!isRecord(apiProbe) || !isRecord(acceptance)) return false;
  const sessionAcceptance = isRecord(apiProbe.sessionAcceptance) ? apiProbe.sessionAcceptance : {};
  const probeAi = isRecord(sessionAcceptance.strictLocalAi) ? sessionAcceptance.strictLocalAi : {};
  const acceptanceAi = isRecord(acceptance.strictLocalAi) ? acceptance.strictLocalAi : {};
  const probeRelease = isRecord(sessionAcceptance.releaseChecksum) ? sessionAcceptance.releaseChecksum : {};
  const acceptanceRelease = isRecord(acceptance.releaseChecksum) ? acceptance.releaseChecksum : {};
  const probeScan = isRecord(sessionAcceptance.commandBoundaryScan) ? sessionAcceptance.commandBoundaryScan : {};
  const acceptanceScan = isRecord(acceptance.commandBoundaryScan) ? acceptance.commandBoundaryScan : {};
  const acceptanceCommandCount = Array.isArray(acceptance.completedCommands) ? acceptance.completedCommands.length : undefined;
  const acceptanceAiCaseNames = stringArray(acceptanceAi.caseNames);
  const probeAiCaseNames = stringArray(probeAi.caseNames);
  return apiProbe.ok === true &&
    apiProbe.commandUploadEnabled === false &&
    sessionAcceptance.status === "pass" &&
    sessionAcceptance.commandUploadEnabled === false &&
    Number(sessionAcceptance.generatedAt) === Number(acceptance.generatedAt) &&
    (acceptanceCommandCount === undefined || Number(sessionAcceptance.commandCount) === acceptanceCommandCount) &&
    probeAi.ok === acceptanceAi.ok &&
    probeAi.provider === acceptanceAi.provider &&
    probeAi.model === acceptanceAi.model &&
    probeAi.ollamaUrl === acceptanceAi.ollamaUrl &&
    isLocalOllamaUrl(acceptanceAi.ollamaUrl) &&
    Number(probeAi.caseCount) === Number(acceptanceAi.caseCount) &&
    arraysEqual(probeAiCaseNames, acceptanceAiCaseNames) &&
    probeRelease.overallSha256 === acceptanceRelease.overallSha256 &&
    Number(probeRelease.fileCount) === Number(acceptanceRelease.fileCount) &&
    Number(probeRelease.totalBytes) === Number(acceptanceRelease.totalBytes) &&
    probeScan.status === acceptanceScan.status &&
    Number(probeScan.scannedFileCount) === Number(acceptanceScan.scannedFileCount) &&
    Number(probeScan.violationCount) === Number(acceptanceScan.violationCount) &&
    Number(probeScan.allowedFindingCount) === Number(acceptanceScan.allowedFindingCount);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function sourceControlHandoffFreshForAcceptance(manifest: unknown, acceptance: unknown) {
  if (!isRecord(manifest) || manifest.ready !== true) return true;
  if (!isRecord(acceptance)) return false;
  const acceptanceGeneratedAt = timeMs(acceptance.generatedAt);
  if (acceptanceGeneratedAt === undefined) return false;
  const generatedAt = timeMs(manifest.generatedAt);
  return generatedAt !== undefined && generatedAt >= acceptanceGeneratedAt;
}

function rehearsalStartSmokeOk(manifest: unknown, acceptance: unknown) {
  return validateRehearsalStartSmokeManifest(manifest).ok && artifactFreshForAcceptance(manifest, acceptance);
}

function artifactFreshForAcceptance(manifest: unknown, acceptance: unknown) {
  if (!isRecord(manifest) || !isRecord(acceptance)) return false;
  const acceptanceGeneratedAt = timeMs(acceptance.generatedAt);
  if (acceptanceGeneratedAt === undefined) return false;
  const generatedAt = timeMs(manifest.generatedAt);
  return generatedAt !== undefined && generatedAt >= acceptanceGeneratedAt;
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
  const result = await writeHandoffBundleVerification({
    outDir: typeof args.out === "string" ? args.out : undefined,
    bundlePath: typeof args.bundle === "string" ? args.bundle : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    sourceBundlePath: result.manifest.sourceBundlePath,
    sourceIndexPath: result.manifest.sourceIndexPath,
    gstackWorkflowStatusPath: result.manifest.gstackWorkflowStatusPath,
    gstackQaReportPath: result.manifest.gstackQaReportPath,
    gstackQaScreenshotPaths: result.manifest.gstackQaScreenshotPaths,
    todoAuditPath: result.manifest.todoAuditPath,
    sourceControlHandoffPath: result.manifest.sourceControlHandoffPath,
    sourceControlHandoffRepositoryUrl: result.manifest.sourceControlHandoffRepositoryUrl,
    sourceControlHandoffPackageRepositoryUrl: result.manifest.sourceControlHandoffPackageRepositoryUrl,
    sourceControlHandoffConfiguredRemoteUrls: result.manifest.sourceControlHandoffConfiguredRemoteUrls,
    sourceControlHandoffLocalBranch: result.manifest.sourceControlHandoffLocalBranch,
    sourceControlHandoffRemoteDefaultBranch: result.manifest.sourceControlHandoffRemoteDefaultBranch,
    sourceControlHandoffRemoteRefCount: result.manifest.sourceControlHandoffRemoteRefCount,
    sourceControlHandoffBlockedCheckCount: result.manifest.sourceControlHandoffBlockedCheckCount,
    sourceControlHandoffWarningCheckCount: result.manifest.sourceControlHandoffWarningCheckCount,
    sourceControlHandoffLocalHeadSha: result.manifest.sourceControlHandoffLocalHeadSha,
    sourceControlHandoffRemoteDefaultBranchSha: result.manifest.sourceControlHandoffRemoteDefaultBranchSha,
    sourceControlHandoffFreshCloneHeadSha: result.manifest.sourceControlHandoffFreshCloneHeadSha,
    sourceControlHandoffFreshCloneInstallDryRunOk: result.manifest.sourceControlHandoffFreshCloneInstallDryRunOk,
    sourceControlHandoffFreshCloneCheckedPathCount: result.manifest.sourceControlHandoffFreshCloneCheckedPathCount,
    sourceControlHandoffWorkingTreeClean: result.manifest.sourceControlHandoffWorkingTreeClean,
    sourceControlHandoffWorkingTreeStatusLineCount: result.manifest.sourceControlHandoffWorkingTreeStatusLineCount,
    plugAndPlaySetupPath: result.manifest.plugAndPlaySetupPath,
    plugAndPlaySetupGeneratedAt: result.manifest.plugAndPlaySetupGeneratedAt,
    plugAndPlaySetupStatus: result.manifest.plugAndPlaySetupStatus,
    localAiPreparePath: result.manifest.localAiPreparePath,
    plugAndPlayDoctorPath: result.manifest.plugAndPlayDoctorPath,
    rehearsalStartSmokePath: result.manifest.rehearsalStartSmokePath,
    freshCloneSmokePath: result.manifest.freshCloneSmokePath,
    freshCloneSmokeLocalHeadSha: result.manifest.freshCloneSmokeLocalHeadSha,
    freshCloneSmokeCloneHeadSha: result.manifest.freshCloneSmokeCloneHeadSha,
    freshCloneSmokeSourceControlHandoffLocalHeadSha: result.manifest.freshCloneSmokeSourceControlHandoffLocalHeadSha,
    freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha: result.manifest.freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha,
    freshCloneSmokeSourceControlHandoffFreshCloneHeadSha: result.manifest.freshCloneSmokeSourceControlHandoffFreshCloneHeadSha,
    freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk: result.manifest.freshCloneSmokeSourceControlHandoffFreshCloneInstallDryRunOk,
    freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount: result.manifest.freshCloneSmokeSourceControlHandoffFreshCloneCheckedPathCount,
    strictAiSmokeStatusPath: result.manifest.strictAiSmokeStatusPath,
    operatorQuickstartPath: result.manifest.operatorQuickstartPath,
    checkedFileCount: result.manifest.checkedFileCount,
    secretScan: result.manifest.secretScan,
    validation: result.manifest.validation,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
