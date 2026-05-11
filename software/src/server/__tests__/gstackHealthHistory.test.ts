import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGstackHealthHistoryEntry, writeGstackHealthHistoryEntry } from "../../../scripts/gstack-health-history";

describe("gstack health history recorder", () => {
  let root: string;
  let outPath: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-gstack-health-history-${process.pid}-${Date.now()}`);
    outPath = path.join(root, ".gstack/projects/software/health-history.jsonl");
    await mkdir(path.join(root, ".tmp"), { recursive: true });
    await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
      ok: true,
      generatedAt: Date.parse("2026-05-11T10:42:00.000Z"),
      commandUploadEnabled: false,
      releaseChecksum: {
        overallSha256: "abc123",
        fileCount: 259,
        totalBytes: 1024
      }
    }), "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a parser-compatible gstack health-history JSONL entry", async () => {
    const result = await writeGstackHealthHistoryEntry({
      root,
      outPath,
      generatedAt: "2026-05-11T10:43:00.000Z",
      durationSeconds: 12
    });

    expect(result).toMatchObject({
      ok: true,
      status: "pass",
      commandUploadEnabled: false
    });
    const lines = (await readFile(outPath, "utf8")).trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      timestamp: "2026-05-11T10:43:00.000Z",
      status: "pass",
      score: 10,
      typecheck: 10,
      test: 10,
      commandUploadEnabled: false,
      duration_s: 12
    });
    expect(entry.notes).toContain("release checksum abc123");
    expect(entry.notes).toContain("commandUploadEnabled false");
  });

  it("appends entries instead of replacing existing health history", async () => {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify({ timestamp: "2026-05-11T10:00:00.000Z", score: 9 })}\n`, "utf8");

    await writeGstackHealthHistoryEntry({
      root,
      outPath,
      generatedAt: "2026-05-11T10:43:00.000Z"
    });

    const lines = (await readFile(outPath, "utf8")).trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toMatchObject({
      timestamp: "2026-05-11T10:43:00.000Z",
      score: 10
    });
  });

  it("refuses to record health history if acceptance reports command upload enabled", async () => {
    await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
      ok: true,
      commandUploadEnabled: true
    }), "utf8");

    await expect(buildGstackHealthHistoryEntry({
      root,
      generatedAt: "2026-05-11T10:43:00.000Z"
    })).rejects.toThrow("commandUploadEnabled true");
  });
});
