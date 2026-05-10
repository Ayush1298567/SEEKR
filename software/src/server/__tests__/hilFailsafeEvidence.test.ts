import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHilFailsafeEvidence, writeHilFailsafeEvidence } from "../../../scripts/hil-failsafe-evidence";

describe("HIL failsafe evidence", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-hil-evidence-test-${process.pid}-${Date.now()}`);
    await seedEvidence(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("marks HIL evidence completed only with actual hardware, source evidence, logs, and manual override fields", async () => {
    const manifest = await buildHilFailsafeEvidence({
      root,
      ...filledFields()
    });

    expect(manifest).toMatchObject({
      status: "completed",
      commandUploadEnabled: false,
      validation: { ok: true }
    });
    expect(manifest.limitations).toEqual(expect.arrayContaining([
      "It does not enable MAVLink, ROS 2, PX4, ArduPilot, or aircraft command upload."
    ]));
  });

  it("writes completed HIL evidence JSON and Markdown under .tmp", async () => {
    const result = await writeHilFailsafeEvidence({
      root,
      outDir: ".tmp/hil-evidence",
      generatedAt: "2026-05-09T22:00:00.000Z",
      ...filledFields()
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}hil-evidence${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"status\": \"completed\"");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR HIL Failsafe Evidence");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Command upload enabled: false");
  });

  it("blocks HIL completion for off-board hardware evidence or unsafe command state", async () => {
    await writeFile(path.join(root, ".tmp/hardware-evidence/offboard.json"), JSON.stringify({
      commandUploadEnabled: false,
      actualHardwareValidationComplete: false,
      hardwareValidationScope: "off-board-readiness",
      actualTargetHostValidated: { "jetson-orin-nano": false }
    }), "utf8");

    const manifest = await buildHilFailsafeEvidence({
      root,
      ...filledFields(),
      commandUploadEnabledObserved: true,
      hardwareEvidencePath: ".tmp/hardware-evidence/offboard.json"
    });

    expect(manifest.status).toBe("blocked");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      "commandUploadEnabledObserved must be false for HIL failsafe evidence.",
      "HIL hardware evidence must be actual target-board validation, not off-board readiness.",
      "HIL hardware evidence does not validate requested target jetson-orin-nano."
    ]));
  });

  it("blocks referenced evidence paths that escape the project root", async () => {
    const manifest = await buildHilFailsafeEvidence({
      root,
      ...filledFields(),
      hardwareEvidencePath: "../outside-hardware.json",
      rehearsalEvidencePath: "../outside-rehearsal.json",
      flightLogPath: "../outside-flight.log",
      operatorNotesPath: "../outside-notes.md"
    });

    expect(manifest.status).toBe("blocked");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      "HIL hardware evidence path must stay inside the project root.",
      "HIL rehearsal evidence path must stay inside the project root.",
      "HIL flight log path must stay inside the project root.",
      "HIL operator notes path must stay inside the project root."
    ]));
  });
});

function filledFields() {
  return {
    label: "jetson hil failsafe",
    operatorName: "Test Operator",
    targetHardware: "jetson-orin-nano",
    vehicleIdentifier: "bench-quad-1",
    autopilot: "px4",
    failsafeKind: "link-loss",
    failsafeTriggeredAt: "2026-05-09T20:00:00Z",
    manualOverrideObservedAt: "2026-05-09T20:00:10Z",
    estopVerifiedAt: "2026-05-09T20:00:15Z",
    aircraftSafeAt: "2026-05-09T20:00:30Z",
    manualOverrideResult: "operator regained authority and confirmed no GCS command upload",
    onboardFailsafeResult: "PX4 failsafe entered hold/land under onboard authority",
    deviationsOrFailures: "none",
    hardwareEvidencePath: ".tmp/hardware-evidence/actual.json",
    rehearsalEvidencePath: ".tmp/rehearsal-evidence/after.json",
    flightLogPath: ".tmp/hil-evidence/flight.log",
    commandUploadEnabledObserved: false
  };
}

async function seedEvidence(root: string) {
  await mkdir(path.join(root, ".tmp/hardware-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/hil-evidence"), { recursive: true });
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
        { sourceAdapter: "mavlink", channels: ["telemetry"], eventCount: 4 },
        { sourceAdapter: "ros2-pose", channels: ["telemetry"], eventCount: 2 }
      ]
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/hil-evidence/flight.log"), "link-loss failsafe triggered; manual override observed; estop verified\n", "utf8");
}
