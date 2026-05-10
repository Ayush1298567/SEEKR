import express from "express";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { jsonBodyErrorHandler } from "../src/server/api/errors";
import { createApiRouter } from "../src/server/api/routes";
import { MissionPersistence } from "../src/server/persistence";
import { MissionStore } from "../src/server/state";
import type { ReplayManifest, SourceHealthReport } from "../src/shared/types";

const previousProvider = process.env.SEEKR_AI_PROVIDER;
const previousExpectedSources = process.env.SEEKR_EXPECTED_SOURCES;
process.env.SEEKR_AI_PROVIDER = process.env.SEEKR_AI_PROVIDER ?? "rules";
process.env.SEEKR_EXPECTED_SOURCES = process.env.SEEKR_EXPECTED_SOURCES ??
  "dimos-readonly:telemetry:drone-1,dimos-readonly:slam,dimos-readonly:lidar,dimos-readonly:perception,dimos-readonly:costmap";

const context = await startBenchServer();

try {
  const imported = await api<{ ok: boolean; summary: { rejected: unknown[]; counts: Record<string, number> } }>("/api/import/fixtures/dimos-replay", { method: "POST" });
  const sourceHealth = await api<SourceHealthReport>("/api/source-health");
  const state = await api<{ missionId: string; commandLifecycles: unknown[]; spatialAssets: unknown[]; detections: unknown[] }>("/api/state");
  const manifest = await api<ReplayManifest>(`/api/missions/${state.missionId}/export`);
  const replayVerify = await api<{ integrity: { ok: boolean; errors: string[] } }>(`/api/replays/${manifest.replayId}/verify`);
  const verify = await api<{ ok: boolean; eventCount: number; errors: string[] }>("/api/verify");
  const dimosSource = sourceHealth.sources.find((source) => source.id === "dimos-readonly");
  const requiredChannels = ["telemetry", "map", "detection", "spatial", "lidar", "slam", "costmap", "perception"];
  const ok = Boolean(
    imported.ok &&
    dimosSource &&
    requiredChannels.every((channel) => (dimosSource.channels as string[]).includes(channel)) &&
    state.commandLifecycles.length === 0 &&
    state.spatialAssets.length > 0 &&
    state.detections.length > 0 &&
    replayVerify.integrity.ok &&
    verify.ok
  );

  console.log(JSON.stringify({
    ok,
    mode: "dimos-readonly-replay-contract",
    imported: imported.summary,
    source: dimosSource,
    replay: { replayId: manifest.replayId, eventCount: manifest.eventCount, integrity: replayVerify.integrity },
    verify,
    commandLifecycles: state.commandLifecycles.length,
    safety: {
      commandUploadEnabled: false,
      note: "DimOS is consumed as read-only exported telemetry/map/detection/spatial evidence; no agent movement skill is invoked."
    }
  }, null, 2));

  if (!ok) process.exitCode = 1;
} finally {
  await context.close();
  restoreEnv("SEEKR_AI_PROVIDER", previousProvider);
  restoreEnv("SEEKR_EXPECTED_SOURCES", previousExpectedSources);
}

async function startBenchServer() {
  const root = await mkdtemp(path.join(os.tmpdir(), "seekr-dimos-bench-"));
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(jsonBodyErrorHandler);
  const server = http.createServer(app);
  const persistence = new MissionPersistence(root);
  await persistence.init();
  const store = new MissionStore({ clock: () => 1_800_000_000_000, eventStore: persistence.events });
  store.onEvent((event) => {
    void persistence.events.persistEvent(event);
  });
  app.use("/api", createApiRouter(store, persistence));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await persistence.events.flush();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function api<T>(route: string, init?: RequestInit) {
  const response = await fetch(`${context.url}${route}`, init);
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
