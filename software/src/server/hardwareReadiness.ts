import { accessSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { HardwareReadinessCheck, HardwareReadinessReport, HardwareTargetId, HardwareTargetProfile, MissionPlan } from "../shared/types";
import { MavlinkAdapter } from "./adapters/mavlinkAdapter";
import { Ros2SlamAdapter } from "./adapters/ros2SlamAdapter";
import { buildRuntimeConfig } from "./config";
import { readFixture } from "./fixtures";
import type { MissionPersistence } from "./persistence";
import type { MissionStore } from "./state";

const JETSON_EXPECTED_SOURCES_EXAMPLE = "mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception";
const PI_EXPECTED_SOURCES_EXAMPLE = "mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial";

export const HARDWARE_TARGET_PROFILES: HardwareTargetProfile[] = [
  {
    id: "jetson-orin-nano",
    label: "NVIDIA Jetson Orin Nano",
    role: "Onboard edge perception and ROS 2 bridge host",
    recommendedOs: "JetPack 6 / Ubuntu 22.04 family for Isaac ROS Humble workflows",
    rosDistro: "ROS 2 Humble for Isaac ROS; Jazzy only for non-Isaac bridges after validation",
    isaacSupport: "recommended",
    minimumMemoryGb: 7.5,
    recommendedFreeDiskGb: 24,
    notes: [
      "Use this for Isaac ROS, GPU perception, camera pipelines, and hardware-in-the-loop experiments.",
      "Keep SEEKR aircraft command upload disabled; publish telemetry/map/detection topics only.",
      "Jetson Orin Nano 4GB is not treated as an Isaac ROS target for SEEKR alpha testing."
    ]
  },
  {
    id: "raspberry-pi-5",
    label: "Raspberry Pi 5",
    role: "Lightweight read-only MAVLink/ROS 2 telemetry bridge",
    recommendedOs: "Ubuntu 24.04 LTS or Raspberry Pi OS for non-Isaac bridge testing",
    rosDistro: "ROS 2 Jazzy on Ubuntu 24.04 for aarch64 bridge tests",
    isaacSupport: "bridge-only",
    minimumMemoryGb: 7.5,
    recommendedFreeDiskGb: 16,
    notes: [
      "Use this for MAVLink telemetry, ROS 2 map/detection bridge tests, and source-health rehearsal.",
      "Do not plan Isaac ROS GPU workloads on Raspberry Pi 5; use Jetson or an x86 NVIDIA GPU host for that.",
      "Use active cooling and a stable 5V/5A power supply for sustained bench runs."
    ]
  }
];

export function hardwareTargetProfile(id: HardwareTargetId): HardwareTargetProfile {
  const profile = HARDWARE_TARGET_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Unknown hardware target ${id}`);
  return profile;
}

export function parseHardwareTarget(value: unknown): HardwareTargetId {
  const id = typeof value === "string" && value.length ? value : "jetson-orin-nano";
  if (id === "jetson-orin-nano" || id === "raspberry-pi-5") return id;
  throw new Error("target must be jetson-orin-nano or raspberry-pi-5");
}

export async function buildHardwareReadinessReport(
  targetId: HardwareTargetId,
  store: MissionStore,
  persistence: MissionPersistence,
  generatedAt = Date.now()
): Promise<HardwareReadinessReport> {
  const target = hardwareTargetProfile(targetId);
  const runtimeConfig = buildRuntimeConfig(store, persistence, generatedAt);
  const host = hostSnapshot();
  const checks: HardwareReadinessCheck[] = [
    hostPlatformCheck(target, host),
    nodeRuntimeCheck(host.nodeVersion),
    diskCheck(target, host.freeDiskGb),
    memoryCheck(target, host.totalMemoryGb),
    sourceConfigCheck(target, runtimeConfig.expectedSources.map((source) => `${source.sourceAdapter}:${source.channels.join("+")}`)),
    toolCheck("container-runtime", "Container runtime", ["docker", "podman"], "Install Docker or Podman before ROS/Isaac container rehearsals."),
    toolCheck("ros2-cli", "ROS 2 CLI", ["ros2"], `Install ${target.rosDistro} before bridge testing on this target.`),
    target.id === "jetson-orin-nano" ? jetsonToolCheck() : raspberryPiToolCheck(),
    isaacCheck(target),
    await fixtureCheck(),
    await safetyBoundaryCheck()
  ];

  const missingTools = checks
    .filter((item) => item.id.startsWith("tool-") && item.status !== "pass")
    .map((item) => item.label);
  const summary = {
    pass: checks.filter((item) => item.status === "pass").length,
    warn: checks.filter((item) => item.status === "warn").length,
    fail: checks.filter((item) => item.status === "fail").length,
    blocking: checks.filter((item) => item.blocking && item.status === "fail").length,
    commandUploadEnabled: false as const,
    expectedSourcesConfigured: runtimeConfig.expectedSources.length > 0,
    missingTools,
    recommendedNextCommand: target.id === "jetson-orin-nano"
      ? `SEEKR_EXPECTED_SOURCES="${JETSON_EXPECTED_SOURCES_EXAMPLE}" npm run probe:hardware -- --target jetson-orin-nano`
      : `SEEKR_EXPECTED_SOURCES="${PI_EXPECTED_SOURCES_EXAMPLE}" npm run probe:hardware -- --target raspberry-pi-5`
  };

  return {
    ok: summary.blocking === 0,
    generatedAt,
    target,
    host,
    checks,
    summary,
    safetyNotes: [
      "This report is read-only and must not append mission events.",
      "Passing this report does not make SEEKR flight software; it only proves the bench target can host read-only bridge tests.",
      "Real MAVLink/ROS 2 command upload, hold, return-home, and aircraft geofence upload remain blocked."
    ]
  };
}

function hostSnapshot(): HardwareReadinessReport["host"] {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cpuCount: os.cpus().length,
    totalMemoryGb: roundGb(os.totalmem()),
    freeDiskGb: freeDiskGb(process.cwd())
  };
}

function hostPlatformCheck(target: HardwareTargetProfile, host: HardwareReadinessReport["host"]): HardwareReadinessCheck {
  const expected = host.platform === "linux" && host.arch === "arm64";
  return check(
    "host-platform",
    "Host platform",
    expected ? "pass" : "warn",
    expected
      ? `Running on Linux arm64 for ${target.label}.`
      : `Current host is ${host.platform}/${host.arch}; run this probe on the actual ${target.label} for hardware proof.`,
    false,
    `Run npm run probe:hardware -- --target ${target.id} on the target board.`
  );
}

function nodeRuntimeCheck(nodeVersion: string): HardwareReadinessCheck {
  const major = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
  return check(
    "node-runtime",
    "Node runtime",
    major >= 20 ? "pass" : "fail",
    major >= 20 ? `${nodeVersion} satisfies SEEKR's Node.js 20+ runtime expectation.` : `${nodeVersion} is too old; install Node.js 20 or newer.`,
    true
  );
}

