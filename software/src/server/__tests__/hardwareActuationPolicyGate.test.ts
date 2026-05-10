import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildHardwareActuationPolicyGate,
  writeHardwareActuationPolicyGate
} from "../../../scripts/hardware-actuation-policy-gate";

describe("hardware actuation policy gate", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-policy-gate-test-${process.pid}-${Date.now()}`);
    await mkdir(path.join(root, ".tmp/policy-candidates"), { recursive: true });
    await mkdir(path.join(root, ".tmp/hardware-evidence"), { recursive: true });
    await mkdir(path.join(root, ".tmp/hil-evidence"), { recursive: true });
    await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
      ok: true,
      commandUploadEnabled: false
    }), "utf8");
    await writeFile(path.join(root, ".tmp/policy-candidates/deny-default.json"), JSON.stringify(candidatePolicy()), "utf8");
    await writeFile(path.join(root, ".tmp/hardware-evidence/actual-target.json"), JSON.stringify(actualHardwareEvidence()), "utf8");
    await writeFile(path.join(root, ".tmp/hil-evidence/completed.json"), JSON.stringify(completedHilEvidence()), "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("marks a complete deny-by-default package ready for human review without authorizing commands", async () => {
    const manifest = await buildHardwareActuationPolicyGate({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z",
      operatorName: "Safety Operator",
      targetHardware: "jetson-orin-nano",
      vehicleIdentifier: "bench-quad-1",
      reviewedAt: "2026-05-09T19:55:00Z",
      reviewers: "Safety Lead,Test Director",
      candidatePolicyPath: ".tmp/policy-candidates/deny-default.json",
      hardwareEvidencePath: ".tmp/hardware-evidence/actual-target.json",
      hilEvidencePath: ".tmp/hil-evidence/completed.json",
      commandUploadEnabledObserved: false
    });

    expect(manifest.status).toBe("ready-for-human-review");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.authorization).toEqual({
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    });
    expect(manifest.validation).toMatchObject({ ok: true, blockers: [] });
  });

  it("writes JSON and Markdown evidence for the policy gate", async () => {
    const result = await writeHardwareActuationPolicyGate({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z",
      label: "bench-quad-1",
      operatorName: "Safety Operator",
      targetHardware: "jetson-orin-nano",
      vehicleIdentifier: "bench-quad-1",
      reviewedAt: "2026-05-09T19:55:00Z",
      reviewers: ["Safety Lead", "Test Director"],
      candidatePolicyPath: ".tmp/policy-candidates/deny-default.json",
      hardwareEvidencePath: ".tmp/hardware-evidence/actual-target.json",
      hilEvidencePath: ".tmp/hil-evidence/completed.json",
      commandUploadEnabledObserved: "false"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}policy-evidence${path.sep}`);
    expect(result.markdownPath).toContain(`${path.sep}.tmp${path.sep}policy-evidence${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"hardwareActuationEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Real aircraft command upload authorized: false");
  });

  it("blocks policies that attempt to enable command upload or hardware command classes", async () => {
    await writeFile(path.join(root, ".tmp/policy-candidates/unsafe.json"), JSON.stringify({
      ...candidatePolicy(),
      commandUploadEnabled: true,
      realAircraftCommandUploadAuthorized: true,
      approvedCommandClasses: ["arm", "takeoff"]
    }), "utf8");

    const manifest = await buildHardwareActuationPolicyGate({
      root,
      operatorName: "Safety Operator",
      targetHardware: "jetson-orin-nano",
      vehicleIdentifier: "bench-quad-1",
      reviewedAt: "2026-05-09T19:55:00Z",
      reviewers: "Safety Lead,Test Director",
      candidatePolicyPath: ".tmp/policy-candidates/unsafe.json",
      hardwareEvidencePath: ".tmp/hardware-evidence/actual-target.json",
      hilEvidencePath: ".tmp/hil-evidence/completed.json",
      commandUploadEnabledObserved: true
    });

    expect(manifest.status).toBe("blocked");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      "commandUploadEnabledObserved must be false for hardware-actuation policy review evidence.",
      "Candidate policy must keep commandUploadEnabled false.",
      "Candidate policy must not authorize real aircraft command upload.",
      "Candidate policy field approvedCommandClasses must be empty until runtime actuation is explicitly approved in a future change."
    ]));
  });

  it("blocks off-board hardware evidence and mismatched HIL evidence", async () => {
    await writeFile(path.join(root, ".tmp/hardware-evidence/off-board.json"), JSON.stringify({
      commandUploadEnabled: false,
      actualHardwareValidationComplete: false,
      hardwareValidationScope: "off-board-readiness",
      actualTargetHostValidated: {
        "jetson-orin-nano": false
      }
    }), "utf8");
    await writeFile(path.join(root, ".tmp/hil-evidence/mismatch.json"), JSON.stringify({
      ...completedHilEvidence(),
      run: {
        ...completedHilEvidence().run,
        targetHardware: "raspberry-pi-5"
      }
    }), "utf8");

    const manifest = await buildHardwareActuationPolicyGate({
      root,
      operatorName: "Safety Operator",
      targetHardware: "jetson-orin-nano",
      vehicleIdentifier: "bench-quad-1",
      reviewedAt: "2026-05-09T19:55:00Z",
      reviewers: "Safety Lead,Test Director",
      candidatePolicyPath: ".tmp/policy-candidates/deny-default.json",
      hardwareEvidencePath: ".tmp/hardware-evidence/off-board.json",
      hilEvidencePath: ".tmp/hil-evidence/mismatch.json",
      commandUploadEnabledObserved: false
    });

    expect(manifest.status).toBe("blocked");
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      "Hardware evidence must be actual target-board validation, not off-board readiness.",
      "Hardware evidence does not validate requested target jetson-orin-nano.",
      "HIL evidence targetHardware raspberry-pi-5 does not match requested target jetson-orin-nano."
    ]));
  });

  it("blocks referenced policy/evidence paths that escape the project root", async () => {
    const manifest = await buildHardwareActuationPolicyGate({
      root,
      operatorName: "Safety Operator",
      targetHardware: "jetson-orin-nano",
      vehicleIdentifier: "bench-quad-1",
      reviewedAt: "2026-05-09T19:55:00Z",
      reviewers: "Safety Lead,Test Director",
      candidatePolicyPath: "../outside-policy.json",
      acceptanceStatusPath: "../outside-acceptance.json",
      hardwareEvidencePath: "../outside-hardware.json",
      hilEvidencePath: "../outside-hil.json",
      reviewPacketPath: "../outside-review.md",
      commandUploadEnabledObserved: false
    });

    expect(manifest.status).toBe("blocked");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      "Candidate policy path must stay inside the project root.",
      "Acceptance status path must stay inside the project root.",
      "Hardware evidence path must stay inside the project root.",
      "HIL evidence path must stay inside the project root.",
      "Review packet path must stay inside the project root."
    ]));
  });
});

function candidatePolicy() {
  return {
    schemaVersion: 1,
    policyKind: "seekr-hardware-actuation-review",
    targetHardware: "jetson-orin-nano",
    vehicleIdentifier: "bench-quad-1",
    commandUploadEnabled: false,
    realAircraftCommandUploadAuthorized: false,
    hardwareActuationEnabled: false,
    runtimeInstallApproved: false,
    manualOverrideRequired: true,
    estopRequired: true,
    approvedCommandClasses: [],
    authorizedCommandClasses: [],
    allowedHardwareCommands: []
  };
}

function actualHardwareEvidence() {
  return {
    commandUploadEnabled: false,
    actualHardwareValidationComplete: true,
    hardwareValidationScope: "actual-target",
    actualTargetHostValidated: {
      "jetson-orin-nano": true
    }
  };
}

function completedHilEvidence() {
  return {
    status: "completed",
    commandUploadEnabled: false,
    run: {
      operatorName: "Safety Operator",
      targetHardware: "jetson-orin-nano",
      vehicleIdentifier: "bench-quad-1",
      autopilot: "px4",
      failsafeKind: "link-loss",
      failsafeTriggeredAt: "2026-05-09T19:30:00Z",
      manualOverrideObservedAt: "2026-05-09T19:30:10Z",
      estopVerifiedAt: "2026-05-09T19:30:20Z",
      aircraftSafeAt: "2026-05-09T19:30:40Z",
      manualOverrideResult: "operator regained authority",
      onboardFailsafeResult: "PX4 hold/land observed",
      deviationsOrFailures: "none"
    },
    evidence: {
      hardwareEvidencePath: ".tmp/hardware-evidence/actual-target.json",
      rehearsalEvidencePath: ".tmp/rehearsal-evidence/actual.json",
      flightLogPath: ".tmp/hil-evidence/flight.log"
    },
    validation: { ok: true }
  };
}
