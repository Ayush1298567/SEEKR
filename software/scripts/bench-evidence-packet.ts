import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";
import { buildDemoReadinessPackage, type DemoNextEvidenceItem, type DemoReadinessPackageManifest } from "./demo-readiness-package";

export interface BenchEvidencePacketManifest {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  status: "ready-for-bench-prep" | "blocked-local-alpha";
  localAlphaOk: boolean;
  complete: boolean;
  commandUploadEnabled: false;
  sourceDemoReadinessPackagePath?: string;
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
  tasks: BenchEvidenceTask[];
  limitations: string[];
}

export interface BenchEvidenceTask {
  id: string;
  label: string;
  phase: number;
  requiredEvidence: string;
  nextCommand: string;
  runbook: string;
  hardwareRequired: boolean;
  safetyBoundary: string;
  currentDetails: string;
  existingEvidence: string[];
  preconditions: string[];
  doneCriteria: string[];
}

const DEFAULT_OUT_DIR = ".tmp/bench-evidence-packet";
const DEFAULT_SAFETY_BOUNDARY = "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation.";

export async function buildBenchEvidencePacket(options: {
  root?: string;
  generatedAt?: string;
  label?: string;
  demoReadinessPath?: string;
} = {}): Promise<BenchEvidencePacketManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label ?? "bench-evidence";
  const warnings: string[] = [];
  const blockers: string[] = [];
  const source = await loadDemoReadiness(root, generatedAt, options.demoReadinessPath);
  const demo = source.manifest;

  if (!source.path) warnings.push("No persisted demo readiness package was found; packet was built from current evidence in memory.");
  if (!source.commandUploadDisabled) blockers.push("Demo readiness package must keep commandUploadEnabled false.");
  if (demo.localAlphaOk !== true || demo.validation.ok !== true) blockers.push("Demo readiness package must be ready for local alpha before bench evidence prep.");
  if (!source.hardwareClaimsFalse) blockers.push("Demo readiness package must keep all hardware claims false before real bench evidence exists.");
  if (demo.complete !== true && demo.nextEvidenceChecklist.length === 0) {
    blockers.push("Demo readiness package is incomplete but has no next-evidence checklist.");
  }

  const tasks = demo.nextEvidenceChecklist.map(toTask).sort((left, right) => left.phase - right.phase || left.label.localeCompare(right.label));
  const validationOk = blockers.length === 0;

  return {
    schemaVersion: 1,
    generatedAt,
    label,
    status: validationOk ? "ready-for-bench-prep" : "blocked-local-alpha",
    localAlphaOk: demo.localAlphaOk,
    complete: demo.complete,
    commandUploadEnabled: false,
    sourceDemoReadinessPackagePath: source.path,
    validation: {
      ok: validationOk,
      warnings,
      blockers
    },
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    tasks,
    limitations: [
      validationOk
        ? "This packet is an operator-facing plan for collecting missing real-world evidence."
        : "This packet is blocked because local-alpha handoff evidence is incomplete or inconsistent.",
      "It does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim to Jetson capture, or hardware actuation by itself.",
      "Real MAVLink, ROS 2, PX4, ArduPilot, mission, geofence, mode, arm, takeoff, land, RTH, terminate, and waypoint command paths remain blocked outside simulator/SITL transports."
    ]
  };
}

