import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";

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

  const checks = [
    acceptanceCheck(acceptance),
    sourceControlCheck(sourceControl),
    freshCloneCheck(freshClone),
    reviewBundleCheck(bundleVerify),
    gstackCheck(gstack),
    plugAndPlayCheck(plugAndPlay),
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
      autoRecoverable: booleanOrUndefined(getPath(plugAndPlayManifest, ["operatorStartPorts", "autoRecoverable"]))
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

function acceptanceCheck(manifest: unknown): LocalRecoveryStatusCheck {
  const ok = isRecord(manifest) && manifest.ok === true && manifest.commandUploadEnabled === false;
  const checksum = stringOrUndefined(getPath(manifest, ["releaseChecksum", "overallSha256"])) ?? "unknown checksum";
  const aiProvider = stringOrUndefined(getPath(manifest, ["strictLocalAi", "provider"])) ?? "unknown AI provider";
  return {
    id: "acceptance-status",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Latest acceptance is pass with ${checksum}, strict local AI provider ${aiProvider}, and commandUploadEnabled false.`
      : "Latest acceptance status is missing, unsafe, or not passing.",
    evidence: [".tmp/acceptance-status.json"]
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

function freshCloneCheck(artifact: LatestArtifact | undefined): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const localHead = stringOrUndefined(manifest?.localHeadSha);
  const cloneHead = stringOrUndefined(manifest?.cloneHeadSha);
  const provider = stringOrUndefined(manifest?.strictAiSmokeProvider);
  const url = stringOrUndefined(manifest?.strictAiSmokeOllamaUrl);
  const caseCount = numberOrUndefined(manifest?.strictAiSmokeCaseCount);
  const ok = isRecord(manifest) &&
    manifest.status === "pass" &&
    manifest.commandUploadEnabled === false &&
    !!localHead &&
    localHead === cloneHead &&
    provider === "ollama" &&
    !!url &&
    isLoopbackUrl(url) &&
    caseCount === 4;
  return {
    id: "fresh-clone-ai-proof",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Fresh clone proof passed at ${cloneHead} with Ollama strict AI smoke (${caseCount} cases).`
      : "Fresh clone proof is missing, stale, not SHA-aligned, or lacks strict loopback Ollama AI smoke evidence.",
    evidence: [artifact?.relativePath ?? ".tmp/fresh-clone-smoke"]
  };
}

function reviewBundleCheck(artifact: LatestArtifact | undefined): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const secretScan = isRecord(manifest?.secretScan) ? manifest.secretScan : undefined;
  const checked = numberOrUndefined(manifest?.checkedFileCount);
  const scanned = numberOrUndefined(secretScan?.scannedFileCount);
  const expected = numberOrUndefined(secretScan?.expectedFileCount);
  const ok = isRecord(manifest) &&
    manifest.status === "pass" &&
    manifest.commandUploadEnabled === false &&
    secretScan?.status === "pass" &&
    numberOrUndefined(secretScan.findingCount) === 0 &&
    checked !== undefined &&
    checked === scanned &&
    checked === expected;
  return {
    id: "review-bundle-verification",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Review bundle verification passed with ${checked} copied files scanned and 0 secret findings.`
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

function plugAndPlayCheck(artifact: LatestArtifact | undefined): LocalRecoveryStatusCheck {
  const manifest = recordOrUndefined(artifact?.manifest);
  const summary = isRecord(manifest?.summary) ? manifest.summary : undefined;
  const warnCount = numberOrUndefined(summary?.warn) ?? 0;
  const failCount = numberOrUndefined(summary?.fail) ?? 0;
  const ok = isRecord(manifest) &&
    manifest.localPlugAndPlayOk === true &&
    manifest.commandUploadEnabled === false &&
    failCount === 0;
  return {
    id: "plug-and-play-readiness",
    status: !ok ? "fail" : warnCount > 0 ? "warn" : "pass",
    details: ok
      ? `Plug-and-play readiness is ${manifest.status}${warnCount ? ` with ${warnCount} warning(s)` : ""}.`
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

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

async function main() {
  const result = await writeLocalRecoveryStatus();
  console.log(JSON.stringify({
    ok: result.manifest.localRecoveryOk,
    status: result.manifest.status,
    complete: result.manifest.complete,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    localHeadSha: result.manifest.localHeadSha,
    releaseChecksum: result.manifest.releaseChecksum,
    remainingRealWorldBlockerCount: result.manifest.remainingRealWorldBlockerCount,
    summary: result.manifest.summary,
    nextCommands: result.manifest.nextCommands,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.localRecoveryOk) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
