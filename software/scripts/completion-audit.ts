import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";

type AuditStatus = "pass" | "warn" | "fail" | "blocked";

export interface CompletionAuditItem {
  id: string;
  label: string;
  status: AuditStatus;
  details: string;
  evidence: string[];
}

export interface CompletionAuditManifest {
  schemaVersion: 1;
  generatedAt: string;
  status: "complete" | "blocked-real-world-evidence" | "local-alpha-failing";
  localAlphaOk: boolean;
  complete: boolean;
  commandUploadEnabled: false;
  summary: {
    pass: number;
    warn: number;
    fail: number;
    blocked: number;
  };
  items: CompletionAuditItem[];
  realWorldBlockerIds: string[];
  realWorldBlockers: string[];
}

const REQUIRED_DOCS = [
  "README.md",
  "docs/SEEKR_GCS_ALPHA_TODO.md",
  "docs/SEEKR_COMPLETION_PLAN.md",
  "docs/FLIGHT_SOFTWARE.md",
  "docs/EDGE_HARDWARE_BENCH.md",
  "docs/HARDWARE_DECISION_GATE.md",
  "docs/V1_ACCEPTANCE.md",
  "docs/goal.md",
  "package.json"
];

const REQUIRED_SCRIPTS = [
  "check",
  "acceptance",
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
  "smoke:preview",
  "release:checksum",
  "acceptance:record",
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
  "audit:goal",
  "probe:api",
  "probe:hardware",
  "probe:hardware:archive"
];

const DEFAULT_OUT_DIR = ".tmp/completion-audit";

export async function buildCompletionAudit(options: {
  root?: string;
  generatedAt?: string;
} = {}): Promise<CompletionAuditManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const items: CompletionAuditItem[] = [];

  items.push(await docsItem(root));
  items.push(await scriptsItem(root));
  items.push(await acceptanceItem(root, generatedAt));
  items.push(await apiProbeItem(root));
  items.push(await latestReleaseItem(root));
  items.push(await latestRehearsalItem(root));
  items.push(await overnightItem(root, generatedAt));
  items.push(...await hardwareArchiveItems(root));
  items.push(await adapterSafetyItem(root));
  items.push(await commandBoundaryScanItem(root));
  items.push(await freshOperatorRehearsalItem(root));
  items.push(await realBridgeEvidenceItem(root, {
    id: "real-mavlink-bench",
    label: "Real read-only MAVLink bench connection",
    blockedDetails: "No evidence shows a real serial/UDP MAVLink telemetry source connected to the read-only bridge on bench hardware.",
    passDetails: "Actual-target hardware evidence, bridge-run evidence, and required-source rehearsal evidence show read-only MAVLink telemetry events.",
    bridge: {
      label: "MAVLink serial or UDP bridge run",
      variants: [
        {
          label: "MAVLink serial bridge run",
          modes: ["mavlink-serial-readonly"],
          safetyFalse: ["serialWriteOpened"]
        },
        {
          label: "MAVLink UDP bridge run",
          modes: ["mavlink-telemetry"],
          listenerProtocol: "udp",
          safetyFalse: []
        }
      ]
    },
    groups: [
      {
        label: "MAVLink telemetry",
        adapters: ["mavlink"],
        channels: ["telemetry"]
      }
    ]
  }));
  items.push(await realBridgeEvidenceItem(root, {
    id: "real-ros2-bench",
    label: "Real read-only ROS 2 bench topics",
    blockedDetails: "No evidence shows real ROS 2 /map, pose, detection, LiDAR, or costmap topics connected through the read-only bridge.",
    passDetails: "Actual-target hardware evidence, bridge-run evidence, and required-source rehearsal evidence show read-only ROS 2 map/pose/perception/spatial events.",
    bridge: {
      label: "Live ROS 2 topic bridge run",
      variants: [
        {
          label: "Live ROS 2 topic bridge run",
          modes: ["ros2-live-readonly"],
          safetyFalse: ["ros2ServicesTouched", "ros2ActionsTouched"]
        }
      ]
    },
    groups: [
      {
        label: "ROS 2 map or costmap",
        adapters: ["ros2-slam", "isaac-nvblox"],
        channels: ["map", "costmap"]
      },
      {
        label: "ROS 2 pose or odometry",
        adapters: ["ros2-pose"],
        channels: ["telemetry"]
      },
      {
        label: "ROS 2 detection or perception",
        adapters: ["detection", "ros2-perception", "isaac-nvblox", "isaac-sim-hil"],
        channels: ["detection", "perception"]
      },
      {
        label: "ROS 2 LiDAR or spatial",
        adapters: ["lidar-slam", "rtab-map", "lio-sam", "fast-lio2", "isaac-sim-hil"],
        channels: ["lidar", "spatial", "slam"]
      }
    ]
  }));
  items.push(await hilFailsafeEvidenceItem(root));
  items.push(await isaacHilCaptureEvidenceItem(root));
  items.push(await hardwareActuationPolicyReviewItem(root));

  const summary = {
    pass: items.filter((item) => item.status === "pass").length,
    warn: items.filter((item) => item.status === "warn").length,
    fail: items.filter((item) => item.status === "fail").length,
    blocked: items.filter((item) => item.status === "blocked").length
  };
  const blockedItems = items.filter((item) => item.status === "blocked");
  const localAlphaOk = summary.fail === 0;
  const complete = localAlphaOk && summary.blocked === 0;

  return {
    schemaVersion: 1,
    generatedAt,
    status: complete ? "complete" : localAlphaOk ? "blocked-real-world-evidence" : "local-alpha-failing",
    localAlphaOk,
    complete,
    commandUploadEnabled: false,
    summary,
    items,
    realWorldBlockerIds: blockedItems.map((item) => item.id),
    realWorldBlockers: blockedItems.map((item) => item.details)
  };
}