export async function writeBenchEvidencePacket(options: Parameters<typeof buildBenchEvidencePacket>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildBenchEvidencePacket(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const safeLabel = safeFileNamePart(manifest.label, "bench-evidence");
  const baseName = `seekr-bench-evidence-packet-${safeLabel}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function loadDemoReadiness(root: string, generatedAt: string, demoReadinessPath?: string) {
  if (demoReadinessPath) {
    const raw = await readJson(path.join(root, demoReadinessPath));
    return {
      path: demoReadinessPath,
      manifest: normalizeDemoReadiness(raw),
      commandUploadDisabled: demoCommandUploadDisabled(raw),
      hardwareClaimsFalse: demoHardwareClaimsFalse(raw)
    };
  }

  const latest = await latestJson(root, ".tmp/demo-readiness", (name) => name.startsWith("seekr-demo-readiness-"));
  if (latest) {
    const raw = await readJson(latest.absolutePath);
    return {
      path: latest.relativePath,
      manifest: normalizeDemoReadiness(raw),
      commandUploadDisabled: demoCommandUploadDisabled(raw),
      hardwareClaimsFalse: demoHardwareClaimsFalse(raw)
    };
  }

  const manifest = await buildDemoReadinessPackage({ root, generatedAt });
  return {
    path: undefined,
    manifest,
    commandUploadDisabled: manifest.commandUploadEnabled === false,
    hardwareClaimsFalse: Object.values(manifest.hardwareClaims).every((value) => value === false)
  };
}

function normalizeDemoReadiness(value: unknown): DemoReadinessPackageManifest {
  const record = isRecord(value) ? value : {};
  return {
    schemaVersion: 1,
    generatedAt: String(record.generatedAt ?? ""),
    label: String(record.label ?? "internal-alpha"),
    status: record.status === "ready-local-alpha" ? "ready-local-alpha" : "blocked-local-alpha",
    localAlphaOk: record.localAlphaOk === true,
    complete: record.complete === true,
    commandUploadEnabled: false,
    artifacts: isRecord(record.artifacts) ? record.artifacts as DemoReadinessPackageManifest["artifacts"] : {
      acceptanceStatusPath: "",
      releaseEvidenceJsonPath: "",
      completionAuditJsonPath: ""
    },
    overnightStatus: isRecord(record.overnightStatus) ? record.overnightStatus as DemoReadinessPackageManifest["overnightStatus"] : undefined,
    releaseChecksum: isRecord(record.releaseChecksum) ? record.releaseChecksum as DemoReadinessPackageManifest["releaseChecksum"] : undefined,
    validation: isRecord(record.validation) ? {
      ok: record.validation.ok === true,
      warnings: Array.isArray(record.validation.warnings) ? record.validation.warnings.map(String) : [],
      blockers: Array.isArray(record.validation.blockers) ? record.validation.blockers.map(String) : []
    } : { ok: false, warnings: [], blockers: ["Demo readiness package is missing validation metadata."] },
    perspectiveReview: Array.isArray(record.perspectiveReview)
      ? record.perspectiveReview.filter(isRecord) as unknown as DemoReadinessPackageManifest["perspectiveReview"]
      : [],
    realWorldBlockers: Array.isArray(record.realWorldBlockers) ? record.realWorldBlockers.map(String) : [],
    nextEvidenceChecklist: normalizeChecklistItems(record.nextEvidenceChecklist),
    hardwareClaims: isRecord(record.hardwareClaims) ? {
      jetsonOrinNanoValidated: false,
      raspberryPi5Validated: false,
      realMavlinkBenchValidated: false,
      realRos2BenchValidated: false,
      hilFailsafeValidated: false,
      isaacJetsonCaptureValidated: false,
      hardwareActuationAuthorized: false
    } : {
      jetsonOrinNanoValidated: false,
      raspberryPi5Validated: false,
      realMavlinkBenchValidated: false,
      realRos2BenchValidated: false,
      hilFailsafeValidated: false,
      isaacJetsonCaptureValidated: false,
      hardwareActuationAuthorized: false
    },
    limitations: Array.isArray(record.limitations) ? record.limitations.map(String) : []
  };
}

function normalizeChecklistItems(value: unknown): DemoNextEvidenceItem[] {
  return Array.isArray(value) ? value.filter(isRecord).flatMap((item) => expandLegacyChecklistItem(normalizeChecklistItem(item))) : [];
}

function normalizeChecklistItem(item: Record<string, unknown>): DemoNextEvidenceItem {
  const id = String(item.id ?? "unknown-blocker");
  return {
    id: String(item.id ?? "unknown-blocker"),
    label: String(item.label ?? id),
    currentStatus: String(item.currentStatus ?? "blocked"),
    currentDetails: String(item.currentDetails ?? ""),
    evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : [],
    requiredEvidence: String(item.requiredEvidence ?? "Review completion audit for missing evidence."),
    nextCommand: String(item.nextCommand ?? "npm run audit:completion"),
    runbook: String(item.runbook ?? "docs/goal.md"),
    hardwareRequired: item.hardwareRequired === true,
    safetyBoundary: String(item.safetyBoundary ?? DEFAULT_SAFETY_BOUNDARY)
  };
}

function expandLegacyChecklistItem(item: DemoNextEvidenceItem): DemoNextEvidenceItem[] {
  if (item.id !== "actual-board-hardware-evidence") return [item];
  const details = item.currentDetails.toLowerCase();
  const ids = [
    details.includes("jetson") || !details.includes("raspberry") ? "actual-jetson-orin-nano-hardware-evidence" : undefined,
    details.includes("raspberry") || !details.includes("jetson") ? "actual-raspberry-pi-5-hardware-evidence" : undefined
  ].filter(isString);
  return ids.map((id) => ({
    ...item,
    id,
    label: checklistLabel(id),
    currentDetails: targetCurrentDetails(id, item.currentDetails),
    requiredEvidence: requiredEvidenceFor(id, item.requiredEvidence),
    nextCommand: nextCommandFor(id, item.nextCommand)
  }));
}

function checklistLabel(id: string) {
  const labels: Record<string, string> = {
    "actual-jetson-orin-nano-hardware-evidence": "Actual Jetson Orin Nano hardware readiness archive",
    "actual-raspberry-pi-5-hardware-evidence": "Actual Raspberry Pi 5 hardware readiness archive"
  };
  return labels[id] ?? id;
}

function targetCurrentDetails(id: string, details: string) {
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

function requiredEvidenceFor(id: string, fallback: string) {
  const requirements: Record<string, string> = {
    "actual-jetson-orin-nano-hardware-evidence": "Run a hardware readiness archive on the actual Jetson Orin Nano host and preserve actual-target evidence with command upload disabled.",
    "actual-raspberry-pi-5-hardware-evidence": "Run a hardware readiness archive on the actual Raspberry Pi 5 host and preserve actual-target evidence with command upload disabled."
  };
  return requirements[id] ?? fallback;
}

function nextCommandFor(id: string, fallback: string) {
  const commands: Record<string, string> = {
    "actual-jetson-orin-nano-hardware-evidence": "npm run probe:hardware:archive -- --target jetson-orin-nano",
    "actual-raspberry-pi-5-hardware-evidence": "npm run probe:hardware:archive -- --target raspberry-pi-5"
  };
  return commands[id] ?? fallback;
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

function toTask(item: DemoNextEvidenceItem): BenchEvidenceTask {
  return {
    id: item.id,
    label: item.label,
    phase: phaseFor(item.id),
    requiredEvidence: item.requiredEvidence,
    nextCommand: item.nextCommand,
    runbook: item.runbook,
    hardwareRequired: item.hardwareRequired,
    safetyBoundary: item.safetyBoundary || DEFAULT_SAFETY_BOUNDARY,
    currentDetails: item.currentDetails,
    existingEvidence: item.evidence,
    preconditions: preconditionsFor(item.id),
    doneCriteria: doneCriteriaFor(item.id)
  };
}

function phaseFor(id: string) {
  const phases: Record<string, number> = {
    "fresh-operator-rehearsal": 10,
    "actual-board-hardware-evidence": 20,
    "actual-jetson-orin-nano-hardware-evidence": 20,
    "actual-raspberry-pi-5-hardware-evidence": 21,
    "real-mavlink-bench": 30,
    "real-ros2-bench": 40,
    "hil-failsafe-logs": 50,
    "isaac-jetson-capture": 60,
    "hardware-actuation-policy-review": 70
  };
  return phases[id] ?? 90;
}

function preconditionsFor(id: string) {
  const preconditions: Record<string, string[]> = {
    "fresh-operator-rehearsal": [
      "Run local acceptance on the field laptop.",
      "Capture before-run and after-run rehearsal evidence snapshots.",
      "Export and replay the mission before shutdown."
    ],
    "actual-board-hardware-evidence": [
      "Run on the actual Jetson Orin Nano and Raspberry Pi 5 hosts.",
      "Keep the GCS hardware command boundary disabled.",
      "Preserve the generated hardware evidence JSON and Markdown files."
    ],
    "actual-jetson-orin-nano-hardware-evidence": [
      "Run on the actual Jetson Orin Nano host.",
      "Keep the GCS hardware command boundary disabled.",
      "Preserve the generated Jetson hardware evidence JSON and Markdown files."
    ],
    "actual-raspberry-pi-5-hardware-evidence": [
      "Run on the actual Raspberry Pi 5 host.",
      "Keep the GCS hardware command boundary disabled.",
      "Preserve the generated Raspberry Pi hardware evidence JSON and Markdown files."
    ],
    "real-mavlink-bench": [
      "Run `npm run bridge:mavlink:serial -- --command-preview --device <serial-device> --evidence-label mavlink-bench-preview` or the UDP preview equivalent before connecting hardware.",
      "Connect a read-only serial or UDP MAVLink telemetry source.",
      "Configure baud rate and serial permissions outside SEEKR; the SEEKR wrapper opens the device path read-only.",
      "Write serial or bounded UDP bridge-run evidence under `.tmp/bridge-evidence/` using `--evidence-label <run-label>`.",
      "Do not configure MAVLink command endpoints or mission upload.",
      "Declare the expected MAVLink source before capturing rehearsal evidence."
    ],
    "real-ros2-bench": [
      "Run `npm run bridge:ros2:live -- --command-preview --topic /drone/pose,/map,/detections,/lidar/points --evidence-label ros2-bench-preview` before starting live capture.",
      "Connect read-only ROS 2 topic echo, bag replay, or bridge outputs.",
      "Write bridge run evidence under `.tmp/bridge-evidence/` using `--evidence-label <run-label>`.",
      "Do not expose ROS services or actions to SEEKR.",
      "Declare expected pose, map/costmap, perception, and LiDAR/spatial sources."
    ],
    "hil-failsafe-logs": [
      "Actual target-board hardware evidence exists.",
      "Manual override and physical E-stop checks are ready.",
      "A non-empty flight log path is available for archival."
    ],
    "isaac-jetson-capture": [
      "Actual Jetson hardware evidence exists.",
      "Isaac source-health evidence has fresh events.",
      "Capture manifest and capture log files are available."
    ],
    "hardware-actuation-policy-review": [
      "Actual target-board evidence exists.",
      "Completed HIL failsafe/manual override evidence exists.",
      "Candidate policy keeps every authorization field false."
    ]
  };
  return preconditions[id] ?? ["Review the completion audit item before collecting evidence."];
}

function doneCriteriaFor(id: string) {
  const criteria: Record<string, string[]> = {
    "fresh-operator-rehearsal": [
      "A `seekr-rehearsal-closeout-*` artifact reports `freshOperatorCompleted: true`.",
      "The closeout includes setup, acceptance, export, replay, final hash, shutdown, and deviations fields.",
      "The closeout reports `commandUploadEnabled: false`."
    ],
    "actual-board-hardware-evidence": [
      "Hardware archive reports `actualHardwareValidationComplete: true`.",
      "Both `jetson-orin-nano` and `raspberry-pi-5` host-platform checks pass.",
      "The archive reports `commandUploadEnabled: false`."
    ],
    "actual-jetson-orin-nano-hardware-evidence": [
      "Hardware archive includes `jetson-orin-nano` in `targetIds`.",
      "The archive reports `actualTargetHostValidated.jetson-orin-nano: true`.",
      "The archive reports `commandUploadEnabled: false`."
    ],
    "actual-raspberry-pi-5-hardware-evidence": [
      "Hardware archive includes `raspberry-pi-5` in `targetIds`.",
      "The archive reports `actualTargetHostValidated.raspberry-pi-5: true`.",
      "The archive reports `commandUploadEnabled: false`."
    ],
    "real-mavlink-bench": [
      "Required-source rehearsal evidence includes a fresh MAVLink telemetry source with eventCount > 0.",
      "A `.tmp/bridge-evidence/seekr-bridge-evidence-mavlink-serial-readonly-*` or `.tmp/bridge-evidence/seekr-bridge-evidence-mavlink-telemetry-*` artifact reports `status: pass`.",
      "The MAVLink bridge evidence says `commandEndpointsTouched: false`; serial runs also report `serialWriteOpened: false`, and UDP runs report a `listener.protocol` of `udp` with packets observed.",
      "Completion audit no longer blocks `real-mavlink-bench`."
    ],
    "real-ros2-bench": [
      "Required-source rehearsal evidence includes real ROS 2 pose, map/costmap, perception/detection, and LiDAR/spatial sources.",
      "A `.tmp/bridge-evidence/seekr-bridge-evidence-ros2-live-readonly-*` artifact reports `status: pass`.",
      "The live ROS 2 bridge evidence says `commandEndpointsTouched: false`, `ros2ServicesTouched: false`, and `ros2ActionsTouched: false`.",
      "Completion audit no longer blocks `real-ros2-bench`."
    ],
    "hil-failsafe-logs": [
      "HIL evidence reports `status: completed` and `validation.ok: true`.",
      "Manual override, E-stop, aircraft-safe, and onboard-failsafe results are filled.",
      "The artifact reports `commandUploadEnabled: false`."
    ],
    "isaac-jetson-capture": [
      "Isaac evidence reports `status: completed` and `validation.ok: true`.",
      "Capture manifest has positive counts and the capture log is non-empty.",
      "The artifact reports `commandUploadEnabled: false`."
    ],
    "hardware-actuation-policy-review": [
      "Policy gate reports `ready-for-human-review`.",
      "`realAircraftCommandUpload`, `hardwareActuationEnabled`, and `runtimePolicyInstalled` remain false.",
      "No runtime policy is installed and no command upload path is enabled."
    ]
  };
  return criteria[id] ?? ["Completion audit recognizes the item as pass."];
}

function renderMarkdown(manifest: BenchEvidencePacketManifest) {
  return `${[
    "# SEEKR Bench Evidence Packet",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Label: ${manifest.label}`,
    `Status: ${manifest.status}`,
    `Local alpha OK: ${manifest.localAlphaOk}`,
    `Complete: ${manifest.complete}`,
    "",
    "Command upload enabled: false",
    "",
    manifest.sourceDemoReadinessPackagePath ? `Source demo package: ${manifest.sourceDemoReadinessPackagePath}` : "Source demo package: generated from current evidence",
    "",
    "Safety boundary:",
    "",
    `- realAircraftCommandUpload: ${manifest.safetyBoundary.realAircraftCommandUpload}`,
    `- hardwareActuationEnabled: ${manifest.safetyBoundary.hardwareActuationEnabled}`,
    `- runtimePolicyInstalled: ${manifest.safetyBoundary.runtimePolicyInstalled}`,
    "",
    "Tasks:",
    "",
    ...(manifest.tasks.length ? manifest.tasks.flatMap((task) => renderTask(task)) : ["- None"]),
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
  ].join("\n")}\n`;
}

function renderTask(task: BenchEvidenceTask) {
  return [
    `## ${task.phase}. ${task.label}`,
    "",
    `- Required evidence: ${task.requiredEvidence}`,
    `- Next command: ${task.nextCommand}`,
    `- Runbook: ${task.runbook}`,
    `- Hardware required: ${task.hardwareRequired}`,
    `- Safety boundary: ${task.safetyBoundary}`,
    task.currentDetails ? `- Current audit detail: ${task.currentDetails}` : undefined,
    task.existingEvidence.length ? `- Existing evidence: ${task.existingEvidence.join(", ")}` : undefined,
    "",
    "Preconditions:",
    "",
    ...task.preconditions.map((item) => `- ${item}`),
    "",
    "Done criteria:",
    "",
    ...task.doneCriteria.map((item) => `- ${item}`)
  ].filter((line): line is string => typeof line === "string");
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

function demoCommandUploadDisabled(value: unknown) {
  return isRecord(value) && value.commandUploadEnabled === false;
}

function demoHardwareClaimsFalse(value: unknown) {
  if (!isRecord(value) || !isRecord(value.hardwareClaims)) return false;
  const claims = value.hardwareClaims;
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
  const result = await writeBenchEvidencePacket({
    outDir: typeof args.out === "string" ? args.out : undefined,
    label: typeof args.label === "string" ? args.label : undefined,
    demoReadinessPath: typeof args.demo === "string" ? args.demo : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    status: result.manifest.status,
    localAlphaOk: result.manifest.localAlphaOk,
    complete: result.manifest.complete,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    taskCount: result.manifest.tasks.length,
    validation: result.manifest.validation,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
