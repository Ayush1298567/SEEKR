import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runApiProbe } from "../../../scripts/api-probe";
import { REQUIRED_ACCEPTANCE_COMMANDS, writeAcceptanceStatus } from "../acceptanceEvidence";
import { SEEKR_SCHEMA_VERSION, SEEKR_SOFTWARE_VERSION } from "../../shared/constants";

describe("api probe evidence", () => {
  let root: string;
  let previousAcceptanceStatusPath: string | undefined;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-api-probe-test-${process.pid}-${Date.now()}`);
    previousAcceptanceStatusPath = process.env.SEEKR_ACCEPTANCE_STATUS_PATH;
    process.env.SEEKR_ACCEPTANCE_STATUS_PATH = path.join(root, ".tmp/acceptance-status.json");
    await mkdir(path.join(root, ".tmp"), { recursive: true });
  });

  afterEach(async () => {
    if (previousAcceptanceStatusPath === undefined) delete process.env.SEEKR_ACCEPTANCE_STATUS_PATH;
    else process.env.SEEKR_ACCEPTANCE_STATUS_PATH = previousAcceptanceStatusPath;
    await rm(root, { recursive: true, force: true });
  });

  it("writes JSON and Markdown evidence for the local API surface", async () => {
    const result = await runApiProbe({
      root,
      generatedAt: "2026-05-09T20:30:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}api-probe${path.sep}`);
    expect(result.markdownPath).toContain(`${path.sep}.tmp${path.sep}api-probe${path.sep}`);
    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      ok: true,
      commandUploadEnabled: false,
      checked: expect.arrayContaining(["session-acceptance-evidence", "malformed-json"]),
      sessionAcceptance: {
        status: "missing",
        commandUploadEnabled: false
      },
      hardwareReadiness: {
        commandUploadEnabled: false,
        blocking: 0
      },
      validation: { ok: true, blockers: [], warnings: [] }
    });
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR API Probe Evidence");
  });

  it("persists passing session-visible acceptance checksum and command-boundary summaries", async () => {
    writeAcceptanceStatus({
      ok: true,
      generatedAt: Date.now(),
      schemaVersion: SEEKR_SCHEMA_VERSION,
      softwareVersion: SEEKR_SOFTWARE_VERSION,
      cwd: root,
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
      completedCommands: REQUIRED_ACCEPTANCE_COMMANDS,
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest",
        caseCount: 4,
        generatedAt: Date.now()
      },
      releaseChecksum: {
        jsonPath: ".tmp/release-evidence/release.json",
        sha256Path: ".tmp/release-evidence/release.sha256",
        markdownPath: ".tmp/release-evidence/release.md",
        overallSha256: "b".repeat(64),
        fileCount: 221,
        totalBytes: 4_949_662
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
      }
    });

    const result = await runApiProbe({
      root,
      generatedAt: "2026-05-09T20:31:00.000Z"
    });

    expect(result.manifest.sessionAcceptance).toMatchObject({
      status: "pass",
      commandUploadEnabled: false,
      releaseChecksum: {
        overallSha256: "b".repeat(64),
        fileCount: 221,
        totalBytes: 4_949_662
      },
      commandBoundaryScan: {
        status: "pass",
        scannedFileCount: 109,
        violationCount: 0,
        allowedFindingCount: 36
      }
    });
  });
});