function memoryCheck(target: HardwareTargetProfile, totalMemoryGb: number): HardwareReadinessCheck {
  const ok = totalMemoryGb >= target.minimumMemoryGb;
  return check(
    "memory-budget",
    "Memory budget",
    ok ? "pass" : "warn",
    ok
      ? `${totalMemoryGb}GB total memory meets the ${target.minimumMemoryGb}GB alpha target for ${target.label}.`
      : `${totalMemoryGb}GB total memory is below the ${target.minimumMemoryGb}GB alpha target; reduce AI/spatial workloads or use a larger board.`,
    false,
    "Use an 8GB+ board for sustained GCS bridge and perception testing."
  );
}

function diskCheck(target: HardwareTargetProfile, freeDiskGb?: number): HardwareReadinessCheck {
  if (typeof freeDiskGb !== "number") {
    return check("disk-budget", "Disk budget", "warn", "Free disk space could not be measured on this host.", false);
  }
  const ok = freeDiskGb >= target.recommendedFreeDiskGb;
  return check(
    "disk-budget",
    "Disk budget",
    ok ? "pass" : "warn",
    ok
      ? `${freeDiskGb}GB free on the current volume.`
      : `${freeDiskGb}GB free is below the ${target.recommendedFreeDiskGb}GB target for logs, replays, and ROS/Isaac containers.`,
    false
  );
}

