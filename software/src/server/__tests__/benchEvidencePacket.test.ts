import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBenchEvidencePacket, writeBenchEvidencePacket } from "../../../scripts/bench-evidence-packet";

describe("bench evidence packet", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-bench-evidence-packet-test-${process.pid}-${Date.now()}`);
    await mkdir(path.join(root, ".tmp/demo-readiness"), { recursive: true });
    await seedDemoPackage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("turns demo next-evidence guidance into ordered bench task cards", async () => {
    const manifest = await buildBenchEvidencePacket({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z",
      label: "bench-alpha"
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      status: "ready-for-bench-prep",
      localAlphaOk: true,
      complete: false,
      commandUploadEnabled: false,
      safetyBoundary: {
        realAircraftCommandUpload: false,
        hardwareActuationEnabled: false,
        runtimePolicyInstalled: false
      }
    });
    expect(manifest.validation.blockers).toEqual([]);
    expect(manifest.tasks.map((task) => task.id)).toEqual([
      "fresh-operator-rehearsal",
      "actual-jetson-orin-nano-hardware-evidence",
      "actual-raspberry-pi-5-hardware-evidence",
      "real-mavlink-bench",
      "real-ros2-bench",
      "hardware-actuation-policy-review"
    ]);
    expect(manifest.tasks[0]).toMatchObject({
      phase: 10,
      hardwareRequired: false,
      nextCommand: expect.stringContaining("npm run rehearsal:closeout"),
      runbook: "docs/FIELD_LAPTOP_RUNBOOK.md"
    });
    expect(manifest.tasks[1]).toMatchObject({
      phase: 20,
      hardwareRequired: true,
      doneCriteria: expect.arrayContaining([
        "The archive reports `actualTargetHostValidated.jetson-orin-nano: true`."
      ])
    });
    expect(manifest.tasks[2]).toMatchObject({
      phase: 21,
      hardwareRequired: true,
      nextCommand: "npm run probe:hardware:archive -- --target raspberry-pi-5",
      doneCriteria: expect.arrayContaining([
        "The archive reports `actualTargetHostValidated.raspberry-pi-5: true`."
      ])
    });
    expect(manifest.tasks[3]).toMatchObject({
      phase: 30,
      hardwareRequired: true,
      nextCommand: expect.stringContaining("npm run bridge:mavlink:serial"),
      preconditions: expect.arrayContaining([
        "Configure baud rate and serial permissions outside SEEKR; the SEEKR wrapper opens the device path read-only.",
        "Write serial or bounded UDP bridge-run evidence under `.tmp/bridge-evidence/` using `--evidence-label <run-label>`."
      ]),
      doneCriteria: expect.arrayContaining([
        "A `.tmp/bridge-evidence/seekr-bridge-evidence-mavlink-serial-readonly-*` or `.tmp/bridge-evidence/seekr-bridge-evidence-mavlink-telemetry-*` artifact reports `status: pass`.",
        "The MAVLink bridge evidence says `commandEndpointsTouched: false`; serial runs also report `serialWriteOpened: false`, and UDP runs report a `listener.protocol` of `udp` with packets observed."
      ])
    });
    expect(manifest.tasks[4]).toMatchObject({
      phase: 40,
      hardwareRequired: true,
      nextCommand: expect.stringContaining("npm run bridge:ros2:live"),
      preconditions: expect.arrayContaining([
        "Write bridge run evidence under `.tmp/bridge-evidence/` using `--evidence-label <run-label>`.",
        "Do not expose ROS services or actions to SEEKR."
      ]),
      doneCriteria: expect.arrayContaining([
        "A `.tmp/bridge-evidence/seekr-bridge-evidence-ros2-live-readonly-*` artifact reports `status: pass`.",
        "The live ROS 2 bridge evidence says `commandEndpointsTouched: false`, `ros2ServicesTouched: false`, and `ros2ActionsTouched: false`."
      ])
    });
  });

  it("writes JSON and Markdown packet artifacts", async () => {
    const result = await writeBenchEvidencePacket({
      root,
      outDir: ".tmp/bench-evidence-packet",
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}bench-evidence-packet${path.sep}`);
    expect(result.markdownPath).toContain(`${path.sep}.tmp${path.sep}bench-evidence-packet${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"tasks\"");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR Bench Evidence Packet");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("No runtime policy is installed and no command upload path is enabled.");
  });

  it("splits legacy combined target-board checklist items into target-specific task cards", async () => {
    await writeFile(path.join(root, ".tmp/demo-readiness/seekr-demo-readiness-zz-legacy.json"), JSON.stringify({
      generatedAt: "2026-05-09T19:30:00.000Z",
      label: "legacy-internal-alpha",
      status: "ready-local-alpha",
      localAlphaOk: true,
      complete: false,
      commandUploadEnabled: false,
      validation: {
        ok: true,
        warnings: [],
        blockers: []
      },
      hardwareClaims: falseClaims(),
      nextEvidenceChecklist: [
        {
          id: "actual-board-hardware-evidence",
          label: "Actual Jetson/Pi hardware evidence",
          currentStatus: "blocked",
          currentDetails: "Hardware archives exist, but no actual-target host-platform pass was found for: jetson-orin-nano, raspberry-pi-5.",
          evidence: [".tmp/hardware-evidence/off-board.json"],
          requiredEvidence: "Run hardware readiness archive on actual Jetson Orin Nano and Raspberry Pi 5 hosts.",
          nextCommand: "npm run probe:hardware:archive",
          runbook: "docs/EDGE_HARDWARE_BENCH.md",
          hardwareRequired: true,
          safetyBoundary: "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation."
        }
      ]
    }), "utf8");

    const manifest = await buildBenchEvidencePacket({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.tasks.map((task) => task.id)).toEqual([
      "actual-jetson-orin-nano-hardware-evidence",
      "actual-raspberry-pi-5-hardware-evidence"
    ]);
    expect(manifest.tasks[0]).toMatchObject({
      label: "Actual Jetson Orin Nano hardware readiness archive",
      currentDetails: "Hardware archives exist, but no actual-target host-platform pass was found for: jetson-orin-nano.",
      nextCommand: "npm run probe:hardware:archive -- --target jetson-orin-nano"
    });
    expect(manifest.tasks[1]).toMatchObject({
      label: "Actual Raspberry Pi 5 hardware readiness archive",
      currentDetails: "Hardware archives exist, but no actual-target host-platform pass was found for: raspberry-pi-5.",
      nextCommand: "npm run probe:hardware:archive -- --target raspberry-pi-5"
    });
  });

  it("blocks packet readiness when the source demo package is locally blocked", async () => {
    await writeFile(path.join(root, ".tmp/demo-readiness/seekr-demo-readiness-blocked.json"), JSON.stringify({
      commandUploadEnabled: false,
      localAlphaOk: false,
      complete: false,
      validation: {
        ok: false,
        warnings: [],
        blockers: ["Acceptance status release checksum does not match the latest release evidence."]
      },
      hardwareClaims: falseClaims(),
      nextEvidenceChecklist: []
    }), "utf8");

    const manifest = await buildBenchEvidencePacket({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha");
    expect(manifest.validation.blockers).toContain("Demo readiness package must be ready for local alpha before bench evidence prep.");
    expect(manifest.commandUploadEnabled).toBe(false);
  });

  it("blocks packet readiness when the source demo package claims unsafe hardware state", async () => {
    await writeFile(path.join(root, ".tmp/demo-readiness/seekr-demo-readiness-unsafe.json"), JSON.stringify({
      commandUploadEnabled: true,
      localAlphaOk: true,
      complete: false,
      validation: {
        ok: true,
        warnings: [],
        blockers: []
      },
      hardwareClaims: {
        ...falseClaims(),
        realMavlinkBenchValidated: true
      },
      nextEvidenceChecklist: [
        {
          id: "real-mavlink-bench",
          label: "Real read-only MAVLink bench connection",
          currentStatus: "blocked",
          currentDetails: "Unsafe source package should block.",
          evidence: [],
          requiredEvidence: "Capture real read-only MAVLink evidence.",
          nextCommand: "npm run rehearsal:evidence -- --require-source mavlink:telemetry:drone-1",
          runbook: "docs/EDGE_HARDWARE_BENCH.md",
          hardwareRequired: true,
          safetyBoundary: "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation."
        }
      ]
    }), "utf8");

    const manifest = await buildBenchEvidencePacket({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.validation.blockers).toContain("Demo readiness package must keep commandUploadEnabled false.");
    expect(manifest.validation.blockers).toContain("Demo readiness package must keep all hardware claims false before real bench evidence exists.");
  });
});

async function seedDemoPackage(root: string) {
  await writeFile(path.join(root, ".tmp/demo-readiness/seekr-demo-readiness-alpha.json"), JSON.stringify({
    generatedAt: "2026-05-09T19:00:00.000Z",
    label: "internal-alpha",
    status: "ready-local-alpha",
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    validation: {
      ok: true,
      warnings: [],
      blockers: []
    },
    hardwareClaims: falseClaims(),
    nextEvidenceChecklist: [
      {
        id: "actual-jetson-orin-nano-hardware-evidence",
        label: "Actual Jetson Orin Nano hardware readiness archive",
        currentStatus: "blocked",
        currentDetails: "No actual-target Jetson host-platform pass.",
        evidence: [".tmp/hardware-evidence/off-board.json"],
        requiredEvidence: "Run a hardware readiness archive on the actual Jetson Orin Nano host.",
        nextCommand: "npm run probe:hardware:archive -- --target jetson-orin-nano",
        runbook: "docs/EDGE_HARDWARE_BENCH.md",
        hardwareRequired: true,
        safetyBoundary: "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation."
      },
      {
        id: "actual-raspberry-pi-5-hardware-evidence",
        label: "Actual Raspberry Pi 5 hardware readiness archive",
        currentStatus: "blocked",
        currentDetails: "No actual-target Raspberry Pi host-platform pass.",
        evidence: [".tmp/hardware-evidence/off-board.json"],
        requiredEvidence: "Run a hardware readiness archive on the actual Raspberry Pi 5 host.",
        nextCommand: "npm run probe:hardware:archive -- --target raspberry-pi-5",
        runbook: "docs/EDGE_HARDWARE_BENCH.md",
        hardwareRequired: true,
        safetyBoundary: "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation."
      },
      {
        id: "fresh-operator-rehearsal",
        label: "Fresh-operator field-laptop rehearsal",
        currentStatus: "blocked",
        currentDetails: "No fresh-operator closeout.",
        evidence: [".tmp/rehearsal-notes"],
        requiredEvidence: "Complete a fresh-operator field-laptop run.",
        nextCommand: "npm run rehearsal:closeout -- --operator <name> --machine <id> --before <json> --after <json> --replay-id <id> --final-hash <sha256> ...",
        runbook: "docs/FIELD_LAPTOP_RUNBOOK.md",
        hardwareRequired: false,
        safetyBoundary: "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation."
      },
      {
        id: "real-mavlink-bench",
        label: "Real read-only MAVLink bench connection",
        currentStatus: "blocked",
        currentDetails: "No real MAVLink source evidence.",
        evidence: [".tmp/rehearsal-evidence"],
        requiredEvidence: "Run the read-only MAVLink serial or UDP bridge against a real bench telemetry source.",
        nextCommand: "npm run bridge:mavlink:serial -- --base-url http://127.0.0.1:8787 --device <serial-device> --duration-ms 30000 --max-bytes 1000000 --evidence-label mavlink-bench && npm run rehearsal:evidence -- --label mavlink-bench --require-source mavlink:telemetry:drone-1",
        runbook: "docs/EDGE_HARDWARE_BENCH.md",
        hardwareRequired: true,
        safetyBoundary: "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation."
      },
      {
        id: "real-ros2-bench",
        label: "Real read-only ROS 2 bench topics",
        currentStatus: "blocked",
        currentDetails: "No real ROS 2 topic evidence.",
        evidence: [".tmp/rehearsal-evidence"],
        requiredEvidence: "Run the live read-only ROS 2 topic bridge against real bench topics.",
        nextCommand: "npm run bridge:ros2:live -- --base-url http://127.0.0.1:8787 --topic /drone/pose,/map,/detections,/lidar/points --duration-ms 30000 --max-records 200 --evidence-label ros2-bench && npm run rehearsal:evidence -- --label ros2-bench --require-source ros2-pose:telemetry,lidar-slam:lidar+spatial,isaac-nvblox:costmap",
        runbook: "docs/EDGE_HARDWARE_BENCH.md",
        hardwareRequired: true,
        safetyBoundary: "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation."
      },
      {
        id: "hardware-actuation-policy-review",
        label: "Fail-closed hardware-actuation policy review package",
        currentStatus: "blocked",
        currentDetails: "Policy gate is missing real evidence.",
        evidence: [".tmp/policy-evidence/blocked.json"],
        requiredEvidence: "Generate a fail-closed hardware-actuation review package after actual target-board and HIL evidence exist.",
        nextCommand: "npm run policy:hardware:gate -- --operator <name> --target <target> --vehicle <id> --reviewers \"Safety Lead,Test Director\" --policy <json> --hardware-evidence <json> --hil-evidence <json> --command-upload-enabled false",
        runbook: "docs/HARDWARE_DECISION_GATE.md",
        hardwareRequired: true,
        safetyBoundary: "Keep commandUploadEnabled false; do not enable real aircraft command upload or hardware actuation."
      }
    ]
  }), "utf8");
}

function falseClaims() {
  return {
    jetsonOrinNanoValidated: false,
    raspberryPi5Validated: false,
    realMavlinkBenchValidated: false,
    realRos2BenchValidated: false,
    hilFailsafeValidated: false,
    isaacJetsonCaptureValidated: false,
    hardwareActuationAuthorized: false
  };
}
