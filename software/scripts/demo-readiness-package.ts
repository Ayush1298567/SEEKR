import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";
import { validateSourceControlHandoffManifest } from "./source-control-handoff";

export interface DemoReadinessPackageManifest {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  status: "ready-local-alpha" | "blocked-local-alpha";
  localAlphaOk: boolean;
  complete: boolean;
  commandUploadEnabled: false;
  artifacts: {
    acceptanceStatusPath: string;
    releaseEvidenceJsonPath: string;
    releaseEvidenceSha256Path?: string;
    releaseEvidenceMarkdownPath?: string;
    safetyScanJsonPath?: string;
    safetyScanMarkdownPath?: string;
    apiProbeJsonPath?: string;
    apiProbeMarkdownPath?: string;
    completionAuditJsonPath: string;
    completionAuditMarkdownPath?: string;
    sourceControlHandoffJsonPath?: string;
    sourceControlHandoffMarkdownPath?: string;
    hardwareEvidenceJsonPath?: string;
    policyGateJsonPath?: string;
    overnightStatusPath?: string;
  };
  overnightStatus?: {
    verdict: string;
    lastUpdate?: string;
    cycle?: string;
    stale: boolean;
    ok: boolean;
  };
  releaseChecksum?: {
    overallSha256: string;
    fileCount: number;
    totalBytes: number;
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  perspectiveReview: DemoPerspectiveReviewItem[];
  realWorldBlockers: string[];
  nextEvidenceChecklist: DemoNextEvidenceItem[];
  hardwareClaims: {
    jetsonOrinNanoValidated: false;
    raspberryPi5Validated: false;
    realMavlinkBenchValidated: false;
    realRos2BenchValidated: false;
    hilFailsafeValidated: false;
    isaacJetsonCaptureValidated: false;
    hardwareActuationAuthorized: false;
  };
  limitations: string[];
}

export interface DemoNextEvidenceItem {
  id: string;
  label: string;
  currentStatus: string;
  currentDetails: string;
  evidence: string[];
  requiredEvidence: string;
  nextCommand: string;
  runbook: string;
  hardwareRequired: boolean;
  safetyBoundary: string;
}

export interface DemoPerspectiveReviewItem {
  id: "operator" | "safety" | "dx" | "replay" | "demo-readiness";
  label: string;
  status: "ready-local-alpha" | "blocked-real-world" | "needs-attention";
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  evidence: string[];
  nextAction: string;
}

const DEFAULT_OUT_DIR = ".tmp/demo-readiness";
const DEFAULT_ACCEPTANCE_PATH = ".tmp/acceptance-status.json";

export async function buildDemoReadinessPackage(options: {
  root?: string;
  generatedAt?: string;
  label?: string;
  acceptanceStatusPath?: string;
} = {}): Promise<DemoReadinessPackageManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label ?? "internal-alpha";
  const warnings: string[] = [];
  const blockers: string[] = [];
  const acceptanceStatusPath = options.acceptanceStatusPath ?? DEFAULT_ACCEPTANCE_PATH;
  const acceptance = await readJson(path.join(root, acceptanceStatusPath));
  const release = await latestJson(root, ".tmp/release-evidence", (name) => name.startsWith("seekr-release-"));
  const safety = await latestJson(root, ".tmp/safety-evidence", (name) => name.startsWith("seekr-command-boundary-scan-"));
  const apiProbe = await latestJson(root, ".tmp/api-probe", (name) => name.startsWith("seekr-api-probe-"));
  const completionAudit = await latestJson(root, ".tmp/completion-audit", (name) => name.startsWith("seekr-completion-audit-"));
  const sourceControl = await latestJson(root, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
  const hardware = await latestJson(root, ".tmp/hardware-evidence", (name) => name.startsWith("seekr-hardware-evidence-"));
  const policyGate = await latestJson(root, ".tmp/policy-evidence", (name) => name.startsWith("seekr-hardware-actuation-gate-"));
  const overnightStatusPath = ".tmp/overnight/STATUS.md";
  const overnightStatus = await readOvernightStatus(root, overnightStatusPath, generatedAt);

  if (!isRecord(acceptance) || acceptance.ok !== true || acceptance.commandUploadEnabled !== false) {
    blockers.push("Acceptance status must exist, pass, and keep commandUploadEnabled false.");
  }
  if (!release) {
    blockers.push("Release checksum evidence is missing.");
  }
  if (!safety) {
    blockers.push("Command-boundary scan evidence is missing.");
  }
  if (!apiProbe) {
    blockers.push("API probe evidence is missing.");
  }
  if (!completionAudit) {
    blockers.push("Completion audit evidence is missing.");
  }

  const releaseManifest = release ? await readJson(release.absolutePath) : undefined;
  const safetyManifest = safety ? await readJson(safety.absolutePath) : undefined;
  const apiProbeManifest = apiProbe ? await readJson(apiProbe.absolutePath) : undefined;
  const auditManifest = completionAudit ? await readJson(completionAudit.absolutePath) : undefined;
  const sourceControlManifest = sourceControl ? await readJson(sourceControl.absolutePath) : undefined;
  if (release && (!isRecord(releaseManifest) || releaseManifest.commandUploadEnabled !== false || typeof releaseManifest.overallSha256 !== "string")) {
    blockers.push("Release checksum evidence must keep commandUploadEnabled false and include an overall SHA-256.");
  }
  if (safety && (!isRecord(safetyManifest) || safetyManifest.status !== "pass" || safetyManifest.commandUploadEnabled !== false)) {
    blockers.push("Command-boundary scan evidence must pass and keep commandUploadEnabled false.");
  }
  if (apiProbe && !apiProbeManifestOk(apiProbeManifest)) {
    blockers.push("API probe evidence must pass, keep commandUploadEnabled false, and include session-visible acceptance checks.");
  }
  if (completionAudit && (!isRecord(auditManifest) || auditManifest.commandUploadEnabled !== false || auditManifest.localAlphaOk !== true)) {
    blockers.push("Completion audit must keep commandUploadEnabled false and report localAlphaOk true.");
  }

  const acceptanceRelease = isRecord(acceptance) && isRecord(acceptance.releaseChecksum) ? acceptance.releaseChecksum : {};
  if (release && normalizeArtifactPath(root, acceptanceRelease.jsonPath) !== release.relativePath) {
    blockers.push("Acceptance status release checksum path does not point at the latest release evidence.");
  }
  if (
    isRecord(releaseManifest) &&
    typeof releaseManifest.overallSha256 === "string" &&
    typeof acceptanceRelease.overallSha256 === "string" &&
    acceptanceRelease.overallSha256 !== releaseManifest.overallSha256
  ) {
    blockers.push("Acceptance status release checksum does not match the latest release evidence.");
  }
  const acceptanceScan = isRecord(acceptance) && isRecord(acceptance.commandBoundaryScan) ? acceptance.commandBoundaryScan : {};
  const safetySummary = isRecord(safetyManifest) && isRecord(safetyManifest.summary) ? safetyManifest.summary : {};
  if (safety && normalizeArtifactPath(root, acceptanceScan.jsonPath) !== safety.relativePath) {
    blockers.push("Acceptance status command-boundary scan path does not point at the latest safety evidence.");
  }
  if (safety && normalizeArtifactPath(root, acceptanceScan.markdownPath) !== replaceExtension(safety.relativePath, ".md")) {
    blockers.push("Acceptance status command-boundary scan Markdown path does not point at the latest safety evidence.");
  }
  if (
    safety &&
    (
      acceptanceScan.status !== "pass" ||
      acceptanceScan.commandUploadEnabled !== false ||
      Number(acceptanceScan.violationCount) !== 0 ||
      Number(safetySummary.violationCount) !== 0 ||
      Number(acceptanceScan.scannedFileCount) !== Number(safetySummary.scannedFileCount) ||
      Number(acceptanceScan.allowedFindingCount) !== Number(safetySummary.allowedFindingCount)
    )
  ) {
    blockers.push("Acceptance status command-boundary scan summary does not match the latest safety evidence.");
  }

  if (!hardware) warnings.push("No hardware archive evidence exists in this package.");
  if (!policyGate) warnings.push("No hardware-actuation policy gate artifact exists in this package.");
  if (!overnightStatus) warnings.push("No overnight-loop STATUS.md exists in this package.");
  else if (!overnightStatus.ok) warnings.push("Overnight-loop status is not pass.");
  else if (overnightStatus.stale) warnings.push("Overnight-loop status is pass but older than 48 hours.");

  const realWorldBlockers = realWorldBlockersFromAudit(auditManifest);
  const nextEvidenceChecklist = buildNextEvidenceChecklist(auditManifest);
  const localAlphaOk = blockers.length === 0;
  const complete = isRecord(auditManifest) && auditManifest.complete === true;
  const perspectiveReview = buildPerspectiveReview({
    localAlphaOk,
    complete,
    acceptanceManifest: acceptance,
    apiProbeManifest,
    auditManifest,
    sourceControlPath: sourceControl?.relativePath,
    sourceControlManifest,
    overnightStatus,
    realWorldBlockers,
    nextEvidenceChecklist
  });

  return {
    schemaVersion: 1,
    generatedAt,
    label,
    status: localAlphaOk ? "ready-local-alpha" : "blocked-local-alpha",
    localAlphaOk,
    complete,
    commandUploadEnabled: false,
    artifacts: {
      acceptanceStatusPath,
      releaseEvidenceJsonPath: release?.relativePath ?? "",
      releaseEvidenceSha256Path: release ? replaceExtension(release.relativePath, ".sha256") : undefined,
      releaseEvidenceMarkdownPath: release ? replaceExtension(release.relativePath, ".md") : undefined,
      safetyScanJsonPath: safety?.relativePath,
      safetyScanMarkdownPath: safety ? replaceExtension(safety.relativePath, ".md") : undefined,
      apiProbeJsonPath: apiProbe?.relativePath,
      apiProbeMarkdownPath: apiProbe ? replaceExtension(apiProbe.relativePath, ".md") : undefined,
      completionAuditJsonPath: completionAudit?.relativePath ?? "",
      completionAuditMarkdownPath: completionAudit ? replaceExtension(completionAudit.relativePath, ".md") : undefined,
      sourceControlHandoffJsonPath: sourceControl?.relativePath,
      sourceControlHandoffMarkdownPath: sourceControl ? replaceExtension(sourceControl.relativePath, ".md") : undefined,
      hardwareEvidenceJsonPath: hardware?.relativePath,
      policyGateJsonPath: policyGate?.relativePath,
      overnightStatusPath
    },
    overnightStatus,
    releaseChecksum: isRecord(releaseManifest) && typeof releaseManifest.overallSha256 === "string"
      ? {
          overallSha256: releaseManifest.overallSha256,
          fileCount: Number(releaseManifest.fileCount),
          totalBytes: Number(releaseManifest.totalBytes)
        }
      : undefined,
    validation: {
      ok: localAlphaOk,
      warnings,
      blockers
    },
    perspectiveReview,
    realWorldBlockers,
    nextEvidenceChecklist,
    hardwareClaims: {
      jetsonOrinNanoValidated: false,
      raspberryPi5Validated: false,
      realMavlinkBenchValidated: false,
      realRos2BenchValidated: false,
      hilFailsafeValidated: false,
      isaacJetsonCaptureValidated: false,
      hardwareActuationAuthorized: false
    },
    limitations: [
      localAlphaOk
        ? "This package is ready for an internal local-alpha demo or audit handoff."
        : "This package is blocked because local-alpha acceptance evidence is incomplete or inconsistent.",
      "This package does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim to Jetson capture, or hardware actuation.",
      "Real MAVLink, ROS 2, PX4, ArduPilot, mission, geofence, mode, arm, takeoff, land, RTH, terminate, and waypoint command paths remain blocked outside simulator/SITL transports."
    ]
  };
}

export async function writeDemoReadinessPackage(options: Parameters<typeof buildDemoReadinessPackage>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildDemoReadinessPackage(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const safeLabel = safeFileNamePart(manifest.label, "internal-alpha");
  const baseName = `seekr-demo-readiness-${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function latestJson(root: string, directory: string, predicate: (name: string) => boolean) {
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

function renderMarkdown(manifest: DemoReadinessPackageManifest) {
  return `${[
    "# SEEKR Demo Readiness Package",
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
    `- Release evidence: ${manifest.artifacts.releaseEvidenceJsonPath}`,
    manifest.artifacts.safetyScanJsonPath ? `- Command-boundary scan: ${manifest.artifacts.safetyScanJsonPath}` : undefined,
    manifest.artifacts.apiProbeJsonPath ? `- API probe evidence: ${manifest.artifacts.apiProbeJsonPath}` : undefined,
    `- Completion audit: ${manifest.artifacts.completionAuditJsonPath}`,
    manifest.artifacts.sourceControlHandoffJsonPath ? `- Source-control handoff: ${manifest.artifacts.sourceControlHandoffJsonPath}` : undefined,
    manifest.artifacts.hardwareEvidenceJsonPath ? `- Hardware evidence: ${manifest.artifacts.hardwareEvidenceJsonPath}` : undefined,
    manifest.artifacts.policyGateJsonPath ? `- Policy gate evidence: ${manifest.artifacts.policyGateJsonPath}` : undefined,
    manifest.artifacts.overnightStatusPath ? `- Overnight status: ${manifest.artifacts.overnightStatusPath}` : undefined,
    "",
    manifest.releaseChecksum ? `Release SHA-256: ${manifest.releaseChecksum.overallSha256}` : undefined,
    "",
    manifest.overnightStatus ? "Overnight status:" : undefined,
    manifest.overnightStatus ? "" : undefined,
    manifest.overnightStatus ? `- Verdict: ${manifest.overnightStatus.verdict}` : undefined,
    manifest.overnightStatus?.cycle ? `- Cycle: ${manifest.overnightStatus.cycle}` : undefined,
    manifest.overnightStatus?.lastUpdate ? `- Last update: ${manifest.overnightStatus.lastUpdate}` : undefined,
    manifest.overnightStatus ? `- Stale: ${manifest.overnightStatus.stale}` : undefined,
    "",
    "Perspective review:",
    "",
    ...manifest.perspectiveReview.flatMap((item) => [
      `- ${item.label}: ${item.status} (${item.score}/10)`,
      `  - Summary: ${item.summary}`,
      `  - Strengths: ${item.strengths.join("; ")}`,
      `  - Gaps: ${item.gaps.length ? item.gaps.join("; ") : "none"}`,
      `  - Next action: ${item.nextAction}`,
      `  - Evidence: ${item.evidence.join(", ")}`
    ]),
    "",
    "Hardware claims:",
    "",
    ...Object.entries(manifest.hardwareClaims).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "Real-world blockers:",
    "",
    ...(manifest.realWorldBlockers.length ? manifest.realWorldBlockers.map((blocker) => `- ${blocker}`) : ["- None"]),
    "",
    "Next evidence checklist:",
    "",
    ...(manifest.nextEvidenceChecklist.length
      ? manifest.nextEvidenceChecklist.flatMap((item) => [
          `- ${item.label}: ${item.requiredEvidence}`,
          `  - Next command: ${item.nextCommand}`,
          `  - Runbook: ${item.runbook}`,
          `  - Hardware required: ${item.hardwareRequired}`,
          `  - Safety boundary: ${item.safetyBoundary}`
        ])
      : ["- None"]),
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

function buildNextEvidenceChecklist(auditManifest: unknown): DemoNextEvidenceItem[] {
  if (!isRecord(auditManifest) || !Array.isArray(auditManifest.items)) return [];
  return auditManifest.items
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.status === "blocked")
    .flatMap((item) => {
      const id = String(item.id ?? "unknown-blocker");
      const label = String(item.label ?? id);
      const currentStatus = String(item.status ?? "blocked");
      const currentDetails = String(item.details ?? "");
      const evidence = Array.isArray(item.evidence) ? item.evidence.map((value) => String(value)) : [];
      return checklistIdsForBlockedItem(id, currentDetails).map((checklistId) => {
        const guidance = evidenceGuidance(checklistId);
        return {
          id: checklistId,
          label: checklistLabel(checklistId, label),
          currentStatus,
          currentDetails,
          evidence,
          requiredEvidence: guidance.requiredEvidence,
          nextCommand: guidance.nextCommand,
          runbook: guidance.runbook,
          hardwareRequired: guidance.hardwareRequired,
          safetyBoundary: guidance.safetyBoundary
        };
      });
    });
}

function realWorldBlockersFromAudit(auditManifest: unknown) {
  if (!isRecord(auditManifest)) return [];
  const auditItems = Array.isArray(auditManifest.items) ? auditManifest.items.filter(isRecord) : [];
  const blockedItems = auditItems.filter((item) => item.status === "blocked");
  if (!blockedItems.length) {
    return Array.isArray(auditManifest.realWorldBlockers)
      ? auditManifest.realWorldBlockers.map((item) => String(item))
      : [];
  }

  return blockedItems.flatMap((item) => {
    const id = String(item.id ?? "unknown-blocker");
    const label = String(item.label ?? id);
    const details = String(item.details ?? label);
    return blockerTextsForAuditItem(id, label, details);
  });
}

function blockerTextsForAuditItem(id: string, label: string, details: string) {
  if (id !== "actual-board-hardware-evidence") return [details || label];
  return checklistIdsForBlockedItem(id, details).map((checklistId) => hardwareBlockerText(checklistId, details));
}

function hardwareBlockerText(id: string, details: string) {
  const target = hardwareTargetForChecklistId(id);
  if (!target) return details;
  const lower = details.toLowerCase();
  if (lower.includes("hardware archives exist") || lower.includes("no actual-target")) {
    return `Hardware archives exist, but no actual-target host-platform pass was found for: ${target.id}.`;
  }
  if (lower.includes("no hardware evidence archives exist") || lower.includes("no actual")) {
    return `No actual ${target.name} hardware readiness archive is present.`;
  }
  return `Actual ${target.name} hardware readiness remains blocked: ${details}`;
}

function checklistIdsForBlockedItem(id: string, details: string) {
  if (id !== "actual-board-hardware-evidence") return [id];
  const lower = details.toLowerCase();
  const mentionsJetson = lower.includes("jetson") || lower.includes("jetson-orin-nano");
  const mentionsPi = lower.includes("raspberry") || lower.includes("raspberry-pi-5");
  if (!mentionsJetson && !mentionsPi) {
    return ["actual-jetson-orin-nano-hardware-evidence", "actual-raspberry-pi-5-hardware-evidence"];
  }
  return [
    mentionsJetson ? "actual-jetson-orin-nano-hardware-evidence" : undefined,
    mentionsPi ? "actual-raspberry-pi-5-hardware-evidence" : undefined
  ].filter(isString);
}

function hardwareTargetForChecklistId(id: string) {
  const targets: Record<string, { id: string; name: string }> = {
    "actual-jetson-orin-nano-hardware-evidence": {
      id: "jetson-orin-nano",
      name: "Jetson Orin Nano"
    },
    "actual-raspberry-pi-5-hardware-evidence": {
      id: "raspberry-pi-5",
      name: "Raspberry Pi 5"
    }
  };
  return targets[id];
}

function checklistLabel(id: string, fallback: string) {
  const labels: Record<string, string> = {
    "actual-jetson-orin-nano-hardware-evidence": "Actual Jetson Orin Nano hardware readiness archive",
    "actual-raspberry-pi-5-hardware-evidence": "Actual Raspberry Pi 5 hardware readiness archive"
  };
  return labels[id] ?? fallback;
}

function buildPerspectiveReview(options: {
  localAlphaOk: boolean;
  complete: boolean;
  acceptanceManifest: unknown;
  apiProbeManifest: unknown;
  auditManifest: unknown;
  sourceControlPath?: string;
  sourceControlManifest?: unknown;
  overnightStatus: DemoReadinessPackageManifest["overnightStatus"];
  realWorldBlockers: string[];
  nextEvidenceChecklist: DemoNextEvidenceItem[];
}): DemoPerspectiveReviewItem[] {
  const auditItems = isRecord(options.auditManifest) && Array.isArray(options.auditManifest.items)
    ? options.auditManifest.items.filter(isRecord)
    : [];
  const blockedIds = new Set(auditItems
    .filter((item) => item.status === "blocked")
    .map((item) => String(item.id ?? "")));
  const checked = isRecord(options.apiProbeManifest) && Array.isArray(options.apiProbeManifest.checked)
    ? options.apiProbeManifest.checked.map(String)
    : [];
  const evidenceFor = (id: string, fallback: string[]) => {
    const item = auditItems.find((candidate) => candidate.id === id);
    return item && Array.isArray(item.evidence) ? item.evidence.map(String) : fallback;
  };
  const statusForRealWorld = (hasRealWorldGap: boolean): DemoPerspectiveReviewItem["status"] => {
    if (!options.localAlphaOk) return "needs-attention";
    return hasRealWorldGap || !options.complete ? "blocked-real-world" : "ready-local-alpha";
  };
  const sourceControlState = sourceControlReviewState(options.sourceControlManifest, options.sourceControlPath, options.acceptanceManifest);
  const hasChecklist = (id: string) => options.nextEvidenceChecklist.some((item) => item.id === id);
  const apiProbeOk = checked.includes("session-acceptance-evidence") && checked.includes("verify") && checked.includes("replays");
  const overnightOk = options.overnightStatus?.ok === true && options.overnightStatus.stale === false;

  return [
    {
      id: "operator",
      label: "Operator",
      status: statusForRealWorld(blockedIds.has("fresh-operator-rehearsal")),
      score: options.localAlphaOk ? (blockedIds.has("fresh-operator-rehearsal") ? 7 : 9) : 4,
      summary: blockedIds.has("fresh-operator-rehearsal")
        ? "Operator workflows are covered locally, but a fresh field-laptop rehearsal closeout is still missing."
        : "Operator workflows have local-alpha evidence and no fresh-operator blocker is present.",
      strengths: [
        "Playwright covers mission controls, artifacts, readiness, source health, replay, and compact field-laptop layouts.",
        "Rehearsal note and closeout tooling exists without allowing synthetic completion."
      ],
      gaps: blockedIds.has("fresh-operator-rehearsal")
        ? ["No completed fresh-operator field-laptop closeout from an actual run."]
        : [],
      evidence: ["tests/ui/gcs-smoke.pw.ts", "scripts/rehearsal-note.ts", "scripts/rehearsal-closeout.ts", ...evidenceFor("fresh-operator-rehearsal", [])],
      nextAction: hasChecklist("fresh-operator-rehearsal")
        ? "Complete the fresh-operator rehearsal task card and archive a validated closeout."
        : "Keep operator rehearsal evidence current."
    },
    {
      id: "safety",
      label: "Safety",
      status: statusForRealWorld(blockedIds.has("hil-failsafe-logs") || blockedIds.has("hardware-actuation-policy-review")),
      score: options.localAlphaOk ? 8 : 4,
      summary: "The command boundary is fail-closed locally; physical HIL and policy-review evidence are intentionally still blocked.",
      strengths: [
        "Acceptance and handoff evidence keep commandUploadEnabled false.",
        "Static command-boundary scan reports zero violations."
      ],
      gaps: [
        ...(blockedIds.has("hil-failsafe-logs") ? ["No real HIL failsafe/manual override log archive."] : []),
        ...(blockedIds.has("hardware-actuation-policy-review") ? ["No reviewed fail-closed hardware-actuation policy package."] : [])
      ],
      evidence: ["scripts/command-boundary-scan.ts", "scripts/hardware-actuation-policy-gate.ts", ...evidenceFor("hil-failsafe-logs", []), ...evidenceFor("hardware-actuation-policy-review", [])],
      nextAction: "Collect real HIL/manual-override evidence before running the hardware policy gate for human review."
    },
    {
      id: "dx",
      label: "DX",
      status: options.localAlphaOk ? "ready-local-alpha" : "needs-attention",
      score: options.localAlphaOk && options.nextEvidenceChecklist.length > 0 ? 8 : 5,
      summary: "The command surface is scriptable and the demo package turns blockers into runbook-backed next actions.",
      strengths: [
        "Acceptance, audit, demo, bench-packet, handoff, and bridge commands are exposed through package scripts.",
        "Next-evidence checklist includes commands, runbooks, and hardware-required flags.",
        ...(sourceControlState.ready ? ["Source-control handoff confirms local HEAD is published to GitHub with a clean worktree."] : [])
      ],
      gaps: sourceControlState.gaps,
      evidence: ["package.json", "docs/goal.md", "docs/EDGE_HARDWARE_BENCH.md", ...sourceControlState.evidence],
      nextAction: sourceControlState.nextAction
    },
    {
      id: "replay",
      label: "Replay",
      status: apiProbeOk && options.localAlphaOk ? "ready-local-alpha" : "needs-attention",
      score: apiProbeOk && options.localAlphaOk ? 9 : 5,
      summary: apiProbeOk
        ? "Replay and verification evidence are part of the final API readback."
        : "Replay/verification API readback is incomplete.",
      strengths: [
        "API probe checks replay listing and hash verification.",
        "Acceptance includes edge, DimOS, and preview smoke flows that exercise replay/evidence paths."
      ],
      gaps: apiProbeOk ? [] : ["Latest API probe did not include both verify and replays checks."],
      evidence: [".tmp/api-probe", "src/server/persistence/replayStore.ts", "src/server/__tests__/simulatorReplay.test.ts"],
      nextAction: "Keep final API probe evidence current after every acceptance run."
    },
    {
      id: "demo-readiness",
      label: "Demo Readiness",
      status: statusForRealWorld(options.realWorldBlockers.length > 0),
      score: options.localAlphaOk && overnightOk ? 8 : 5,
      summary: options.realWorldBlockers.length > 0
        ? "Local alpha handoff is ready, but demo claims must keep physical hardware blockers visible."
        : "Demo handoff has local-alpha evidence with no real-world blockers reported.",
      strengths: [
        "Demo package, bench packet, handoff index, and handoff verification form a digest-checked chain.",
        "Overnight status is included in the package."
      ],
      gaps: options.realWorldBlockers,
      evidence: [".tmp/demo-readiness", ".tmp/bench-evidence-packet", ".tmp/handoff-index", ".tmp/overnight/STATUS.md"],
      nextAction: "Use the bench evidence packet for the next physical evidence collection session."
    }
  ];
}

function evidenceGuidance(id: string): Omit<DemoNextEvidenceItem, "id" | "label" | "currentStatus" | "currentDetails" | "evidence"> {
  const defaultBoundary = "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation.";
  const guidance: Record<string, Omit<DemoNextEvidenceItem, "id" | "label" | "currentStatus" | "currentDetails" | "evidence">> = {
    "actual-board-hardware-evidence": {
      requiredEvidence: "Run hardware readiness archive on actual Jetson Orin Nano and Raspberry Pi 5 hosts, producing actual-target hardware evidence.",
      nextCommand: "npm run probe:hardware:archive",
      runbook: "docs/EDGE_HARDWARE_BENCH.md",
      hardwareRequired: true,
      safetyBoundary: defaultBoundary
    },
    "actual-jetson-orin-nano-hardware-evidence": {
      requiredEvidence: "Run a hardware readiness archive on the actual Jetson Orin Nano host and preserve actual-target evidence with command upload disabled.",
      nextCommand: "npm run probe:hardware:archive -- --target jetson-orin-nano",
      runbook: "docs/EDGE_HARDWARE_BENCH.md",
      hardwareRequired: true,
      safetyBoundary: defaultBoundary
    },
    "actual-raspberry-pi-5-hardware-evidence": {
      requiredEvidence: "Run a hardware readiness archive on the actual Raspberry Pi 5 host and preserve actual-target evidence with command upload disabled.",
      nextCommand: "npm run probe:hardware:archive -- --target raspberry-pi-5",
      runbook: "docs/EDGE_HARDWARE_BENCH.md",
      hardwareRequired: true,
      safetyBoundary: defaultBoundary
    },
    "fresh-operator-rehearsal": {
      requiredEvidence: "Complete a fresh-operator field-laptop run with before/after rehearsal evidence, export, replay id, final hash, shutdown timestamp, and deviations.",
      nextCommand: "npm run rehearsal:closeout -- --operator <name> --machine <id> --before <json> --after <json> --replay-id <id> --final-hash <sha256> ...",
      runbook: "docs/FIELD_LAPTOP_RUNBOOK.md",
      hardwareRequired: false,
      safetyBoundary: defaultBoundary
    },
    "real-mavlink-bench": {
      requiredEvidence: "Run the read-only MAVLink serial or UDP bridge against a real bench telemetry source, then capture required-source rehearsal evidence from the observed MAVLink source.",
      nextCommand: "npm run bridge:mavlink:serial -- --base-url http://127.0.0.1:8787 --device <serial-device> --duration-ms 30000 --max-bytes 1000000 --evidence-label mavlink-bench && npm run rehearsal:evidence -- --label mavlink-bench --require-source mavlink:telemetry:drone-1",
      runbook: "docs/EDGE_HARDWARE_BENCH.md",
      hardwareRequired: true,
      safetyBoundary: defaultBoundary
    },
    "real-ros2-bench": {
      requiredEvidence: "Run the live read-only ROS 2 topic bridge against real bench topics, then capture required-source rehearsal evidence from observed pose, map/costmap, perception/detection, and LiDAR/spatial sources.",
      nextCommand: "npm run bridge:ros2:live -- --base-url http://127.0.0.1:8787 --topic /drone/pose,/map,/detections,/lidar/points --duration-ms 30000 --max-records 200 --evidence-label ros2-bench && npm run rehearsal:evidence -- --label ros2-bench --require-source ros2-pose:telemetry,lidar-slam:lidar+spatial,isaac-nvblox:costmap",
      runbook: "docs/EDGE_HARDWARE_BENCH.md",
      hardwareRequired: true,
      safetyBoundary: defaultBoundary
    },
    "hil-failsafe-logs": {
      requiredEvidence: "Archive a completed HIL failsafe/manual override run with actual target-board hardware evidence, valid rehearsal evidence, non-empty flight log, manual override, and E-stop verification.",
      nextCommand: "npm run hil:failsafe:evidence -- --operator <name> --target <target> --vehicle <id> --hardware-evidence <json> --rehearsal-evidence <json> --flight-log <path> --command-upload-enabled false ...",
      runbook: "docs/EDGE_HARDWARE_BENCH.md",
      hardwareRequired: true,
      safetyBoundary: defaultBoundary
    },
    "isaac-jetson-capture": {
      requiredEvidence: "Archive an Isaac Sim to Jetson HIL capture with actual Jetson hardware evidence, Isaac source-health evidence, capture manifest counts, and non-empty capture logs.",
      nextCommand: "npm run isaac:hil:evidence -- --operator <name> --target jetson-orin-nano --hardware-evidence <json> --rehearsal-evidence <json> --capture-manifest <json> --capture-log <path> --command-upload-enabled false ...",
      runbook: "docs/EDGE_HARDWARE_BENCH.md",
      hardwareRequired: true,
      safetyBoundary: defaultBoundary
    },
    "hardware-actuation-policy-review": {
      requiredEvidence: "Generate a fail-closed hardware-actuation review package after actual target-board and HIL evidence exist; all authorization fields must remain false.",
      nextCommand: "npm run policy:hardware:gate -- --operator <name> --target <target> --vehicle <id> --reviewers \"Safety Lead,Test Director\" --policy <json> --hardware-evidence <json> --hil-evidence <json> --command-upload-enabled false",
      runbook: "docs/HARDWARE_DECISION_GATE.md",
      hardwareRequired: true,
      safetyBoundary: defaultBoundary
    }
  };
  return guidance[id] ?? {
    requiredEvidence: "Review the completion-audit item and attach the missing evidence it names.",
    nextCommand: "npm run audit:completion",
    runbook: "docs/goal.md",
    hardwareRequired: true,
    safetyBoundary: defaultBoundary
  };
}

function apiProbeManifestOk(manifest: unknown) {
  const checked = isRecord(manifest) && Array.isArray(manifest.checked) ? manifest.checked.map(String) : [];
  const sessionAcceptance = isRecord(manifest) && isRecord(manifest.sessionAcceptance) ? manifest.sessionAcceptance : {};
  return isRecord(manifest) &&
    manifest.ok === true &&
    manifest.commandUploadEnabled === false &&
    checked.includes("session-acceptance-evidence") &&
    checked.includes("malformed-json") &&
    sessionAcceptance.commandUploadEnabled === false;
}

function sourceControlReviewState(manifest: unknown, sourceControlPath?: string, acceptanceManifest?: unknown) {
  const evidence = [sourceControlPath ?? ".tmp/source-control-handoff"];
  const validation = validateSourceControlHandoffManifest(manifest);
  if (!isRecord(manifest)) {
    return {
      ready: false,
      gaps: ["Source-control handoff evidence is missing; run npm run audit:source-control before claiming GitHub review readiness."],
      evidence,
      nextAction: "Run npm run audit:source-control after publishing the current local HEAD."
    };
  }
  if (!validation.ok) {
    return {
      ready: false,
      gaps: [`Source-control handoff evidence is malformed or unsafe: ${validation.problems.join("; ")}.`],
      evidence,
      nextAction: "Regenerate source-control handoff evidence with npm run audit:source-control."
    };
  }
  if (!validation.ready) {
    const pending = [...validation.blockedCheckIds, ...validation.warningCheckIds];
    return {
      ready: false,
      gaps: [`Source-control handoff is not ready for GitHub review yet: ${pending.join(", ")}.`],
      evidence,
      nextAction: "Resolve source-control handoff gaps, publish the current local HEAD, and rerun npm run audit:source-control."
    };
  }
  if (!sourceControlHandoffFreshForAcceptance(manifest, acceptanceManifest)) {
    return {
      ready: false,
      gaps: ["Ready source-control handoff evidence was generated before the latest acceptance record."],
      evidence,
      nextAction: "Rerun npm run audit:source-control after the latest acceptance record before claiming GitHub review readiness."
    };
  }
  return {
    ready: true,
    gaps: [],
    evidence,
    nextAction: "Keep source-control handoff evidence current after every commit before internal review."
  };
}

function sourceControlHandoffFreshForAcceptance(manifest: unknown, acceptanceManifest: unknown) {
  if (!isRecord(manifest) || manifest.ready !== true) return true;
  if (!isRecord(acceptanceManifest)) return false;
  const acceptanceGeneratedAt = timeMs(acceptanceManifest.generatedAt);
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

async function readOvernightStatus(root: string, statusPath: string, generatedAt: string) {
  try {
    const content = await readFile(path.join(root, statusPath), "utf8");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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
  const result = await writeDemoReadinessPackage({
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    acceptanceStatusPath: typeof args.acceptance === "string" ? args.acceptance : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    status: result.manifest.status,
    localAlphaOk: result.manifest.localAlphaOk,
    complete: result.manifest.complete,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    blockerCount: result.manifest.realWorldBlockers.length,
    nextEvidenceCount: result.manifest.nextEvidenceChecklist.length,
    validation: result.manifest.validation,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
