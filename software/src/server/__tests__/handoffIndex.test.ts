import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHandoffIndex, writeHandoffIndex } from "../../../scripts/handoff-index";

describe("handoff index", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-handoff-index-test-${process.pid}-${Date.now()}`);
    await mkdir(path.join(root, ".tmp/release-evidence"), { recursive: true });
    await mkdir(path.join(root, ".tmp/completion-audit"), { recursive: true });
    await mkdir(path.join(root, ".tmp/demo-readiness"), { recursive: true });
    await mkdir(path.join(root, ".tmp/bench-evidence-packet"), { recursive: true });
    await mkdir(path.join(root, ".tmp/hardware-evidence"), { recursive: true });
    await mkdir(path.join(root, ".tmp/policy-evidence"), { recursive: true });
    await mkdir(path.join(root, ".tmp/safety-evidence"), { recursive: true });
    await mkdir(path.join(root, ".tmp/api-probe"), { recursive: true });
    await mkdir(path.join(root, ".tmp/overnight"), { recursive: true });
    await seedHandoffEvidence(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("indexes the latest local-alpha handoff evidence chain without claiming hardware validation", async () => {
    const manifest = await buildHandoffIndex({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z",
      label: "alpha-handoff"
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      status: "ready-local-alpha-handoff",
      localAlphaOk: true,
      complete: false,
      commandUploadEnabled: false,
      safetyBoundary: {
        realAircraftCommandUpload: false,
        hardwareActuationEnabled: false,
        runtimePolicyInstalled: false
      },
      hardwareClaims: falseClaims()
    });
    expect(manifest.validation.blockers).toEqual([]);
    expect(manifest.validation.warnings).toEqual([]);
    expect(manifest.artifacts.demoReadinessJsonPath).toBe(demoPath);
    expect(manifest.artifacts.benchEvidencePacketJsonPath).toBe(benchPath);
    expect(manifest.artifactDigests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ".tmp/acceptance-status.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      }),
      expect.objectContaining({
        path: demoPath,
        sha256: await sha256(path.join(root, demoPath))
      }),
      expect.objectContaining({
        path: benchPath,
        sha256: await sha256(path.join(root, benchPath))
      })
    ]));
    expect(manifest.artifactDigests.every((digest) => digest.bytes > 0)).toBe(true);
    expect(manifest.evidenceChain.every((check) => check.status === "pass")).toBe(true);
    expect(manifest.realWorldBlockers).toEqual(blockers);
  });

  it("writes JSON and Markdown index artifacts", async () => {
    const result = await writeHandoffIndex({
      root,
      outDir: ".tmp/handoff-index",
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}handoff-index${path.sep}`);
    expect(result.markdownPath).toContain(`${path.sep}.tmp${path.sep}handoff-index${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"artifactDigests\"");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"evidenceChain\"");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR Handoff Index");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Artifact digests");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("does not validate Jetson/Pi hardware");
  });

  it("blocks when the demo package no longer points at the latest completion audit", async () => {
    await writeFile(path.join(root, ".tmp/completion-audit/seekr-completion-audit-2026-05-09T19-30-00-000Z.json"), JSON.stringify({
      commandUploadEnabled: false,
      localAlphaOk: true,
      complete: false,
      status: "blocked-real-world-evidence",
      realWorldBlockers: blockers
    }), "utf8");

    const manifest = await buildHandoffIndex({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha-handoff");
    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("completion audit path does not point at the latest audit evidence")
    ]));
    expect(manifest.commandUploadEnabled).toBe(false);
  });

  it("blocks when the bench packet source or safety boundary is unsafe", async () => {
    await writeFile(path.join(root, ".tmp/bench-evidence-packet/seekr-bench-evidence-packet-unsafe-2026-05-09T19-30-00-000Z.json"), JSON.stringify({
      status: "ready-for-bench-prep",
      localAlphaOk: true,
      complete: false,
      commandUploadEnabled: false,
      sourceDemoReadinessPackagePath: ".tmp/demo-readiness/old.json",
      validation: { ok: true, warnings: [], blockers: [] },
      safetyBoundary: {
        realAircraftCommandUpload: false,
        hardwareActuationEnabled: true,
        runtimePolicyInstalled: false
      },
      tasks: [{ id: "actual-board-hardware-evidence" }, { id: "fresh-operator-rehearsal" }]
    }), "utf8");

    const manifest = await buildHandoffIndex({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha-handoff");
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("source demo package path does not point at the latest demo package"),
      expect.stringContaining("safety boundary authorization fields are not all false")
    ]));
    expect(manifest.safetyBoundary.hardwareActuationEnabled).toBe(false);
  });

  it("blocks when acceptance status embeds a stale command-boundary scan", async () => {
    await writeFile(path.join(root, ".tmp/safety-evidence/seekr-command-boundary-scan-2026-05-09T19-30-00-000Z.json"), JSON.stringify({
      status: "pass",
      commandUploadEnabled: false,
      summary: {
        scannedFileCount: 108,
        violationCount: 0,
        allowedFindingCount: 37
      }
    }), "utf8");

    const manifest = await buildHandoffIndex({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha-handoff");
    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("acceptance status command-boundary scan path does not point at the latest safety evidence"),
      expect.stringContaining("acceptance status scanned file count does not match latest scan"),
      expect.stringContaining("acceptance status allowed finding count does not match latest scan"),
      expect.stringContaining("safety scan path does not point at the latest command-boundary evidence")
    ]));
    expect(manifest.commandUploadEnabled).toBe(false);
  });

  it("blocks when the demo package no longer points at the latest API probe evidence", async () => {
    await writeFile(path.join(root, ".tmp/api-probe/seekr-api-probe-2026-05-09T19-30-00-000Z.json"), JSON.stringify({
      ok: true,
      commandUploadEnabled: false,
      checked: ["config", "session-acceptance", "session-acceptance-evidence", "malformed-json"],
      sessionAcceptance: {
        status: "pass",
        commandUploadEnabled: false,
        releaseChecksum: {
          overallSha256: releaseChecksum,
          fileCount: 42,
          totalBytes: 123456
        },
        commandBoundaryScan: {
          status: "pass",
          scannedFileCount: 107,
          violationCount: 0,
          allowedFindingCount: 36
        }
      }
    }), "utf8");

    const manifest = await buildHandoffIndex({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha-handoff");
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("API probe path does not point at the latest API probe evidence")
    ]));
  });
});

const releasePath = ".tmp/release-evidence/seekr-release-0.2.0-2026-05-09T19-00-00-000Z.json";
const auditPath = ".tmp/completion-audit/seekr-completion-audit-2026-05-09T19-05-00-000Z.json";
const demoPath = ".tmp/demo-readiness/seekr-demo-readiness-internal-alpha-2026-05-09T19-10-00-000Z.json";
const benchPath = ".tmp/bench-evidence-packet/seekr-bench-evidence-packet-jetson-bench-2026-05-09T19-15-00-000Z.json";
const hardwarePath = ".tmp/hardware-evidence/seekr-hardware-evidence-off-board-2026-05-09T19-01-00-000Z.json";
const policyPath = ".tmp/policy-evidence/seekr-hardware-actuation-gate-blocked-2026-05-09T19-02-00-000Z.json";
const safetyPath = ".tmp/safety-evidence/seekr-command-boundary-scan-2026-05-09T19-03-00-000Z.json";
const apiProbePath = ".tmp/api-probe/seekr-api-probe-2026-05-09T19-04-00-000Z.json";
const releaseChecksum = "a".repeat(64);
const blockers = [
  "No actual Jetson/Pi hardware evidence.",
  "No real read-only MAVLink/ROS bench evidence."
];

async function seedHandoffEvidence(root: string) {
  await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
    ok: true,
    generatedAt: Date.parse("2026-05-09T19:00:00.000Z"),
    releaseChecksum: {
      overallSha256: releaseChecksum,
      fileCount: 42,
      totalBytes: 123456
    },
    commandBoundaryScan: {
      jsonPath: path.join(root, safetyPath),
      markdownPath: path.join(root, safetyPath.replace(/\.json$/, ".md")),
      status: "pass",
      scannedFileCount: 107,
      violationCount: 0,
      allowedFindingCount: 36,
      commandUploadEnabled: false
    },
    commandUploadEnabled: false
  }), "utf8");
  await writeFile(path.join(root, releasePath), JSON.stringify({
    commandUploadEnabled: false,
    overallSha256: releaseChecksum,
    fileCount: 42,
    totalBytes: 123456
  }), "utf8");
  await writeFile(path.join(root, auditPath), JSON.stringify({
    commandUploadEnabled: false,
    localAlphaOk: true,
    complete: false,
    status: "blocked-real-world-evidence",
    realWorldBlockers: blockers
  }), "utf8");
  await writeFile(path.join(root, safetyPath), JSON.stringify({
    status: "pass",
    commandUploadEnabled: false,
    summary: {
      scannedFileCount: 107,
      violationCount: 0,
      allowedFindingCount: 36
    }
  }), "utf8");
  await writeFile(path.join(root, apiProbePath), JSON.stringify({
    ok: true,
    commandUploadEnabled: false,
    checked: ["config", "session-acceptance", "session-acceptance-evidence", "readiness", "hardware-readiness", "source-health", "verify", "replays", "malformed-json"],
    sessionAcceptance: {
      status: "pass",
      commandUploadEnabled: false,
      releaseChecksum: {
        overallSha256: releaseChecksum,
        fileCount: 42,
        totalBytes: 123456
      },
      commandBoundaryScan: {
        status: "pass",
        scannedFileCount: 107,
        violationCount: 0,
        allowedFindingCount: 36
      }
    }
  }), "utf8");
  await writeFile(path.join(root, hardwarePath), JSON.stringify({
    commandUploadEnabled: false,
    actualHardwareValidationComplete: false
  }), "utf8");
  await writeFile(path.join(root, policyPath), JSON.stringify({
    commandUploadEnabled: false,
    status: "blocked",
    authorization: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/overnight/STATUS.md"), "- Last update: 2026-05-09T19:30:00Z\n- Cycle: 12\n- Verdict: pass\n", "utf8");
  await writeFile(path.join(root, demoPath), JSON.stringify({
    generatedAt: "2026-05-09T19:10:00.000Z",
    status: "ready-local-alpha",
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    artifacts: {
      acceptanceStatusPath: ".tmp/acceptance-status.json",
      releaseEvidenceJsonPath: releasePath,
      completionAuditJsonPath: auditPath,
      safetyScanJsonPath: safetyPath,
      apiProbeJsonPath: apiProbePath,
      hardwareEvidenceJsonPath: hardwarePath,
      policyGateJsonPath: policyPath,
      overnightStatusPath: ".tmp/overnight/STATUS.md"
    },
    validation: { ok: true, warnings: [], blockers: [] },
    releaseChecksum: {
      overallSha256: releaseChecksum,
      fileCount: 42,
      totalBytes: 123456
    },
    hardwareClaims: falseClaims(),
    realWorldBlockers: blockers,
    nextEvidenceChecklist: [
      { id: "actual-board-hardware-evidence" },
      { id: "fresh-operator-rehearsal" }
    ]
  }), "utf8");
  await writeFile(path.join(root, benchPath), JSON.stringify({
    status: "ready-for-bench-prep",
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    sourceDemoReadinessPackagePath: demoPath,
    validation: { ok: true, warnings: [], blockers: [] },
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    tasks: [
      { id: "actual-board-hardware-evidence" },
      { id: "fresh-operator-rehearsal" }
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

async function sha256(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