function sourceConfigCheck(target: HardwareTargetProfile, expectedSources: string[]): HardwareReadinessCheck {
  const hasMavlink = expectedSources.some((source) => source.startsWith("mavlink:"));
  const hasMap = expectedSources.some((source) => source.startsWith("ros2-slam:") || source.includes(":map"));
  const hasLidar = expectedSources.some((source) => source.includes(":lidar"));
  const hasCostmap = expectedSources.some((source) => source.includes(":costmap"));
  const hasPerception = expectedSources.some((source) => source.includes(":perception") || source.includes(":spatial"));
  const needsEdgePerception = target.id === "jetson-orin-nano";
  const ok = hasMavlink && hasMap && (!needsEdgePerception || (hasLidar && hasCostmap && hasPerception));
  const example = needsEdgePerception ? JETSON_EXPECTED_SOURCES_EXAMPLE : PI_EXPECTED_SOURCES_EXAMPLE;
  return check(
    "expected-sources",
    "Expected sources",
    ok ? "pass" : "warn",
    ok
      ? `Expected rehearsal sources are configured: ${expectedSources.join(", ")}.`
      : needsEdgePerception
        ? "Set SEEKR_EXPECTED_SOURCES to include MAVLink, ROS 2 map, LiDAR/SLAM, costmap, and perception sources before Jetson bench runs."
        : "Set SEEKR_EXPECTED_SOURCES so source health can warn before MAVLink/ROS 2 bridge data arrives.",
    false,
    `Example: SEEKR_EXPECTED_SOURCES="${example}"`
  );
}

function toolCheck(id: string, label: string, commands: string[], targetAction: string): HardwareReadinessCheck {
  const found = commands.find((command) => commandOnPath(command));
  return check(
    `tool-${id}`,
    label,
    found ? "pass" : "warn",
    found ? `${found} is available on PATH.` : `None found on PATH: ${commands.join(", ")}.`,
    false,
    targetAction
  );
}

function jetsonToolCheck(): HardwareReadinessCheck {
  const missing = ["tegrastats", "nvpmodel"].filter((command) => !commandOnPath(command));
  return check(
    "tool-jetson-power",
    "Jetson power telemetry",
    missing.length ? "warn" : "pass",
    missing.length
      ? `Missing Jetson board tools on PATH: ${missing.join(", ")}. This is expected off-board.`
      : "Jetson power/performance tools are available for bench telemetry.",
    false,
    "On Jetson, verify nvpmodel and tegrastats before sustained Isaac ROS tests."
  );
}

function raspberryPiToolCheck(): HardwareReadinessCheck {
  return check(
    "tool-pi-thermal",
    "Raspberry Pi thermal telemetry",
    commandOnPath("vcgencmd") ? "pass" : "warn",
    commandOnPath("vcgencmd")
      ? "vcgencmd is available for temperature/throttle checks."
      : "vcgencmd is not on PATH. This is expected off-board; install Raspberry Pi utilities on the Pi.",
    false,
    "On Raspberry Pi 5, verify vcgencmd get_throttled and measure_temp during bridge load."
  );
}

