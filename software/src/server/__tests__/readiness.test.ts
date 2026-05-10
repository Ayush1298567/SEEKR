import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeStrictAiSmokeStatus } from "../ai/localAiEvidence";
import { MissionPersistence } from "../persistence";
import { buildReadinessReport } from "../readiness";
import { SEEKR_SOFTWARE_VERSION } from "../../shared/constants";
import { MissionStore } from "../state";

const fixedClock = () => 1_800_000_000_000;

describe("readiness reports", () => {
  const previousProvider = process.env.SEEKR_AI_PROVIDER;
  const previousAiSmokeStatusPath = process.env.SEEKR_AI_SMOKE_STATUS_PATH;

  beforeEach(() => {
    process.env.SEEKR_AI_PROVIDER = "rules";
    process.env.SEEKR_AI_SMOKE_STATUS_PATH = path.join(os.tmpdir(), `seekr-ai-smoke-missing-${process.pid}.json`);
  });

  afterEach(() => {
    if (previousProvider === undefined) delete process.env.SEEKR_AI_PROVIDER;
    else process.env.SEEKR_AI_PROVIDER = previousProvider;
    if (previousAiSmokeStatusPath === undefined) delete process.env.SEEKR_AI_SMOKE_STATUS_PATH;
    else process.env.SEEKR_AI_SMOKE_STATUS_PATH = previousAiSmokeStatusPath;
  });

  it("passes core safety and hash checks on clean state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-readiness-clean-"));
    try {
      const persistence = new MissionPersistence(root);
      await persistence.init();
      const store = new MissionStore({ clock: fixedClock, eventStore: persistence.events });
      const beforeEvents = store.allEvents().length;

      const report = await buildReadinessReport(store, persistence, fixedClock());

      expect(report.ok).toBe(true);
      expect(report.summary.eventCount).toBe(0);
      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "hash-chain", status: "pass", blocking: true }),
        expect.objectContaining({ id: "report-export", status: "pass", blocking: true }),
        expect.objectContaining({ id: "incident-log", status: "pass", blocking: true }),
        expect.objectContaining({ id: "fixture-ingest", status: "pass", blocking: true }),
        expect.objectContaining({ id: "source-health", status: "pass", blocking: false }),
        expect.objectContaining({ id: "runtime-config", status: "warn", blocking: false }),
        expect.objectContaining({ id: "local-ai-strict-smoke", status: "warn", blocking: false }),
        expect.objectContaining({ id: "safety-boundary", status: "pass", blocking: true }),
        expect.objectContaining({ id: "open-blockers", status: "pass" })
      ]));
      expect(report.summary.sourceHealth).toMatchObject({ ok: true, sourceCount: 0, staleSourceIds: [] });
      expect(report.summary.configWarnings).toEqual(expect.arrayContaining([expect.stringContaining("SEEKR_EXPECTED_SOURCES")]));
      expect(store.allEvents()).toHaveLength(beforeEvents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("flags missing replay export as a nonblocking warning", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-readiness-replay-warn-"));
    try {
      const persistence = new MissionPersistence(root);
      await persistence.init();
      const store = new MissionStore({ clock: fixedClock, eventStore: persistence.events });

      const report = await buildReadinessReport(store, persistence, fixedClock());
      const replayCheck = report.checks.find((check) => check.id === "persisted-replay");

      expect(report.ok).toBe(true);
      expect(replayCheck).toMatchObject({ status: "warn", blocking: false });
      expect(report.summary.blocking).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("includes local AI status and stays read-only after replay export", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-readiness-readonly-"));
    try {
      const persistence = new MissionPersistence(root);
      await persistence.init();
      const store = new MissionStore({ clock: fixedClock, eventStore: persistence.events });
      store.start();
      const beforeEvents = store.allEvents().length;
      const beforeStateSeq = store.snapshot().stateSeq;

      await persistence.exportBundle(store.snapshot(), store.allEvents());
      const report = await buildReadinessReport(store, persistence, fixedClock());

      expect(report.summary.ai).toMatchObject({ provider: "local-rule-engine", model: "deterministic-v1", ok: false });
      expect(report.checks.find((check) => check.id === "local-ai")).toMatchObject({ status: "warn", blocking: false });
      expect(report.checks.find((check) => check.id === "local-ai-strict-smoke")).toMatchObject({
        status: "warn",
        details: expect.stringContaining("Strict local AI smoke")
      });
      expect(report.checks.find((check) => check.id === "persisted-replay")).toMatchObject({ status: "pass" });
      expect(store.allEvents()).toHaveLength(beforeEvents);
      expect(store.snapshot().stateSeq).toBe(beforeStateSeq);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes strict local AI smoke evidence when the current Ollama smoke marker is present", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-readiness-ai-smoke-"));
    try {
      const statusPath = path.join(root, "ai-smoke-status.json");
      process.env.SEEKR_AI_SMOKE_STATUS_PATH = statusPath;
      await writeStrictAiSmokeStatus({
        ok: true,
        generatedAt: fixedClock(),
        softwareVersion: SEEKR_SOFTWARE_VERSION,
        provider: "ollama",
        model: "llama3.2:latest",
        requireOllama: true,
        caseCount: 1,
        cases: [{ name: "baseline", provider: "ollama", model: "llama3.2:latest", elapsedMs: 1, mutatedWhileThinking: false }]
      }, statusPath);

      const persistence = new MissionPersistence(root);
      await persistence.init();
      const store = new MissionStore({ clock: fixedClock, eventStore: persistence.events });
      const report = await buildReadinessReport(store, persistence, fixedClock());

      expect(report.checks.find((check) => check.id === "local-ai-strict-smoke")).toMatchObject({ status: "pass", blocking: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
