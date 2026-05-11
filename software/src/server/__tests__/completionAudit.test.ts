import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCompletionAudit, writeCompletionAudit } from "../../../scripts/completion-audit";

describe("completion audit", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-completion-audit-test-${process.pid}-${Date.now()}`);
    await seedRoot(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps local alpha green while blocking completion on real-world evidence", async () => {
    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.localAlphaOk).toBe(true);
    expect(manifest.complete).toBe(false);
    expect(manifest.status).toBe("blocked-real-world-evidence");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.summary.blocked).toBe(8);
    expect(manifest.realWorldBlockerIds).toHaveLength(8);
    expect(manifest.realWorldBlockerIds).toEqual(expect.arrayContaining([
      "actual-jetson-orin-nano-hardware-evidence",
      "actual-raspberry-pi-5-hardware-evidence",
      "real-mavlink-bench",
      "real-ros2-bench",
      "hardware-actuation-policy-review"
    ]));
    expect(manifest.realWorldBlockers).toHaveLength(8);
    expect(manifest.realWorldBlockers).toEqual(expect.arrayContaining([
      expect.stringContaining("jetson-orin-nano"),
      expect.stringContaining("raspberry-pi-5"),
      expect.stringContaining("real serial/UDP MAVLink"),
      expect.stringContaining("real ROS 2"),
      expect.stringContaining("hardware-actuation policy review package")
    ]));
    expect(manifest.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "actual-jetson-orin-nano-hardware-evidence",
        status: "blocked"
      }),
      expect.objectContaining({
        id: "actual-raspberry-pi-5-hardware-evidence",
        status: "blocked"
      })
    ]));
  });

  it("writes JSON and Markdown audit artifacts", async () => {
    const result = await writeCompletionAudit({
      root,
      outDir: ".tmp/completion-audit",
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}completion-audit${path.sep}`);
    expect(result.markdownPath).toContain(`${path.sep}.tmp${path.sep}completion-audit${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"realWorldBlockerIds\"");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("actual-jetson-orin-nano-hardware-evidence");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("fixture/SITL evidence");
  });

  it("fails local alpha when required scripts or safety evidence are missing", async () => {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { check: "echo ok" } }), "utf8");
    await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({ ok: true, commandUploadEnabled: true }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.status).toBe("local-alpha-failing");
    expect(manifest.items.find((item) => item.id === "required-scripts")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("bridge:spatial")
    });
    expect(manifest.items.find((item) => item.id === "acceptance-status")?.status).toBe("fail");
  });

  it("fails local alpha when final API probe evidence is missing", async () => {
    await rm(path.join(root, ".tmp/api-probe"), { recursive: true, force: true });

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.status).toBe("local-alpha-failing");
    expect(manifest.items.find((item) => item.id === "api-probe-evidence")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("No API probe evidence exists")
    });
  });

  it("fails local alpha when API probe evidence does not match acceptance status", async () => {
    await writeFile(path.join(root, ".tmp/api-probe/seekr-api-probe-test.json"), JSON.stringify({
      ok: true,
      commandUploadEnabled: false,
      checked: ["config", "session-acceptance", "session-acceptance-evidence", "malformed-json"],
      sessionAcceptance: {
        status: "pass",
        commandUploadEnabled: false,
        releaseChecksum: {
          overallSha256: "c".repeat(64),
          fileCount: 42,
          totalBytes: 123456
        },
        commandBoundaryScan: {
          status: "pass",
          scannedFileCount: 12,
          violationCount: 0,
          allowedFindingCount: 3
        }
      }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.items.find((item) => item.id === "api-probe-evidence")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("probe release checksum summary does not match acceptance status")
    });
  });

  it("fails local alpha when acceptance status points at stale release or safety evidence", async () => {
    await writeFile(path.join(root, ".tmp/release-evidence/seekr-release-z-newer.json"), JSON.stringify({
      commandUploadEnabled: false,
      overallSha256: "b".repeat(64),
      fileCount: 43,
      totalBytes: 123457
    }), "utf8");
    await writeFile(path.join(root, ".tmp/safety-evidence/seekr-command-boundary-scan-z-newer.json"), JSON.stringify({
      status: "pass",
      commandUploadEnabled: false,
      summary: {
        scannedFileCount: 13,
        violationCount: 0,
        allowedFindingCount: 4
      }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.status).toBe("local-alpha-failing");
    expect(manifest.items.find((item) => item.id === "acceptance-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("acceptance release checksum path does not point at the latest release evidence")
    });
    expect(manifest.items.find((item) => item.id === "acceptance-status")?.details).toEqual(expect.stringContaining(
      "acceptance command-boundary scan path does not point at the latest safety evidence"
    ));
    expect(manifest.commandUploadEnabled).toBe(false);
  });

  it("recognizes a completed fresh-operator rehearsal closeout when one is present", async () => {
    await mkdir(path.join(root, ".tmp/rehearsal-notes"), { recursive: true });
    await writeFile(path.join(root, ".tmp/rehearsal-notes/seekr-rehearsal-closeout-test.json"), JSON.stringify({
      status: "completed",
      freshOperatorCompleted: true,
      commandUploadEnabled: false,
      operatorFields: {
        operatorName: "Test Operator",
        machineIdentifier: "field-laptop-1",
        setupStartedAt: "2026-05-09T20:00:00Z",
        acceptanceCompletedAt: "2026-05-09T20:10:00Z",
        missionExportCompletedAt: "2026-05-09T20:30:00Z",
        replayId: "replay-1",
        finalStateHash: "a".repeat(64),
        shutdownCompletedAt: "2026-05-09T20:40:00Z",
        deviationsOrFailures: "none"
      },
      validation: { ok: true }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "fresh-operator-rehearsal")).toMatchObject({
      status: "pass"
    });
    expect(manifest.realWorldBlockers).not.toEqual(expect.arrayContaining([
      expect.stringContaining("fresh-operator")
    ]));
  });

  it("recognizes real read-only bridge evidence only when actual board and required-source evidence are present", async () => {
    await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-actual-targets.json"), JSON.stringify({
      commandUploadEnabled: false,
      actualHardwareValidationComplete: true,
      hardwareValidationScope: "actual-target",
      reports: [
        hardwareReport("jetson-orin-nano", "pass"),
        hardwareReport("raspberry-pi-5", "pass")
      ]
    }), "utf8");
    await writeFile(path.join(root, ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-real-sources.json"), JSON.stringify({
      commandUploadEnabled: false,
      validation: { ok: true },
      sourceEvidence: {
        matched: [
          matchedSource("mavlink", ["telemetry"], 8),
          matchedSource("ros2-slam", ["map"], 3),
          matchedSource("ros2-pose", ["telemetry"], 5),
          matchedSource("ros2-perception", ["detection", "perception"], 2),
          matchedSource("lidar-slam", ["lidar", "slam", "spatial"], 4)
        ]
      }
    }), "utf8");
    await writeFile(path.join(root, ".tmp/bridge-evidence/seekr-bridge-evidence-mavlink-serial-readonly-real.json"), JSON.stringify(
      bridgeEvidence("mavlink-serial-readonly", { serialWriteOpened: false })
    ), "utf8");
    await writeFile(path.join(root, ".tmp/bridge-evidence/seekr-bridge-evidence-ros2-live-readonly-real.json"), JSON.stringify(
      bridgeEvidence("ros2-live-readonly", { ros2ServicesTouched: false, ros2ActionsTouched: false })
    ), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "real-mavlink-bench")).toMatchObject({
      status: "pass"
    });
    expect(manifest.items.find((item) => item.id === "real-ros2-bench")).toMatchObject({
      status: "pass"
    });
    expect(manifest.realWorldBlockers).not.toEqual(expect.arrayContaining([
      expect.stringContaining("real serial/UDP MAVLink"),
      expect.stringContaining("real ROS 2")
    ]));
  });

  it("does not clear real bridge blockers from source and hardware evidence without bridge-run evidence", async () => {
    await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-actual-targets.json"), JSON.stringify({
      commandUploadEnabled: false,
      actualHardwareValidationComplete: true,
      hardwareValidationScope: "actual-target",
      reports: [
        hardwareReport("jetson-orin-nano", "pass"),
        hardwareReport("raspberry-pi-5", "pass")
      ]
    }), "utf8");
    await writeFile(path.join(root, ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-real-sources.json"), JSON.stringify({
      commandUploadEnabled: false,
      validation: { ok: true },
      sourceEvidence: {
        matched: [
          matchedSource("mavlink", ["telemetry"], 8),
          matchedSource("ros2-slam", ["map"], 3),
          matchedSource("ros2-pose", ["telemetry"], 5),
          matchedSource("ros2-perception", ["detection", "perception"], 2),
          matchedSource("lidar-slam", ["lidar", "slam", "spatial"], 4)
        ]
      }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "real-mavlink-bench")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("Missing bridge-run evidence")
    });
    expect(manifest.items.find((item) => item.id === "real-ros2-bench")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("Missing bridge-run evidence")
    });
  });

  it("recognizes real MAVLink UDP bridge evidence when actual board and required-source evidence are present", async () => {
    await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-actual-targets.json"), JSON.stringify({
      commandUploadEnabled: false,
      actualHardwareValidationComplete: true,
      hardwareValidationScope: "actual-target",
      reports: [
        hardwareReport("jetson-orin-nano", "pass"),
        hardwareReport("raspberry-pi-5", "pass")
      ]
    }), "utf8");
    await writeFile(path.join(root, ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-real-mavlink.json"), JSON.stringify({
      commandUploadEnabled: false,
      validation: { ok: true },
      sourceEvidence: {
        matched: [
          matchedSource("mavlink", ["telemetry"], 8)
        ]
      }
    }), "utf8");
    await writeFile(path.join(root, ".tmp/bridge-evidence/seekr-bridge-evidence-mavlink-telemetry-udp.json"), JSON.stringify(
      bridgeEvidence("mavlink-telemetry", {}, { protocol: "udp", packetCount: 2 })
    ), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "real-mavlink-bench")).toMatchObject({
      status: "pass"
    });
  });

  it("does not clear actual hardware blockers from host-platform passes without actual-target scope", async () => {
    await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-host-pass-offboard.json"), JSON.stringify({
      commandUploadEnabled: false,
      actualHardwareValidationComplete: false,
      hardwareValidationScope: "off-board-readiness",
      reports: [
        hardwareReport("jetson-orin-nano", "pass"),
        hardwareReport("raspberry-pi-5", "pass")
      ]
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "actual-jetson-orin-nano-hardware-evidence")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("jetson-orin-nano")
    });
    expect(manifest.items.find((item) => item.id === "actual-raspberry-pi-5-hardware-evidence")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("raspberry-pi-5")
    });
    expect(manifest.items.find((item) => item.id === "real-mavlink-bench")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("Actual target-board evidence is missing")
    });
  });

  it("does not clear real bridge blockers from required-source evidence without actual target hardware", async () => {
    await writeFile(path.join(root, ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-local-sources.json"), JSON.stringify({
      commandUploadEnabled: false,
      validation: { ok: true },
      sourceEvidence: {
        matched: [
          matchedSource("mavlink", ["telemetry"], 8),
          matchedSource("ros2-slam", ["map"], 3),
          matchedSource("ros2-pose", ["telemetry"], 5),
          matchedSource("ros2-perception", ["detection", "perception"], 2),
          matchedSource("lidar-slam", ["lidar", "slam", "spatial"], 4)
        ]
      }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "real-mavlink-bench")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("Actual target-board evidence is missing")
    });
    expect(manifest.items.find((item) => item.id === "real-ros2-bench")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("Actual target-board evidence is missing")
    });
  });

  it("recognizes completed HIL failsafe/manual override evidence when one is present", async () => {
    await mkdir(path.join(root, ".tmp/hil-evidence"), { recursive: true });
    await seedHilCompletionReferences(root);
    await writeFile(path.join(root, ".tmp/hil-evidence/seekr-hil-failsafe-test.json"), JSON.stringify({
      status: "completed",
      commandUploadEnabled: false,
      run: {
        operatorName: "Test Operator",
        targetHardware: "jetson-orin-nano",
        vehicleIdentifier: "bench-quad-1",
        autopilot: "px4",
        failsafeKind: "link-loss",
        failsafeTriggeredAt: "2026-05-09T20:00:00Z",
        manualOverrideObservedAt: "2026-05-09T20:00:10Z",
        estopVerifiedAt: "2026-05-09T20:00:15Z",
        aircraftSafeAt: "2026-05-09T20:00:30Z",
        manualOverrideResult: "operator regained authority",
        onboardFailsafeResult: "PX4 hold/land observed",
        deviationsOrFailures: "none"
      },
      evidence: {
        hardwareEvidencePath: ".tmp/hardware-evidence/actual.json",
        rehearsalEvidencePath: ".tmp/rehearsal-evidence/after.json",
        flightLogPath: ".tmp/hil-evidence/flight.log"
      },
      validation: { ok: true }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "hil-failsafe-logs")).toMatchObject({
      status: "pass"
    });
    expect(manifest.realWorldBlockers).not.toEqual(expect.arrayContaining([
      expect.stringContaining("HIL failsafe run")
    ]));
  });

  it("does not clear HIL failsafe blockers from a completed manifest with missing referenced evidence", async () => {
    await mkdir(path.join(root, ".tmp/hil-evidence"), { recursive: true });
    await writeFile(path.join(root, ".tmp/hil-evidence/seekr-hil-failsafe-missing-references.json"), JSON.stringify({
      status: "completed",
      commandUploadEnabled: false,
      run: {
        operatorName: "Test Operator",
        targetHardware: "jetson-orin-nano",
        vehicleIdentifier: "bench-quad-1",
        autopilot: "px4",
        failsafeKind: "link-loss",
        failsafeTriggeredAt: "2026-05-09T20:00:00Z",
        manualOverrideObservedAt: "2026-05-09T20:00:10Z",
        estopVerifiedAt: "2026-05-09T20:00:15Z",
        aircraftSafeAt: "2026-05-09T20:00:30Z",
        manualOverrideResult: "operator regained authority",
        onboardFailsafeResult: "PX4 hold/land observed",
        deviationsOrFailures: "none"
      },
      evidence: {
        hardwareEvidencePath: ".tmp/hardware-evidence/missing-actual.json",
        rehearsalEvidencePath: ".tmp/rehearsal-evidence/missing-after.json",
        flightLogPath: ".tmp/hil-evidence/missing-flight.log"
      },
      validation: { ok: true }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "hil-failsafe-logs")).toMatchObject({
      status: "blocked"
    });
    expect(manifest.realWorldBlockers).toEqual(expect.arrayContaining([
      expect.stringContaining("HIL failsafe evidence files exist")
    ]));
  });

  it("recognizes completed Isaac Sim to Jetson HIL capture evidence when one is present", async () => {
    await mkdir(path.join(root, ".tmp/isaac-evidence"), { recursive: true });
    await seedIsaacCompletionReferences(root);
    await writeFile(path.join(root, ".tmp/isaac-evidence/seekr-isaac-hil-capture-test.json"), JSON.stringify({
      status: "completed",
      commandUploadEnabled: false,
      run: {
        operatorName: "Test Operator",
        targetHardware: "jetson-orin-nano",
        isaacSimHost: "sim-host-1",
        isaacSimVersion: "4.2",
        isaacRosVersion: "3.x",
        sensorSuite: "rgb-depth-lidar",
        captureStartedAt: "2026-05-09T20:00:00Z",
        captureEndedAt: "2026-05-09T20:05:00Z",
        captureResult: "captured telemetry, costmap, detections, and point cloud",
        deviationsOrFailures: "none"
      },
      evidence: {
        hardwareEvidencePath: ".tmp/hardware-evidence/actual.json",
        rehearsalEvidencePath: ".tmp/rehearsal-evidence/after.json",
        captureManifestPath: ".tmp/isaac-evidence/capture.json",
        captureLogPath: ".tmp/isaac-evidence/capture.log"
      },
      validation: { ok: true }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "isaac-jetson-capture")).toMatchObject({
      status: "pass"
    });
    expect(manifest.realWorldBlockers).not.toEqual(expect.arrayContaining([
      expect.stringContaining("Isaac Sim HIL")
    ]));
  });

  it("does not clear Isaac capture blockers from a completed manifest with missing referenced evidence", async () => {
    await mkdir(path.join(root, ".tmp/isaac-evidence"), { recursive: true });
    await writeFile(path.join(root, ".tmp/isaac-evidence/seekr-isaac-hil-capture-missing-references.json"), JSON.stringify({
      status: "completed",
      commandUploadEnabled: false,
      run: {
        operatorName: "Test Operator",
        targetHardware: "jetson-orin-nano",
        isaacSimHost: "sim-host-1",
        isaacSimVersion: "4.2",
        isaacRosVersion: "3.x",
        sensorSuite: "rgb-depth-lidar",
        captureStartedAt: "2026-05-09T20:00:00Z",
        captureEndedAt: "2026-05-09T20:05:00Z",
        captureResult: "captured telemetry, costmap, detections, and point cloud",
        deviationsOrFailures: "none"
      },
      evidence: {
        hardwareEvidencePath: ".tmp/hardware-evidence/missing-actual.json",
        rehearsalEvidencePath: ".tmp/rehearsal-evidence/missing-after.json",
        captureManifestPath: ".tmp/isaac-evidence/missing-capture.json",
        captureLogPath: ".tmp/isaac-evidence/missing-capture.log"
      },
      validation: { ok: true }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "isaac-jetson-capture")).toMatchObject({
      status: "blocked"
    });
    expect(manifest.realWorldBlockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Isaac HIL capture evidence files exist")
    ]));
  });

  it("recognizes fail-closed hardware-actuation policy review evidence when one is present", async () => {
    await mkdir(path.join(root, ".tmp/policy-evidence"), { recursive: true });
    await seedPolicyCompletionReferences(root);
    await writeFile(path.join(root, ".tmp/policy-evidence/seekr-hardware-actuation-gate-test.json"), JSON.stringify({
      status: "ready-for-human-review",
      commandUploadEnabled: false,
      scope: {
        operatorName: "Safety Operator",
        targetHardware: "jetson-orin-nano",
        vehicleIdentifier: "bench-quad-1",
        reviewers: ["Safety Lead", "Test Director"],
        reviewedAt: "2026-05-09T20:00:00Z"
      },
      authorization: {
        realAircraftCommandUpload: false,
        hardwareActuationEnabled: false,
        runtimePolicyInstalled: false
      },
      evidence: {
        candidatePolicyPath: ".tmp/policy-candidates/deny-default.json",
        acceptanceStatusPath: ".tmp/acceptance-status.json",
        hardwareEvidencePath: ".tmp/hardware-evidence/actual.json",
        hilEvidencePath: ".tmp/hil-evidence/completed.json"
      },
      validation: { ok: true }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "hardware-actuation-policy-review")).toMatchObject({
      status: "pass"
    });
    expect(manifest.realWorldBlockers).not.toEqual(expect.arrayContaining([
      expect.stringContaining("hardware-actuation policy review package")
    ]));
  });

  it("does not clear policy review blockers from a ready manifest with missing referenced evidence", async () => {
    await mkdir(path.join(root, ".tmp/policy-evidence"), { recursive: true });
    await writeFile(path.join(root, ".tmp/policy-evidence/seekr-hardware-actuation-gate-missing-references.json"), JSON.stringify({
      status: "ready-for-human-review",
      commandUploadEnabled: false,
      scope: {
        operatorName: "Safety Operator",
        targetHardware: "jetson-orin-nano",
        vehicleIdentifier: "bench-quad-1",
        reviewers: ["Safety Lead", "Test Director"],
        reviewedAt: "2026-05-09T20:00:00Z"
      },
      authorization: {
        realAircraftCommandUpload: false,
        hardwareActuationEnabled: false,
        runtimePolicyInstalled: false
      },
      evidence: {
        candidatePolicyPath: ".tmp/policy-candidates/missing.json",
        acceptanceStatusPath: ".tmp/acceptance-status.json",
        hardwareEvidencePath: ".tmp/hardware-evidence/missing-actual.json",
        hilEvidencePath: ".tmp/hil-evidence/missing-completed.json"
      },
      validation: { ok: true }
    }), "utf8");

    const manifest = await buildCompletionAudit({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(manifest.items.find((item) => item.id === "hardware-actuation-policy-review")).toMatchObject({
      status: "blocked"
    });
    expect(manifest.realWorldBlockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Hardware-actuation policy gate evidence exists")
    ]));
  });
});

async function seedRoot(root: string) {
  const releasePath = ".tmp/release-evidence/seekr-release-test.json";
  const safetyPath = ".tmp/safety-evidence/seekr-command-boundary-scan-test.json";
  const releaseChecksum = "a".repeat(64);
  const releaseFileCount = 42;
  const releaseTotalBytes = 123456;
  const scannedFileCount = 12;
  const allowedFindingCount = 3;

  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "src/server/adapters"), { recursive: true });
  await mkdir(path.join(root, ".tmp/release-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/hardware-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/bridge-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/safety-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/api-probe"), { recursive: true });
  await mkdir(path.join(root, ".tmp/overnight"), { recursive: true });

  for (const doc of [
    "README.md",
    "docs/SEEKR_GCS_ALPHA_TODO.md",
    "docs/SEEKR_COMPLETION_PLAN.md",
    "docs/FLIGHT_SOFTWARE.md",
    "docs/EDGE_HARDWARE_BENCH.md",
    "docs/HARDWARE_DECISION_GATE.md",
    "docs/V1_ACCEPTANCE.md",
    "docs/goal.md"
  ]) {
    await writeFile(path.join(root, doc), `${doc}\n`, "utf8");
  }

  await writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      check: "npm run typecheck && npm run test",
      acceptance: "npm run check",
      "bridge:mavlink": "tsx scripts/bridge-mavlink-readonly.ts",
      "bridge:mavlink:serial": "tsx scripts/bridge-mavlink-serial-readonly.ts",
      "bridge:ros2": "tsx scripts/bridge-ros2-readonly.ts",
      "bridge:ros2:live": "tsx scripts/bridge-ros2-live-readonly.ts",
      "bridge:spatial": "tsx scripts/bridge-spatial-readonly.ts",
      "bench:edge": "tsx scripts/edge-bench.ts",
      "bench:flight": "tsx scripts/flight-bench.ts",
      "bench:sitl": "tsx scripts/sitl-bench.ts",
      "bench:sitl:io": "tsx scripts/sitl-process-io.ts",
      "bench:dimos": "tsx scripts/dimos-readonly-bench.ts",
      "safety:command-boundary": "tsx scripts/command-boundary-scan.ts",
      "test:ai:local": "tsx scripts/ai-smoke.ts --require-ollama",
      "test:ui": "playwright test",
      "smoke:preview": "npm run build && npm run probe:preview",
      "release:checksum": "tsx scripts/release-checksums.ts",
      "acceptance:record": "tsx scripts/acceptance-record.ts",
      "rehearsal:evidence": "tsx scripts/rehearsal-evidence.ts",
      "rehearsal:note": "tsx scripts/rehearsal-note.ts",
      "rehearsal:closeout": "tsx scripts/rehearsal-closeout.ts",
      "hil:failsafe:evidence": "tsx scripts/hil-failsafe-evidence.ts",
      "isaac:hil:evidence": "tsx scripts/isaac-hil-capture-evidence.ts",
      "policy:hardware:gate": "tsx scripts/hardware-actuation-policy-gate.ts",
      "audit:completion": "tsx scripts/completion-audit.ts",
      "demo:package": "tsx scripts/demo-readiness-package.ts",
      "bench:evidence:packet": "tsx scripts/bench-evidence-packet.ts",
      "handoff:index": "tsx scripts/handoff-index.ts",
      "handoff:verify": "tsx scripts/handoff-verify.ts",
      "handoff:bundle": "tsx scripts/handoff-bundle.ts",
      "handoff:bundle:verify": "tsx scripts/handoff-bundle-verify.ts",
      "audit:goal": "tsx scripts/goal-audit.ts",
      "probe:api": "tsx scripts/api-probe.ts",
      "probe:hardware": "tsx scripts/hardware-probe.ts",
      "probe:hardware:archive": "tsx scripts/archive-hardware-probe.ts"
    }
  }), "utf8");

  await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
    ok: true,
    generatedAt: Date.parse("2026-05-09T19:59:00.000Z"),
    releaseChecksum: {
      jsonPath: releasePath,
      sha256Path: releasePath.replace(/\.json$/, ".sha256"),
      markdownPath: releasePath.replace(/\.json$/, ".md"),
      overallSha256: releaseChecksum,
      fileCount: releaseFileCount,
      totalBytes: releaseTotalBytes
    },
    commandBoundaryScan: {
      jsonPath: safetyPath,
      markdownPath: safetyPath.replace(/\.json$/, ".md"),
      status: "pass",
      scannedFileCount,
      violationCount: 0,
      allowedFindingCount,
      commandUploadEnabled: false
    },
    commandUploadEnabled: false
  }), "utf8");
  await writeFile(path.join(root, ".tmp/api-probe/seekr-api-probe-test.json"), JSON.stringify({
    ok: true,
    commandUploadEnabled: false,
    checked: ["config", "session-acceptance", "session-acceptance-evidence", "readiness", "hardware-readiness", "source-health", "verify", "replays", "malformed-json"],
    sessionAcceptance: {
      status: "pass",
      commandUploadEnabled: false,
      releaseChecksum: {
        overallSha256: releaseChecksum,
        fileCount: releaseFileCount,
        totalBytes: releaseTotalBytes
      },
      commandBoundaryScan: {
        status: "pass",
        scannedFileCount,
        violationCount: 0,
        allowedFindingCount
      }
    },
    validation: { ok: true, warnings: [], blockers: [] }
  }), "utf8");
  await writeFile(path.join(root, releasePath), JSON.stringify({
    commandUploadEnabled: false,
    overallSha256: releaseChecksum,
    fileCount: releaseFileCount,
    totalBytes: releaseTotalBytes
  }), "utf8");
  await writeFile(path.join(root, ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-test.json"), JSON.stringify({
    commandUploadEnabled: false,
    validation: { ok: true }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-test.json"), JSON.stringify({
    commandUploadEnabled: false,
    actualHardwareValidationComplete: false,
    hardwareValidationScope: "off-board-readiness",
    reports: [
      hardwareReport("jetson-orin-nano", "warn"),
      hardwareReport("raspberry-pi-5", "warn")
    ]
  }), "utf8");
  await writeFile(path.join(root, safetyPath), JSON.stringify({
    status: "pass",
    commandUploadEnabled: false,
    summary: {
      scannedFileCount,
      violationCount: 0,
      allowedFindingCount
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/overnight/STATUS.md"), "- Last update: 2026-05-09T19:00:00Z\n- Verdict: pass\n", "utf8");
  await writeFile(path.join(root, "src/server/adapters/mavlinkAdapter.ts"), "commandRejected('read-only');\n// read-only\n", "utf8");
  await writeFile(path.join(root, "src/server/adapters/ros2SlamAdapter.ts"), "commandRejected('read-only');\n// read-only\n", "utf8");
}

function hardwareReport(targetId: string, hostPlatformStatus: "pass" | "warn") {
  return {
    target: { id: targetId },
    checks: [
      { id: "host-platform", status: hostPlatformStatus },
      { id: "safety-boundary", status: "pass" }
    ]
  };
}

function matchedSource(sourceAdapter: string, channels: string[], eventCount: number) {
  return {
    requirement: `${sourceAdapter}:${channels.join("+")}`,
    sourceAdapter,
    channels,
    droneIds: sourceAdapter === "mavlink" ? ["drone-1"] : [],
    eventCount,
    status: "pass"
  };
}

function bridgeEvidence(mode: string, safety: Record<string, false>, listener?: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-05-09T20:30:00.000Z",
    label: `${mode}-real`,
    bridgeMode: mode,
    status: "pass",
    commandUploadEnabled: false,
    validation: { ok: true, blockers: [], warnings: [] },
    bridgeResult: {
      ok: true,
      mode,
      dryRun: false,
      commandPreview: false,
      inputCount: 4,
      acceptedCount: 4,
      postedCount: 4,
      rejected: [],
      errors: [],
      commandEndpointsTouched: false,
      listener,
      safety: {
        ...safety,
        commandUploadEnabled: false
      }
    },
    evidenceSha256: "b".repeat(64)
  };
}

async function seedHilCompletionReferences(root: string) {
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
        matchedSource("mavlink", ["telemetry"], 4),
        matchedSource("ros2-pose", ["telemetry"], 2)
      ]
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/hil-evidence/flight.log"), "link-loss failsafe triggered; manual override observed; estop verified\n", "utf8");
}

async function seedIsaacCompletionReferences(root: string) {
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
}

async function seedPolicyCompletionReferences(root: string) {
  await mkdir(path.join(root, ".tmp/policy-candidates"), { recursive: true });
  await mkdir(path.join(root, ".tmp/hardware-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/hil-evidence"), { recursive: true });
  await writeFile(path.join(root, ".tmp/policy-candidates/deny-default.json"), JSON.stringify({
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
    allowedHardwareCommands: [],
    enabledHardwareCommands: [],
    missionUploadCommandClasses: []
  }), "utf8");
  await seedHilCompletionReferences(root);
  await writeFile(path.join(root, ".tmp/hil-evidence/completed.json"), JSON.stringify({
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
      hardwareEvidencePath: ".tmp/hardware-evidence/actual.json",
      rehearsalEvidencePath: ".tmp/rehearsal-evidence/after.json",
      flightLogPath: ".tmp/hil-evidence/flight.log"
    },
    validation: { ok: true }
  }), "utf8");
}