function isaacCheck(target: HardwareTargetProfile): HardwareReadinessCheck {
  if (target.isaacSupport === "bridge-only") {
    return check(
      "isaac-fit",
      "Isaac workload fit",
      "pass",
      `${target.label} is treated as a ROS/MAVLink bridge target, not an Isaac ROS GPU target.`,
      false
    );
  }
  const workspace = process.env.SEEKR_ISAAC_ROS_WS ?? process.env.ISAAC_ROS_WS;
  const hasWorkspace = Boolean(workspace && pathExists(workspace));
  return check(
    "isaac-fit",
    "Isaac workload fit",
    hasWorkspace ? "pass" : "warn",
    hasWorkspace
      ? `Isaac ROS workspace detected at ${workspace}.`
      : "Isaac ROS workspace is not declared. This is fine for GCS-only tests; declare SEEKR_ISAAC_ROS_WS on Jetson for Isaac ROS bench proof.",
    false,
    "Set SEEKR_ISAAC_ROS_WS to the Isaac ROS workspace path after installing Isaac ROS on Jetson."
  );
}

async function fixtureCheck(): Promise<HardwareReadinessCheck> {
  const fixtures: Array<{ kind: Parameters<typeof readFixture>[0]; name: string }> = [
    { kind: "mavlink", name: "heartbeat" },
    { kind: "mavlink", name: "battery-status" },
    { kind: "ros2-map", name: "occupancy-grid" },
    { kind: "ros2-map", name: "nvblox-costmap" },
    { kind: "detection", name: "evidence-linked-detection" },
    { kind: "spatial", name: "lidar-point-cloud" },
    { kind: "import", name: "rosbag-lite" },
    { kind: "import", name: "lidar-perception-bag-lite" },
    { kind: "import", name: "isaac-sim-hil-lite" }
  ];
  const missing: string[] = [];
  await Promise.all(fixtures.map(async (fixture) => {
    try {
      await readFixture(fixture.kind, fixture.name);
    } catch {
      missing.push(`${fixture.kind}/${fixture.name}`);
    }
  }));
  return check(
    "bench-fixtures",
    "Bench fixtures",
    missing.length ? "fail" : "pass",
    missing.length ? `Missing fixture files: ${missing.join(", ")}.` : `${fixtures.length} MAVLink, ROS 2, detection, spatial, LiDAR/costmap, Isaac HIL, and import fixtures are available for offline bench replay.`,
    true
  );
}

async function safetyBoundaryCheck(): Promise<HardwareReadinessCheck> {
  const plan: MissionPlan = {
    kind: "hold-drone",
    droneId: "hardware-probe",
    reason: "Hardware readiness safety-boundary probe"
  };
  const adapters = [new MavlinkAdapter(), new Ros2SlamAdapter()];
  const results = await Promise.all(adapters.flatMap((adapter) => [
    adapter.uploadMission(plan),
    adapter.hold("hardware-probe"),
    adapter.returnHome("hardware-probe")
  ]));
  const accepted = results.filter((result) => result.accepted);
  return check(
    "safety-boundary",
    "Safety boundary",
    accepted.length ? "fail" : "pass",
    accepted.length
      ? `${accepted.length} adapter command probe${accepted.length === 1 ? "" : "s"} unexpectedly accepted.`
      : "MAVLink/ROS 2 mission upload, hold, and return-home probes all reject real command authority.",
    true
  );
}

function commandOnPath(command: string) {
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  return paths.some((entry) => pathExists(path.join(entry, command)));
}

function pathExists(filePath: string) {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function freeDiskGb(cwd: string) {
  try {
    const output = execFileSync("df", ["-k", cwd], { encoding: "utf8" }).trim().split("\n").at(-1);
    const availableKb = Number(output?.trim().split(/\s+/)[3]);
    return Number.isFinite(availableKb) ? roundGb(availableKb * 1024) : undefined;
  } catch {
    return undefined;
  }
}

function roundGb(bytes: number) {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

function check(
  id: string,
  label: string,
  status: HardwareReadinessCheck["status"],
  details: string,
  blocking: boolean,
  targetAction?: string
): HardwareReadinessCheck {
  return { id, label, status, details, blocking, targetAction };
}
