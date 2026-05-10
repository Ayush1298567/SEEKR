import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHardwareEvidenceArchive, writeHardwareEvidenceArchive } from "../../../scripts/archive-hardware-probe";
import type { HardwareReadinessReport } from "../../shared/types";

describe("hardware evidence archive", () => {
  let root: string;

  beforeEach(() => {
    root = path.join(os.tmpdir(), `seekr-hardware-evidence-archive-test-${process.pid}-${Date.now()}`);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("marks off-board readiness archives as not actual hardware validation", () => {
    const archive = createHardwareEvidenceArchive([
      report("jetson-orin-nano", "warn"),
      report("raspberry-pi-5", "warn")
    ], ["jetson-orin-nano", "raspberry-pi-5"], {
      archivedAt: 1_800_000_000_000,
      cwd: root
    });

    expect(archive).toMatchObject({
      ok: true,
      commandUploadEnabled: false,
      actualHardwareValidationComplete: false,
      hardwareValidationScope: "off-board-readiness",
      actualTargetHostValidated: {
        "jetson-orin-nano": false,
        "raspberry-pi-5": false
      }
    });
    expect(archive.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining("must not be cited as actual Jetson/Pi hardware validation")
    ]));
  });

  it("marks actual-target archives only when every target host-platform check passes", () => {
    const archive = createHardwareEvidenceArchive([
      report("jetson-orin-nano", "pass"),
      report("raspberry-pi-5", "pass")
    ], ["jetson-orin-nano", "raspberry-pi-5"], {
      archivedAt: 1_800_000_000_000,
      cwd: root
    });

    expect(archive.actualHardwareValidationComplete).toBe(true);
    expect(archive.hardwareValidationScope).toBe("actual-target");
    expect(archive.commandUploadEnabled).toBe(false);
  });

  it("writes JSON and Markdown with explicit validation scope", async () => {
    const result = await writeHardwareEvidenceArchive({
      root,
      outDir: ".tmp/hardware-evidence",
      targets: ["jetson-orin-nano"],
      archivedAt: 1_800_000_000_000
    });

    expect(result.archive.commandUploadEnabled).toBe(false);
    expect(result.archive.actualHardwareValidationComplete).toBe(false);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"hardwareValidationScope\": \"off-board-readiness\"");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Actual hardware validation complete: false");
    expect(path.basename(result.jsonPath)).toContain("seekr-hardware-evidence-jetson-orin-nano-");
  });

  it("does not create a completed archive from empty or mismatched target inputs", () => {
    expect(() => createHardwareEvidenceArchive([], [], {
      archivedAt: 1_800_000_000_000,
      cwd: root
    })).toThrow("at least one hardware target");

    expect(() => createHardwareEvidenceArchive([], ["jetson-orin-nano"], {
      archivedAt: 1_800_000_000_000,
      cwd: root
    })).toThrow("at least one hardware readiness report");

    expect(() => createHardwareEvidenceArchive([
      report("jetson-orin-nano", "pass")
    ], ["raspberry-pi-5"], {
      archivedAt: 1_800_000_000_000,
      cwd: root
    })).toThrow("missing a readiness report for target raspberry-pi-5");
  });

  it("rejects invalid target and archive timestamp inputs", () => {
    expect(() => createHardwareEvidenceArchive([
      report("jetson-orin-nano", "pass")
    ], ["jetson/../escape" as never], {
      archivedAt: 1_800_000_000_000,
      cwd: root
    })).toThrow("target must be jetson-orin-nano or raspberry-pi-5");

    expect(() => createHardwareEvidenceArchive([
      report("jetson-orin-nano", "pass")
    ], ["jetson-orin-nano"], {
      archivedAt: Number.NaN,
      cwd: root
    })).toThrow("archivedAt must be a finite timestamp");
  });
});

function report(targetId: "jetson-orin-nano" | "raspberry-pi-5", hostPlatformStatus: "pass" | "warn"): HardwareReadinessReport {
  return {
    ok: true,
    generatedAt: 1_800_000_000_000,
    target: {
      id: targetId,
      label: targetId === "jetson-orin-nano" ? "NVIDIA Jetson Orin Nano" : "Raspberry Pi 5",
      role: "test",
      recommendedOs: "test",
      rosDistro: "test",
      isaacSupport: targetId === "jetson-orin-nano" ? "recommended" : "bridge-only",
      minimumMemoryGb: 7.5,
      recommendedFreeDiskGb: 16,
      notes: []
    },
    host: {
      platform: hostPlatformStatus === "pass" ? "linux" : "darwin",
      arch: "arm64",
      nodeVersion: "v25.0.0",
      cpuCount: 4,
      totalMemoryGb: 8,
      freeDiskGb: 100
    },
    checks: [
      {
        id: "host-platform",
        label: "Host platform",
        status: hostPlatformStatus,
        details: "test host platform",
        blocking: false
      },
      {
        id: "safety-boundary",
        label: "Safety boundary",
        status: "pass",
        details: "commands reject",
        blocking: true
      }
    ],
    summary: {
      pass: 2,
      warn: hostPlatformStatus === "warn" ? 1 : 0,
      fail: 0,
      blocking: 0,
      commandUploadEnabled: false,
      expectedSourcesConfigured: true,
      missingTools: [],
      recommendedNextCommand: "npm run probe:hardware"
    },
    safetyNotes: [
      "Real MAVLink/ROS 2 command upload remains blocked."
    ]
  };
}
