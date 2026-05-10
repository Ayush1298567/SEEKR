import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIsaacHilCaptureEvidence, writeIsaacHilCaptureEvidence } from "../../../scripts/isaac-hil-capture-evidence";

describe("Isaac HIL capture evidence", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-isaac-evidence-test-${process.pid}-${Date.now()}`);
    await seedEvidence(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("marks Isaac capture completed only with actual Jetson evidence, Isaac source evidence, manifest, and log", async () => {
    const manifest = await buildIsaacHilCaptureEvidence({
      root,
      ...filledFields()
    });

    expect(manifest).toMatchObject({
      status: "completed",
      commandUploadEnabled: false,
      validation: { ok: true }
    });
    expect(manifest.limitations).toEqual(expect.arrayContaining([
      "The deterministic isaac-sim-hil-lite fixture remains local import proof only; this artifact is for actual Jetson bench capture evidence."
    ]));
  });

  it("writes completed Isaac capture JSON and Markdown under .tmp", async () => {
    const result = await writeIsaacHilCaptureEvidence({
      root,
      outDir: ".tmp/isaac-evidence",
      generatedAt: "2026-05-09T22:00:00.000Z",
      ...filledFields()
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}isaac-evidence${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"status\": \"completed\"");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR Isaac HIL Capture Evidence");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Command upload enabled: false");
  });

  it("blocks Isaac capture completion for off-board hardware, missing Isaac source, or unsafe command state", async () => {
    await writeFile(path.join(root, ".tmp/hardware-evidence/offboard.json"), JSON.stringify({
      commandUploadEnabled: false,
      actualHardwareValidationComplete: false,
      hardwareValidationScope: "off-board-readiness",
      actualTargetHostValidated: { "jetson-orin-nano": false }
    }), "utf8");
    await writeFile(path.join(root, ".tmp/rehearsal-evidence/no-isaac.json"), JSON.stringify({
      commandUploadEnabled: false,
      validation: { ok: true },
      sourceEvidence: {
        matched: [
          { sourceAdapter: "mavlink", channels: ["telemetry"], eventCount: 4 }
        ]
      }
    }), "utf8");

    const manifest = await buildIsaacHilCaptureEvidence({
      root,
      ...filledFields(),
      commandUploadEnabledObserved: true,
      hardwareEvidencePath: ".tmp/hardware-evidence/offboard.json",
      rehearsalEvidencePath: ".tmp/rehearsal-evidence/no-isaac.json"
    });

    expect(manifest.status).toBe("blocked");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      "commandUploadEnabledObserved must be false for Isaac HIL capture evidence.",
      "Isaac HIL hardware evidence must be actual target-board validation, not off-board readiness.",
      "Isaac HIL hardware evidence does not validate requested target jetson-orin-nano.",
      "Isaac HIL rehearsal evidence must include fresh Isaac source-health events."
    ]));
  });

  it("blocks referenced evidence paths that escape the project root", async () => {
    const manifest = await buildIsaacHilCaptureEvidence({
      root,
      ...filledFields(),
      hardwareEvidencePath: "../outside-hardware.json",
      rehearsalEvidencePath: "../outside-rehearsal.json",
      captureManifestPath: "../outside-capture.json",
      captureLogPath: "../outside-capture.log",
      replayVerifyPath: "../outside-replay.json"
    });

    expect(manifest.status).toBe("blocked");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      "Isaac HIL hardware evidence path must stay inside the project root.",
      "Isaac HIL rehearsal evidence path must stay inside the project root.",
      "Isaac capture manifest path must stay inside the project root.",
      "Isaac capture log path must stay inside the project root.",
      "Isaac replay verification path must stay inside the project root."
    ]));
  });
});

function filledFields() {
  return {
    label: "jetson isaac capture",
    operatorName: "Test Operator",
    targetHardware: "jetson-orin-nano",
    isaacSimHost: "sim-host-1",
    isaacSimVersion: "4.2",
    isaacRosVersion: "3.x",
    sensorSuite: "rgb-depth-lidar",
    captureStartedAt: "2026-05-09T20:00:00Z",
    captureEndedAt: "2026-05-09T20:05:00Z",
    captureResult: "captured telemetry, costmap, detections, and point cloud",
    deviationsOrFailures: "none",
    hardwareEvidencePath: ".tmp/hardware-evidence/actual.json",
    rehearsalEvidencePath: ".tmp/rehearsal-evidence/after.json",
    captureManifestPath: ".tmp/isaac-evidence/capture.json",
    captureLogPath: ".tmp/isaac-evidence/capture.log",
    replayVerifyPath: ".tmp/isaac-evidence/replay-verify.json",
    commandUploadEnabledObserved: false
  };
}

async function seedEvidence(root: string) {
  await mkdir(path.join(root, ".tmp/hardware-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/isaac-evidence"), { recursive: true });
  await writeFile(path.join(root, ".tmp/hardware-evidence/actual.json"), JSON.stringify({
    commandUploadEnabled: false,
    actualHardwareValidationComplete: true,
    hardwareValidationScope: "actual-target",
    actualTargetHostValidated: { "jetson-orin-nano": true }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/rehearsal-evidence/after.json"), JSON.stringify({
    commandUploadEnabled: false,
    validation: { ok: true },
    sourceEvidence: {
      matched: [
        { sourceAdapter: "isaac-nvblox", channels: ["costmap", "perception"], eventCount: 4 },
        { sourceAdapter: "isaac-sim-hil", channels: ["spatial", "lidar"], eventCount: 2 }
      ]
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/isaac-evidence/capture.json"), JSON.stringify({
    source: "isaac-sim-hil",
    pipeline: "isaac-ros-nvblox",
    commandUploadEnabled: false,
    counts: { telemetry: 1, costmap: 1, detection: 1, pointCloud: 1 }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/isaac-evidence/capture.log"), "captured isaac sim sensor frames into Jetson read-only bridge\n", "utf8");
  await writeFile(path.join(root, ".tmp/isaac-evidence/replay-verify.json"), JSON.stringify({ ok: true }), "utf8");
}