export async function writeCompletionAudit(options: {
  root?: string;
  outDir?: string;
  generatedAt?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildCompletionAudit({ root, generatedAt: options.generatedAt });
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-completion-audit-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function docsItem(root: string): Promise<CompletionAuditItem> {
  const missing = [];
  for (const doc of REQUIRED_DOCS) {
    if (!(await pathExists(path.join(root, doc)))) missing.push(doc);
  }
  return {
    id: "required-docs",
    label: "Required objective docs",
    status: missing.length ? "fail" : "pass",
    details: missing.length ? `Missing required docs: ${missing.join(", ")}` : "All required objective docs are present.",
    evidence: REQUIRED_DOCS
  };
}

async function scriptsItem(root: string): Promise<CompletionAuditItem> {
  const packageJson = await readJson(path.join(root, "package.json"));
  const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const missing = REQUIRED_SCRIPTS.filter((script) => typeof scripts[script] !== "string");
  return {
    id: "required-scripts",
    label: "Required local alpha scripts",
    status: missing.length ? "fail" : "pass",
    details: missing.length ? `Missing package scripts: ${missing.join(", ")}` : "All required package scripts are present.",
    evidence: REQUIRED_SCRIPTS.map((script) => `package.json scripts.${script}`)
  };
}

async function acceptanceItem(root: string, generatedAt: string): Promise<CompletionAuditItem> {
  const acceptancePath = path.join(root, ".tmp", "acceptance-status.json");
  const status = await readJson(acceptancePath);
  if (!isRecord(status)) {
    return {
      id: "acceptance-status",
      label: "Recorded acceptance status",
      status: "fail",
      details: ".tmp/acceptance-status.json is missing or malformed.",
      evidence: [".tmp/acceptance-status.json"]
    };
  }

  const problems: string[] = [];
  if (status.ok !== true) problems.push("status.ok is not true");
  if (status.commandUploadEnabled !== false) problems.push("commandUploadEnabled is not false");
  if (typeof status.generatedAt !== "number") problems.push("generatedAt is missing");

  const latestRelease = await latestJson(root, ".tmp/release-evidence", (name) => name.startsWith("seekr-release-"));
  const latestReleaseManifest = latestRelease ? await readJson(latestRelease.absolutePath) : undefined;
  const acceptanceRelease = isRecord(status.releaseChecksum) ? status.releaseChecksum : {};
  if (!latestRelease) {
    problems.push("latest release evidence is missing");
  } else {
    if (!isRecord(acceptanceRelease)) problems.push("acceptance release checksum summary is missing");
    if (normalizeArtifactPath(root, acceptanceRelease.jsonPath) !== latestRelease.relativePath) {
      problems.push("acceptance release checksum path does not point at the latest release evidence");
    }
    if (normalizeArtifactPath(root, acceptanceRelease.sha256Path) !== replaceExtension(latestRelease.relativePath, ".sha256")) {
      problems.push("acceptance release checksum SHA-256 path does not point at the latest release evidence");
    }
    if (normalizeArtifactPath(root, acceptanceRelease.markdownPath) !== replaceExtension(latestRelease.relativePath, ".md")) {
      problems.push("acceptance release checksum Markdown path does not point at the latest release evidence");
    }
    if (
      !isRecord(latestReleaseManifest) ||
      latestReleaseManifest.commandUploadEnabled !== false ||
      acceptanceRelease.overallSha256 !== latestReleaseManifest.overallSha256 ||
      Number(acceptanceRelease.fileCount) !== Number(latestReleaseManifest.fileCount) ||
      Number(acceptanceRelease.totalBytes) !== Number(latestReleaseManifest.totalBytes)
    ) {
      problems.push("acceptance release checksum summary does not match latest release evidence");
    }
  }

  const latestSafety = await latestJson(root, ".tmp/safety-evidence", (name) => name.startsWith("seekr-command-boundary-scan-"));
  const latestSafetyManifest = latestSafety ? await readJson(latestSafety.absolutePath) : undefined;
  const safetySummary = isRecord(latestSafetyManifest) && isRecord(latestSafetyManifest.summary) ? latestSafetyManifest.summary : {};
  const acceptanceScan = isRecord(status.commandBoundaryScan) ? status.commandBoundaryScan : {};
  if (!latestSafety) {
    problems.push("latest command-boundary scan evidence is missing");
  } else {
    if (!isRecord(acceptanceScan)) problems.push("acceptance command-boundary scan summary is missing");
    if (normalizeArtifactPath(root, acceptanceScan.jsonPath) !== latestSafety.relativePath) {
      problems.push("acceptance command-boundary scan path does not point at the latest safety evidence");
    }
    if (normalizeArtifactPath(root, acceptanceScan.markdownPath) !== replaceExtension(latestSafety.relativePath, ".md")) {
      problems.push("acceptance command-boundary scan Markdown path does not point at the latest safety evidence");
    }
    if (
      !isRecord(latestSafetyManifest) ||
      latestSafetyManifest.status !== "pass" ||
      latestSafetyManifest.commandUploadEnabled !== false ||
      acceptanceScan.status !== "pass" ||
      acceptanceScan.commandUploadEnabled !== false ||
      Number(acceptanceScan.violationCount) !== 0 ||
      Number(safetySummary.violationCount) !== 0 ||
      Number(acceptanceScan.scannedFileCount) !== Number(safetySummary.scannedFileCount) ||
      Number(acceptanceScan.allowedFindingCount) !== Number(safetySummary.allowedFindingCount)
    ) {
      problems.push("acceptance command-boundary scan summary does not match latest safety evidence");
    }
  }

  const generatedAtMs = typeof status.generatedAt === "number" ? status.generatedAt : undefined;
  const ageMs = generatedAtMs ? Date.parse(generatedAt) - generatedAtMs : undefined;
  const stale = typeof ageMs === "number" && ageMs > 12 * 60 * 60 * 1000;
  const evidence = [
    ".tmp/acceptance-status.json",
    latestRelease?.relativePath,
    latestSafety?.relativePath
  ].filter((value): value is string => typeof value === "string");
  return {
    id: "acceptance-status",
    label: "Recorded acceptance status",
    status: problems.length ? "fail" : stale ? "warn" : "pass",
    details: problems.length
      ? `Acceptance status is not tied to the latest local-alpha evidence: ${problems.join("; ")}.`
      : stale
        ? "Acceptance status exists, matches the latest release and command-boundary scan, and keeps command upload disabled, but it is older than 12 hours."
        : "Acceptance status is pass, matches the latest release and command-boundary scan, and keeps command upload disabled.",
    evidence
  };
}

async function apiProbeItem(root: string): Promise<CompletionAuditItem> {
  const latest = await latestJson(root, ".tmp/api-probe", (name) => name.startsWith("seekr-api-probe-"));
  if (!latest) {
    return {
      id: "api-probe-evidence",
      label: "Final API probe evidence",
      status: "fail",
      details: "No API probe evidence exists under .tmp/api-probe; run npm run probe:api after acceptance recording.",
      evidence: [".tmp/api-probe"]
    };
  }

  const manifest = await readJson(latest.absolutePath);
  const acceptance = await readJson(path.join(root, ".tmp", "acceptance-status.json"));
  const sessionAcceptance = isRecord(manifest) && isRecord(manifest.sessionAcceptance) ? manifest.sessionAcceptance : {};
  const checked = isRecord(manifest) && Array.isArray(manifest.checked) ? manifest.checked.map(String) : [];
  const problems: string[] = [];

  if (!isRecord(manifest) || manifest.ok !== true) problems.push("probe ok is not true");
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) problems.push("probe commandUploadEnabled is not false");
  if (!checked.includes("session-acceptance-evidence")) problems.push("probe did not check session-acceptance-evidence");
  if (!checked.includes("malformed-json")) problems.push("probe did not check malformed-json handling");
  if (sessionAcceptance.commandUploadEnabled !== false) problems.push("session acceptance commandUploadEnabled is not false");

  if (isRecord(acceptance) && acceptance.ok === true) {
    const acceptanceRelease = isRecord(acceptance.releaseChecksum) ? acceptance.releaseChecksum : {};
    const probeRelease = isRecord(sessionAcceptance.releaseChecksum) ? sessionAcceptance.releaseChecksum : {};
    const acceptanceScan = isRecord(acceptance.commandBoundaryScan) ? acceptance.commandBoundaryScan : {};
    const probeScan = isRecord(sessionAcceptance.commandBoundaryScan) ? sessionAcceptance.commandBoundaryScan : {};

    if (sessionAcceptance.status !== "pass") problems.push("probe did not read back passing acceptance status from /api/session");
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
    label: "Final API probe evidence",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : `Latest API probe evidence passed and read back session-visible acceptance evidence: ${latest.relativePath}.`,
    evidence: [latest.relativePath]
  };
}

async function latestReleaseItem(root: string): Promise<CompletionAuditItem> {
  const latest = await latestJson(root, ".tmp/release-evidence", (name) => name.startsWith("seekr-release-"));
  if (!latest) {
    return {
      id: "release-evidence",
      label: "Release checksum evidence",
      status: "fail",
      details: "No release checksum JSON evidence exists under .tmp/release-evidence.",
      evidence: [".tmp/release-evidence"]
    };
  }
  const manifest = await readJson(latest.absolutePath);
  const ok = isRecord(manifest) && manifest.commandUploadEnabled === false && typeof manifest.overallSha256 === "string";
  return {
    id: "release-evidence",
    label: "Release checksum evidence",
    status: ok ? "pass" : "fail",
    details: ok ? `Latest release checksum evidence is ${latest.relativePath}.` : "Latest release evidence must include commandUploadEnabled false and an overall SHA-256.",
    evidence: [latest.relativePath]
  };
}

async function latestRehearsalItem(root: string): Promise<CompletionAuditItem> {
  const latest = await latestJson(root, ".tmp/rehearsal-evidence", (name) => name.startsWith("seekr-rehearsal-evidence-"));
  if (!latest) {
    return {
      id: "rehearsal-evidence",
      label: "Local rehearsal evidence snapshot",
      status: "warn",
      details: "No rehearsal evidence snapshot exists yet; run npm run rehearsal:evidence against a live local API before field-laptop notes.",
      evidence: [".tmp/rehearsal-evidence"]
    };
  }
  const manifest = await readJson(latest.absolutePath);
  const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
  const ok = isRecord(manifest) && manifest.commandUploadEnabled === false && validation.ok === true;
  return {
    id: "rehearsal-evidence",
    label: "Local rehearsal evidence snapshot",
    status: ok ? "pass" : "warn",
    details: ok ? `Latest rehearsal snapshot is ${latest.relativePath}.` : "Latest rehearsal snapshot exists but has warnings or failed validation.",
    evidence: [latest.relativePath]
  };
}

async function overnightItem(root: string, generatedAt: string): Promise<CompletionAuditItem> {
  const statusPath = path.join(root, ".tmp", "overnight", "STATUS.md");
  const content = await readText(statusPath);
  if (!content) {
    return {
      id: "overnight-status",
      label: "Overnight loop status",
      status: "warn",
      details: ".tmp/overnight/STATUS.md is missing.",
      evidence: [".tmp/overnight/STATUS.md"]
    };
  }
  const verdictPass = /Verdict:\s*pass/i.test(content);
  const update = content.match(/Last update:\s*([^\n]+)/)?.[1]?.trim();
  const ageMs = update ? Date.parse(generatedAt) - Date.parse(update) : undefined;
  const stale = typeof ageMs === "number" && ageMs > 48 * 60 * 60 * 1000;
  return {
    id: "overnight-status",
    label: "Overnight loop status",
    status: verdictPass ? stale ? "warn" : "pass" : "fail",
    details: verdictPass
      ? stale
        ? `Latest overnight verdict is pass, but last update ${update ?? "unknown"} is older than 48 hours.`
        : "Latest overnight verdict is pass."
      : "Latest overnight verdict is not pass.",
    evidence: [".tmp/overnight/STATUS.md"]
  };
}

async function hardwareArchiveItems(root: string): Promise<CompletionAuditItem[]> {
  const evidence = await actualHardwareEvidence(root);
  return [
    hardwareArchiveItemForTarget(evidence, {
      id: "actual-jetson-orin-nano-hardware-evidence",
      label: "Actual Jetson Orin Nano hardware readiness archive",
      targetId: "jetson-orin-nano",
      targetName: "Jetson Orin Nano"
    }),
    hardwareArchiveItemForTarget(evidence, {
      id: "actual-raspberry-pi-5-hardware-evidence",
      label: "Actual Raspberry Pi 5 hardware readiness archive",
      targetId: "raspberry-pi-5",
      targetName: "Raspberry Pi 5"
    })
  ];
}

function hardwareArchiveItemForTarget(
  evidence: Awaited<ReturnType<typeof actualHardwareEvidence>>,
  target: { id: string; label: string; targetId: string; targetName: string }
): CompletionAuditItem {
  const evidencePaths = evidence.evidence.length ? evidence.evidence.slice(-5) : [".tmp/hardware-evidence"];
  if (!evidence.archiveCount) {
    return {
      id: target.id,
      label: target.label,
      status: "blocked",
      details: `No hardware evidence archives exist; actual ${target.targetName} (${target.targetId}) probe remains unvalidated.`,
      evidence: evidencePaths
    };
  }

  const pass = evidence.targetPass.has(target.targetId);
  return {
    id: target.id,
    label: target.label,
    status: pass ? "pass" : "blocked",
    details: pass
      ? `Actual ${target.targetName} hardware readiness archive is present with host-platform pass.`
      : `Hardware archives exist, but no actual-target host-platform pass was found for: ${target.targetId}.`,
    evidence: evidencePaths
  };
}

async function adapterSafetyItem(root: string): Promise<CompletionAuditItem> {
  const adapterFiles = [
    "src/server/adapters/mavlinkAdapter.ts",
    "src/server/adapters/ros2SlamAdapter.ts"
  ];
  const evidence: string[] = [];
  const unsafe: string[] = [];
  for (const file of adapterFiles) {
    const absolutePath = path.join(root, file);
    const content = await readText(absolutePath);
    evidence.push(file);
    if (!content) {
      unsafe.push(`${file} missing`);
      continue;
    }
    if (!content.includes("commandRejected")) unsafe.push(`${file} does not call commandRejected`);
    if (/accepted:\s*true/.test(content)) unsafe.push(`${file} contains accepted: true`);
    if (!/read-only/i.test(content)) unsafe.push(`${file} does not document read-only behavior`);
  }

  return {
    id: "adapter-command-boundary",
    label: "Read-only adapter command boundary",
    status: unsafe.length ? "fail" : "pass",
    details: unsafe.length ? unsafe.join("; ") : "MAVLink and ROS 2 adapter command methods remain rejected and documented as read-only.",
    evidence
  };
}

async function commandBoundaryScanItem(root: string): Promise<CompletionAuditItem> {
  const latest = await latestJson(root, ".tmp/safety-evidence", (name) => name.startsWith("seekr-command-boundary-scan-"));
  if (!latest) {
    return {
      id: "command-boundary-scan",
      label: "Static command-boundary scan",
      status: "fail",
      details: "No command-boundary static scan evidence exists; run npm run safety:command-boundary.",
      evidence: [".tmp/safety-evidence"]
    };
  }

  const manifest = await readJson(latest.absolutePath);
  const summary = isRecord(manifest) && isRecord(manifest.summary) ? manifest.summary : {};
  const ok = isRecord(manifest) &&
    manifest.status === "pass" &&
    manifest.commandUploadEnabled === false &&
    Number(summary.violationCount) === 0;
  return {
    id: "command-boundary-scan",
    label: "Static command-boundary scan",
    status: ok ? "pass" : "fail",
    details: ok
      ? `Latest command-boundary static scan passed with ${Number(summary.scannedFileCount) || 0} scanned files: ${latest.relativePath}.`
      : "Latest command-boundary static scan must pass with zero violations and commandUploadEnabled false.",
    evidence: [latest.relativePath]
  };
}

async function freshOperatorRehearsalItem(root: string): Promise<CompletionAuditItem> {
  const notes = await allJson(root, ".tmp/rehearsal-notes", (name) => name.startsWith("seekr-rehearsal-closeout-"));
  const completed: string[] = [];
  const malformed: string[] = [];

  for (const note of notes) {
    const manifest = await readJson(note.absolutePath);
    const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
    if (
      isRecord(manifest) &&
      manifest.status === "completed" &&
      manifest.freshOperatorCompleted === true &&
      manifest.commandUploadEnabled === false &&
      validation.ok === true &&
      isRecord(manifest.operatorFields) &&
      hasRequiredCloseoutFields(manifest.operatorFields)
    ) {
      completed.push(note.relativePath);
    } else {
      malformed.push(note.relativePath);
    }
  }

  if (completed.length) {
    return {
      id: "fresh-operator-rehearsal",
      label: "Fresh-operator field-laptop rehearsal",
      status: "pass",
      details: `Completed fresh-operator rehearsal closeout found: ${completed.at(-1)}.`,
      evidence: completed.slice(-3)
    };
  }

  return {
    id: "fresh-operator-rehearsal",
    label: "Fresh-operator field-laptop rehearsal",
    status: "blocked",
    details: malformed.length
      ? "Rehearsal note files exist, but no valid completed closeout with required fields and commandUploadEnabled false was found."
      : "No fresh-operator field-laptop rehearsal closeout with setup, acceptance, export, replay, and shutdown timestamps is present.",
    evidence: malformed.length ? malformed.slice(-3) : [".tmp/rehearsal-notes"]
  };
}

function hasRequiredCloseoutFields(fields: Record<string, unknown>) {
  return [
    "operatorName",
    "machineIdentifier",
    "setupStartedAt",
    "acceptanceCompletedAt",
    "missionExportCompletedAt",
    "replayId",
    "finalStateHash",
    "shutdownCompletedAt",
    "deviationsOrFailures"
  ].every((key) => typeof fields[key] === "string" && fields[key].trim().length > 0);
}

async function hilFailsafeEvidenceItem(root: string): Promise<CompletionAuditItem> {
  const manifests = await allJson(root, ".tmp/hil-evidence", (name) => name.startsWith("seekr-hil-failsafe-"));
  const completed: string[] = [];
  const malformed: string[] = [];

  for (const item of manifests) {
    const manifest = await readJson(item.absolutePath);
    const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
    const run = isRecord(manifest) && isRecord(manifest.run) ? manifest.run : {};
    const evidence = isRecord(manifest) && isRecord(manifest.evidence) ? manifest.evidence : {};
    if (
      isRecord(manifest) &&
      manifest.status === "completed" &&
      manifest.commandUploadEnabled === false &&
      validation.ok === true &&
      hasHilRunFields(run) &&
      await hilEvidenceReferencesAreValid(root, evidence, String(run.targetHardware ?? ""))
    ) {
      completed.push(item.relativePath);
    } else {
      malformed.push(item.relativePath);
    }
  }

  if (completed.length) {
    return {
      id: "hil-failsafe-logs",
      label: "HIL failsafe logs with manual override",
      status: "pass",
      details: `Completed HIL failsafe/manual override evidence found: ${completed.at(-1)}.`,
      evidence: completed.slice(-3)
    };
  }

  return {
    id: "hil-failsafe-logs",
    label: "HIL failsafe logs with manual override",
    status: "blocked",
    details: malformed.length
      ? "HIL failsafe evidence files exist, but no valid completed artifact with manual override, E-stop, actual hardware, and commandUploadEnabled false was found."
      : "No HIL failsafe run with manual override evidence has been archived.",
    evidence: malformed.length ? malformed.slice(-3) : [".tmp/hil-evidence"]
  };
}

function hasHilRunFields(run: Record<string, unknown>) {
  return [
    "operatorName",
    "targetHardware",
    "vehicleIdentifier",
    "autopilot",
    "failsafeKind",
    "failsafeTriggeredAt",
    "manualOverrideObservedAt",
    "estopVerifiedAt",
    "aircraftSafeAt",
    "manualOverrideResult",
    "onboardFailsafeResult",
    "deviationsOrFailures"
  ].every((key) => typeof run[key] === "string" && run[key].trim().length > 0);
}

async function hilEvidenceReferencesAreValid(root: string, evidence: Record<string, unknown>, targetHardware: string) {
  return await actualTargetHardwareEvidenceIsValid(root, evidence.hardwareEvidencePath, targetHardware) &&
    await rehearsalEvidenceIsValid(root, evidence.rehearsalEvidencePath, false) &&
    await nonEmptyEvidenceFileExists(root, evidence.flightLogPath);
}

async function isaacHilCaptureEvidenceItem(root: string): Promise<CompletionAuditItem> {
  const manifests = await allJson(root, ".tmp/isaac-evidence", (name) => name.startsWith("seekr-isaac-hil-capture-"));
  const completed: string[] = [];
  const malformed: string[] = [];

  for (const item of manifests) {
    const manifest = await readJson(item.absolutePath);
    const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
    const run = isRecord(manifest) && isRecord(manifest.run) ? manifest.run : {};
    const evidence = isRecord(manifest) && isRecord(manifest.evidence) ? manifest.evidence : {};
    if (
      isRecord(manifest) &&
      manifest.status === "completed" &&
      manifest.commandUploadEnabled === false &&
      validation.ok === true &&
      hasIsaacRunFields(run) &&
      String(run.targetHardware ?? "").toLowerCase().includes("jetson") &&
      await isaacEvidenceReferencesAreValid(root, evidence, String(run.targetHardware ?? ""))
    ) {
      completed.push(item.relativePath);
    } else {
      malformed.push(item.relativePath);
    }
  }

  if (completed.length) {
    return {
      id: "isaac-jetson-capture",
      label: "Isaac Sim HIL capture from Jetson bench",
      status: "pass",
      details: `Completed Isaac Sim to Jetson HIL capture evidence found: ${completed.at(-1)}.`,
      evidence: completed.slice(-3)
    };
  }

  return {
    id: "isaac-jetson-capture",
    label: "Isaac Sim HIL capture from Jetson bench",
    status: "blocked",
    details: malformed.length
      ? "Isaac HIL capture evidence files exist, but no valid completed artifact with actual Jetson hardware, Isaac source evidence, capture manifest, logs, and commandUploadEnabled false was found."
      : "No Isaac Sim HIL fixture output captured from a Jetson bench run has been archived.",
    evidence: malformed.length ? malformed.slice(-3) : [".tmp/isaac-evidence"]
  };
}

function hasIsaacRunFields(run: Record<string, unknown>) {
  return [
    "operatorName",
    "targetHardware",
    "isaacSimHost",
    "isaacSimVersion",
    "isaacRosVersion",
    "sensorSuite",
    "captureStartedAt",
    "captureEndedAt",
    "captureResult",
    "deviationsOrFailures"
  ].every((key) => typeof run[key] === "string" && run[key].trim().length > 0);
}

async function isaacEvidenceReferencesAreValid(root: string, evidence: Record<string, unknown>, targetHardware: string) {
  return await actualTargetHardwareEvidenceIsValid(root, evidence.hardwareEvidencePath, targetHardware) &&
    await rehearsalEvidenceIsValid(root, evidence.rehearsalEvidencePath, true) &&
    await isaacCaptureManifestIsValid(root, evidence.captureManifestPath) &&
    await nonEmptyEvidenceFileExists(root, evidence.captureLogPath);
}

async function actualTargetHardwareEvidenceIsValid(root: string, evidencePath: unknown, targetHardware: string) {
  const manifest = await readReferencedJson(root, evidencePath);
  if (
    !isRecord(manifest) ||
    manifest.commandUploadEnabled !== false ||
    manifest.actualHardwareValidationComplete !== true ||
    manifest.hardwareValidationScope !== "actual-target"
  ) return false;
  const targetValidated = isRecord(manifest.actualTargetHostValidated) ? manifest.actualTargetHostValidated : {};
  return targetHardware.length === 0 || targetValidated[targetHardware] === true;
}

async function rehearsalEvidenceIsValid(root: string, evidencePath: unknown, requireIsaacSource: boolean) {
  const manifest = await readReferencedJson(root, evidencePath);
  const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
  if (!isRecord(manifest) || manifest.commandUploadEnabled !== false || validation.ok !== true) return false;
  if (!requireIsaacSource) return true;

  const sourceEvidence = isRecord(manifest.sourceEvidence) ? manifest.sourceEvidence : {};
  const matched = Array.isArray(sourceEvidence.matched) ? sourceEvidence.matched.filter(isRecord) : [];
  return matched.some((source) => {
    const adapter = String(source.sourceAdapter ?? "").toLowerCase();
    const channels = Array.isArray(source.channels) ? source.channels.map((channel) => String(channel).toLowerCase()) : [];
    const eventCount = Number(source.eventCount);
    return Number.isFinite(eventCount) &&
      eventCount > 0 &&
      (adapter === "isaac-nvblox" || adapter === "isaac-sim-hil") &&
      channels.some((channel) => ["costmap", "perception", "spatial", "lidar", "map"].includes(channel));
  });
}

async function isaacCaptureManifestIsValid(root: string, evidencePath: unknown) {
  const manifest = await readReferencedJson(root, evidencePath);
  if (!isRecord(manifest) || manifest.commandUploadEnabled === true) return false;
  const sourceText = JSON.stringify([
    manifest.source,
    manifest.captureSource,
    manifest.pipeline,
    manifest.kind,
    manifest.adapter
  ]).toLowerCase();
  return sourceText.includes("isaac") && hasPositiveCaptureCount(manifest);
}

function hasPositiveCaptureCount(manifest: Record<string, unknown>) {
  const candidates = [
    manifest.frameCount,
    manifest.recordCount,
    manifest.capturedFrameCount,
    manifest.capturedRecordCount
  ];
  if (isRecord(manifest.counts)) candidates.push(...Object.values(manifest.counts));
  return candidates.some((value) => Number(value) > 0);
}

async function readReferencedJson(root: string, evidencePath: unknown) {
  const relative = normalizeArtifactPath(root, evidencePath);
  if (!relative) return undefined;
  return await readJson(path.join(root, relative));
}

async function nonEmptyEvidenceFileExists(root: string, evidencePath: unknown) {
  const relative = normalizeArtifactPath(root, evidencePath);
  if (!relative) return false;
  try {
    const info = await stat(path.join(root, relative));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function hardwareActuationPolicyReviewItem(root: string): Promise<CompletionAuditItem> {
  const manifests = await allJson(root, ".tmp/policy-evidence", (name) => name.startsWith("seekr-hardware-actuation-gate-"));
  const completed: string[] = [];
  const malformed: string[] = [];

  for (const item of manifests) {
    const manifest = await readJson(item.absolutePath);
    const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
    const authorization = isRecord(manifest) && isRecord(manifest.authorization) ? manifest.authorization : {};
    const scope = isRecord(manifest) && isRecord(manifest.scope) ? manifest.scope : {};
    const evidence = isRecord(manifest) && isRecord(manifest.evidence) ? manifest.evidence : {};
    if (
      isRecord(manifest) &&
      manifest.status === "ready-for-human-review" &&
      manifest.commandUploadEnabled === false &&
      validation.ok === true &&
      authorization.realAircraftCommandUpload === false &&
      authorization.hardwareActuationEnabled === false &&
      authorization.runtimePolicyInstalled === false &&
      hasPolicyReviewScopeFields(scope) &&
      hasPolicyReviewEvidenceFields(evidence) &&
      await policyReviewReferencesAreValid(root, evidence, scope)
    ) {
      completed.push(item.relativePath);
    } else {
      malformed.push(item.relativePath);
    }
  }

  if (completed.length) {
    return {
      id: "hardware-actuation-policy-review",
      label: "Fail-closed hardware-actuation policy review package",
      status: "pass",
      details: `Hardware-actuation review package is ready for human review without enabling runtime command authority: ${completed.at(-1)}.`,
      evidence: completed.slice(-3)
    };
  }

  return {
    id: "hardware-actuation-policy-review",
    label: "Fail-closed hardware-actuation policy review package",
    status: "blocked",
    details: malformed.length
      ? "Hardware-actuation policy gate evidence exists, but no valid ready-for-human-review artifact with false authorization fields was found."
      : "No hardware-actuation policy review package has passed the fail-closed gate.",
    evidence: malformed.length ? malformed.slice(-3) : [".tmp/policy-evidence"]
  };
}

function hasPolicyReviewScopeFields(scope: Record<string, unknown>) {
  const reviewers = Array.isArray(scope.reviewers) ? scope.reviewers : [];
  return [
    "operatorName",
    "targetHardware",
    "vehicleIdentifier",
    "reviewedAt"
  ].every((key) => typeof scope[key] === "string" && scope[key].trim().length > 0) &&
    reviewers.filter((reviewer) => typeof reviewer === "string" && reviewer.trim().length > 0).length >= 2;
}

function hasPolicyReviewEvidenceFields(evidence: Record<string, unknown>) {
  return [
    "candidatePolicyPath",
    "acceptanceStatusPath",
    "hardwareEvidencePath",
    "hilEvidencePath"
  ].every((key) => typeof evidence[key] === "string" && evidence[key].trim().length > 0);
}

async function policyReviewReferencesAreValid(root: string, evidence: Record<string, unknown>, scope: Record<string, unknown>) {
  const targetHardware = String(scope.targetHardware ?? "");
  const vehicleIdentifier = String(scope.vehicleIdentifier ?? "");
  return await candidatePolicyIsFailClosed(root, evidence.candidatePolicyPath, targetHardware, vehicleIdentifier) &&
    await acceptanceEvidenceIsValid(root, evidence.acceptanceStatusPath) &&
    await actualTargetHardwareEvidenceIsValid(root, evidence.hardwareEvidencePath, targetHardware) &&
    await completedHilEvidenceIsValid(root, evidence.hilEvidencePath, targetHardware, vehicleIdentifier) &&
    (typeof evidence.reviewPacketPath !== "string" || evidence.reviewPacketPath.trim().length === 0 || await nonEmptyEvidenceFileExists(root, evidence.reviewPacketPath));
}

async function candidatePolicyIsFailClosed(root: string, evidencePath: unknown, targetHardware: string, vehicleIdentifier: string) {
  const policy = await readReferencedJson(root, evidencePath);
  if (!isRecord(policy)) return false;
  const blockedArrays = [
    "approvedCommandClasses",
    "authorizedCommandClasses",
    "allowedHardwareCommands",
    "enabledHardwareCommands",
    "missionUploadCommandClasses"
  ];
  return policy.commandUploadEnabled === false &&
    policy.realAircraftCommandUploadAuthorized !== true &&
    policy.hardwareActuationEnabled !== true &&
    policy.runtimeInstallApproved !== true &&
    policy.manualOverrideRequired === true &&
    policy.estopRequired === true &&
    (typeof policy.targetHardware !== "string" || policy.targetHardware === targetHardware) &&
    (typeof policy.vehicleIdentifier !== "string" || policy.vehicleIdentifier === vehicleIdentifier) &&
    blockedArrays.every((field) => !Array.isArray(policy[field]) || policy[field].length === 0);
}

async function acceptanceEvidenceIsValid(root: string, evidencePath: unknown) {
  const manifest = await readReferencedJson(root, evidencePath);
  return isRecord(manifest) && manifest.ok === true && manifest.commandUploadEnabled === false;
}

async function completedHilEvidenceIsValid(root: string, evidencePath: unknown, targetHardware: string, vehicleIdentifier: string) {
  const manifest = await readReferencedJson(root, evidencePath);
  const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : {};
  const run = isRecord(manifest) && isRecord(manifest.run) ? manifest.run : {};
  const evidence = isRecord(manifest) && isRecord(manifest.evidence) ? manifest.evidence : {};
  return isRecord(manifest) &&
    manifest.status === "completed" &&
    manifest.commandUploadEnabled === false &&
    validation.ok === true &&
    hasHilRunFields(run) &&
    run.targetHardware === targetHardware &&
    run.vehicleIdentifier === vehicleIdentifier &&
    await hilEvidenceReferencesAreValid(root, evidence, targetHardware);
}

interface RequiredSourceGroup {
  label: string;
  adapters: string[];
  channels: string[];
}

interface RequiredBridgeEvidence {
  label: string;
  variants: RequiredBridgeEvidenceVariant[];
}

interface RequiredBridgeEvidenceVariant {
  modes: string[];
  safetyFalse: string[];
  label: string;
  listenerProtocol?: "udp";
}

async function realBridgeEvidenceItem(root: string, options: {
  id: string;
  label: string;
  blockedDetails: string;
  passDetails: string;
  bridge: RequiredBridgeEvidence;
  groups: RequiredSourceGroup[];
}): Promise<CompletionAuditItem> {
  const hardware = await actualHardwareEvidence(root);
  const missingTargets = ["jetson-orin-nano", "raspberry-pi-5"].filter((target) => !hardware.targetPass.has(target));
  const sourceEvidence = await requiredSourceEvidence(root, options.groups);
  const bridgeEvidence = await requiredBridgeEvidence(root, options.bridge);
  const evidence = [...new Set([...hardware.evidence.slice(-3), ...bridgeEvidence.evidence.slice(-3), ...sourceEvidence.evidence.slice(-3)])];

  if (missingTargets.length) {
    return {
      id: options.id,
      label: options.label,
      status: "blocked",
      details: `${options.blockedDetails} Actual target-board evidence is missing for: ${missingTargets.join(", ")}.`,
      evidence: evidence.length ? evidence : ["docs/goal.md", "docs/SEEKR_GCS_ALPHA_TODO.md"]
    };
  }

  if (!sourceEvidence.ok) {
    return {
      id: options.id,
      label: options.label,
      status: "blocked",
      details: `${options.blockedDetails} Missing required source evidence: ${sourceEvidence.missing.join(", ")}.`,
      evidence: evidence.length ? evidence : [".tmp/rehearsal-evidence"]
    };
  }

  if (!bridgeEvidence.ok) {
    return {
      id: options.id,
      label: options.label,
      status: "blocked",
      details: `${options.blockedDetails} Missing bridge-run evidence: ${bridgeEvidence.missing.join(", ")}.`,
      evidence: evidence.length ? evidence : [".tmp/bridge-evidence"]
    };
  }

  return {
    id: options.id,
    label: options.label,
    status: "pass",
    details: options.passDetails,
    evidence
  };
}

async function requiredBridgeEvidence(root: string, requirement: RequiredBridgeEvidence) {
  const artifacts = await allJson(root, ".tmp/bridge-evidence", (name) => name.startsWith("seekr-bridge-evidence-"));
  const evidence: string[] = [];
  const modes = requirement.variants.flatMap((variant) => variant.modes).map((mode) => mode.toLowerCase());

  for (const artifact of artifacts) {
    const manifest = await readJson(artifact.absolutePath);
    if (!isRecord(manifest)) continue;
    const bridgeResult = isRecord(manifest.bridgeResult) ? manifest.bridgeResult : {};
    const mode = String(manifest.bridgeMode ?? bridgeResult.mode ?? "").toLowerCase();
    if (!modes.includes(mode)) continue;
    evidence.push(artifact.relativePath);
    if (requirement.variants.some((variant) => bridgeEvidenceSatisfies(manifest, bridgeResult, variant))) {
      return { ok: true, evidence: [artifact.relativePath], missing: [] };
    }
  }

  return {
    ok: false,
    evidence,
    missing: [
      evidence.length
        ? `valid ${requirement.label} artifact with live posted records and required false safety flags`
        : `${requirement.label} artifact under .tmp/bridge-evidence`
    ]
  };
}

function bridgeEvidenceSatisfies(
  manifest: Record<string, unknown>,
  bridgeResult: Record<string, unknown>,
  requirement: RequiredBridgeEvidenceVariant
) {
  const mode = String(manifest.bridgeMode ?? bridgeResult.mode ?? "").toLowerCase();
  const safety = isRecord(bridgeResult.safety) ? bridgeResult.safety : {};
  if (!requirement.modes.map((value) => value.toLowerCase()).includes(mode)) return false;
  if (manifest.status !== "pass" || manifest.commandUploadEnabled !== false) return false;
  const validation = isRecord(manifest.validation) ? manifest.validation : {};
  if (validation.ok !== true) return false;
  if (bridgeResult.ok !== true) return false;
  if (bridgeResult.commandEndpointsTouched !== false) return false;
  if (bridgeResult.commandPreview === true || bridgeResult.dryRun === true) return false;
  if (safety.commandUploadEnabled !== false) return false;
  if (Number(bridgeResult.acceptedCount) <= 0 || Number(bridgeResult.postedCount) <= 0) return false;
  if (requirement.listenerProtocol) {
    const listener = isRecord(bridgeResult.listener) ? bridgeResult.listener : {};
    if (listener.protocol !== requirement.listenerProtocol) return false;
    if (Number(listener.packetCount) <= 0) return false;
  }
  return requirement.safetyFalse.every((key) => safety[key] === false);
}

async function actualHardwareEvidence(root: string): Promise<{
  archiveCount: number;
  targetPass: Map<string, string>;
  evidence: string[];
}> {
  const archives = await allJson(root, ".tmp/hardware-evidence", (name) => name.startsWith("seekr-hardware-evidence-"));
  const targetPass = new Map<string, string>();
  const evidence: string[] = [];

  for (const archive of archives) {
    const manifest = await readJson(archive.absolutePath);
    if (
      !isRecord(manifest) ||
      manifest.commandUploadEnabled !== false ||
      manifest.actualHardwareValidationComplete !== true ||
      manifest.hardwareValidationScope !== "actual-target" ||
      !Array.isArray(manifest.reports)
    ) continue;
    evidence.push(archive.relativePath);
    for (const report of manifest.reports) {
      if (!isRecord(report) || !isRecord(report.target) || !Array.isArray(report.checks)) continue;
      const hostPlatform = report.checks.find((check) => isRecord(check) && check.id === "host-platform");
      if (isRecord(hostPlatform) && hostPlatform.status === "pass") {
        targetPass.set(String(report.target.id), archive.relativePath);
      }
    }
  }

  return { archiveCount: archives.length, targetPass, evidence };
}

async function requiredSourceEvidence(root: string, groups: RequiredSourceGroup[]) {
  const snapshots = await allJson(root, ".tmp/rehearsal-evidence", (name) => name.startsWith("seekr-rehearsal-evidence-"));
  const evidence: string[] = [];
  let bestMissing = groups.map((group) => group.label);

  for (const snapshot of snapshots) {
    const manifest = await readJson(snapshot.absolutePath);
    if (!isRecord(manifest) || manifest.commandUploadEnabled !== false) continue;
    const validation = isRecord(manifest.validation) ? manifest.validation : {};
    const sourceEvidence = isRecord(manifest.sourceEvidence) ? manifest.sourceEvidence : {};
    const matched = Array.isArray(sourceEvidence.matched) ? sourceEvidence.matched.filter(isRecord) : [];
    if (validation.ok !== true || !matched.length) continue;
    evidence.push(snapshot.relativePath);
    const missing = groups.filter((group) => !matched.some((source) => matchedSourceSatisfies(source, group))).map((group) => group.label);
    if (missing.length < bestMissing.length) bestMissing = missing;
    if (!missing.length) return { ok: true, evidence: [snapshot.relativePath], missing: [] };
  }

  return { ok: false, evidence, missing: bestMissing };
}

function matchedSourceSatisfies(source: Record<string, unknown>, group: RequiredSourceGroup) {
  const sourceAdapter = String(source.sourceAdapter ?? "").toLowerCase();
  const sourceChannels = Array.isArray(source.channels) ? source.channels.map((channel) => String(channel).toLowerCase()) : [];
  const eventCount = Number(source.eventCount);
  if (!Number.isFinite(eventCount) || eventCount <= 0) return false;
  if (!group.adapters.some((adapter) => adapter.toLowerCase() === sourceAdapter)) return false;
  return group.channels.some((channel) => sourceChannels.includes(channel.toLowerCase()));
}

async function latestJson(root: string, directory: string, predicate: (name: string) => boolean) {
  const values = await allJson(root, directory, predicate);
  return values.at(-1);
}

async function allJson(root: string, directory: string, predicate: (name: string) => boolean) {
  const absoluteDir = path.join(root, directory);
  try {
    const names = (await readdir(absoluteDir)).filter((name) => name.endsWith(".json") && predicate(name)).sort();
    return names.map((name) => ({
      absolutePath: path.join(absoluteDir, name),
      relativePath: path.posix.join(directory.split(path.sep).join("/"), name)
    }));
  } catch {
    return [];
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderMarkdown(manifest: CompletionAuditManifest) {
  const rows = manifest.items.map((item) =>
    `| ${item.label} | ${item.status} | ${escapeTable(item.details)} |`
  );
  return `${[
    "# SEEKR Completion Audit",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `Local alpha OK: ${manifest.localAlphaOk}`,
    `Complete: ${manifest.complete}`,
    "",
    "Command upload enabled: false",
    "",
    "This audit distinguishes local fixture/SITL evidence from real hardware validation. A blocked real-world item must not be treated as complete based on local fixtures.",
    "",
    `Summary: ${manifest.summary.pass} pass, ${manifest.summary.warn} warn, ${manifest.summary.fail} fail, ${manifest.summary.blocked} blocked`,
    "",
    "| Item | Status | Details |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "Real-world blocker IDs:",
    "",
    ...(manifest.realWorldBlockerIds.length ? manifest.realWorldBlockerIds.map((id) => `- ${id}`) : ["- None"]),
    "",
    "Real-world blockers:",
    "",
    ...(manifest.realWorldBlockers.length ? manifest.realWorldBlockers.map((blocker) => `- ${blocker}`) : ["- None"]),
    ""
  ].join("\n")}\n`;
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
  const result = await writeCompletionAudit({
    root: typeof args.root === "string" ? args.root : undefined,
    outDir: typeof args.out === "string" ? args.out : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.localAlphaOk,
    complete: result.manifest.complete,
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    summary: result.manifest.summary,
    realWorldBlockerIds: result.manifest.realWorldBlockerIds,
    realWorldBlockerCount: result.manifest.realWorldBlockers.length,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.localAlphaOk) process.exitCode = 1;
  if (args["strict-complete"] === true && !result.manifest.complete) process.exitCode = 2;
}
