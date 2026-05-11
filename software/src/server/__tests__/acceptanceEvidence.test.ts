import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAcceptanceEvidence, REQUIRED_ACCEPTANCE_COMMANDS, writeAcceptanceStatus, type AcceptanceRunStatus } from "../acceptanceEvidence";
import { REQUIRED_STRICT_AI_SMOKE_CASES } from "../ai/localAiEvidence";
import { SEEKR_SCHEMA_VERSION, SEEKR_SOFTWARE_VERSION } from "../../shared/constants";

describe("acceptance evidence", () => {
  let root: string;
  let statusPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "seekr-acceptance-evidence-"));
    statusPath = path.join(root, "acceptance-status.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports missing acceptance status without enabling command upload", () => {
    expect(readAcceptanceEvidence(1_800_000_000_000, 1_800_000_000_000, statusPath)).toMatchObject({
      ok: false,
      status: "missing",
      currentBoot: false,
      commandUploadEnabled: false
    });
  });

  it("accepts a recent complete status and marks whether it belongs to the current boot", () => {
    writeAcceptanceStatus(status({ generatedAt: 1_800_000_000_000 }), statusPath);

    expect(readAcceptanceEvidence(1_800_000_001_000, 1_799_999_999_000, statusPath)).toMatchObject({
      ok: true,
      status: "pass",
      currentBoot: true,
      commandCount: REQUIRED_ACCEPTANCE_COMMANDS.length,
      commandUploadEnabled: false,
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest",
        caseCount: REQUIRED_STRICT_AI_SMOKE_CASES.length,
        caseNames: [...REQUIRED_STRICT_AI_SMOKE_CASES]
      },
      releaseChecksum: { overallSha256: expect.stringMatching(/^[a-f0-9]{64}$/), fileCount: 10, totalBytes: 1024 },
      commandBoundaryScan: {
        status: "pass",
        scannedFileCount: 109,
        violationCount: 0,
        allowedFindingCount: 36
      }
    });
    expect(readAcceptanceEvidence(1_800_000_001_000, 1_800_000_000_500, statusPath)).toMatchObject({
      ok: true,
      status: "pass",
      currentBoot: false
    });
  });

  it("rejects stale, software-mismatched, incomplete, and unsafe status files", () => {
    writeAcceptanceStatus(status({ generatedAt: 1_800_000_000_000 }), statusPath);
    expect(readAcceptanceEvidence(1_800_050_000_000, 1_799_999_999_000, statusPath)).toMatchObject({ ok: false, status: "stale" });

    writeAcceptanceStatus(status({ softwareVersion: "old" }), statusPath);
    expect(readAcceptanceEvidence(1_800_000_001_000, 1_799_999_999_000, statusPath)).toMatchObject({ ok: false, status: "software-mismatch" });

    writeAcceptanceStatus(status({ completedCommands: REQUIRED_ACCEPTANCE_COMMANDS.slice(0, -1) }), statusPath);
    expect(readAcceptanceEvidence(1_800_000_001_000, 1_799_999_999_000, statusPath)).toMatchObject({ ok: false, status: "incomplete" });

    writeAcceptanceStatus(status({
      strictLocalAi: {
        ...status({}).strictLocalAi,
        caseNames: REQUIRED_STRICT_AI_SMOKE_CASES.filter((name) => name !== "prompt-injection-spatial-metadata")
      }
    }), statusPath);
    expect(readAcceptanceEvidence(1_800_000_001_000, 1_799_999_999_000, statusPath)).toMatchObject({
      ok: false,
      status: "incomplete",
      reason: expect.stringContaining("prompt-injection-spatial-metadata")
    });

    writeAcceptanceStatus({
      ...status({}),
      safetyBoundary: { realHardwareCommandUpload: "blocked", mavlink: "read-only", ros2: "read-only", px4ArdupilotHardwareTransport: "enabled" as never }
    }, statusPath);
    expect(readAcceptanceEvidence(1_800_000_001_000, 1_799_999_999_000, statusPath)).toMatchObject({ ok: false, status: "unsafe" });

    writeAcceptanceStatus({
      ...status({}),
      commandBoundaryScan: { ...status({}).commandBoundaryScan, status: "fail" as never, violationCount: 1 as never }
    }, statusPath);
    expect(readAcceptanceEvidence(1_800_000_001_000, 1_799_999_999_000, statusPath)).toMatchObject({ ok: false, status: "unsafe" });
  });
});

function status(overrides: Partial<AcceptanceRunStatus>): AcceptanceRunStatus {
  return {
    ok: true,
    generatedAt: 1_800_000_000_000,
    schemaVersion: SEEKR_SCHEMA_VERSION,
    softwareVersion: SEEKR_SOFTWARE_VERSION,
    cwd: "/tmp/seekr",
    nodeVersion: "v25.0.0",
    platform: "darwin",
    pid: 123,
    completedCommands: REQUIRED_ACCEPTANCE_COMMANDS,
    strictLocalAi: {
      ok: true,
      provider: "ollama",
      model: "llama3.2:latest",
      caseCount: REQUIRED_STRICT_AI_SMOKE_CASES.length,
      caseNames: [...REQUIRED_STRICT_AI_SMOKE_CASES],
      generatedAt: 1_800_000_000_000
    },
    releaseChecksum: {
      jsonPath: ".tmp/release-evidence/release.json",
      sha256Path: ".tmp/release-evidence/release.sha256",
      markdownPath: ".tmp/release-evidence/release.md",
      overallSha256: "a".repeat(64),
      fileCount: 10,
      totalBytes: 1024
    },
    commandBoundaryScan: {
      jsonPath: ".tmp/safety-evidence/scan.json",
      markdownPath: ".tmp/safety-evidence/scan.md",
      status: "pass",
      scannedFileCount: 109,
      violationCount: 0,
      allowedFindingCount: 36,
      commandUploadEnabled: false
    },
    commandUploadEnabled: false,
    safetyBoundary: {
      realHardwareCommandUpload: "blocked",
      mavlink: "read-only",
      ros2: "read-only",
      px4ArdupilotHardwareTransport: "blocked"
    },
    ...overrides
  };
}
