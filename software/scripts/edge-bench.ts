import express from "express";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { jsonBodyErrorHandler } from "../src/server/api/errors";
import { createApiRouter } from "../src/server/api/routes";
import { runMavlinkReadOnlyBridge, runRos2ReadOnlyBridge, runSpatialReadOnlyBridge } from "../src/server/bridges/readOnlyBridge";
import { parseHardwareTarget } from "../src/server/hardwareReadiness";
import { MissionPersistence } from "../src/server/persistence";
import { MissionStore } from "../src/server/state";
import type { HardwareReadinessReport, ReadinessReport, ReplayManifest, SourceHealthReport } from "../src/shared/types";

const args = parseArgs(process.argv.slice(2));
const target = parseHardwareTarget(args.target);
const previousProvider = process.env.SEEKR_AI_PROVIDER;
const previousExpectedSources = process.env.SEEKR_EXPECTED_SOURCES;
const previousStaleMs = process.env.SEEKR_SOURCE_STALE_MS;
const previousInternalToken = process.env.SEEKR_INTERNAL_TOKEN;

process.env.SEEKR_AI_PROVIDER = process.env.SEEKR_AI_PROVIDER ?? "rules";
process.env.SEEKR_EXPECTED_SOURCES = process.env.SEEKR_EXPECTED_SOURCES ??
  "mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception";
process.env.SEEKR_SOURCE_STALE_MS = process.env.SEEKR_SOURCE_STALE_MS ?? "180000";
if (!args.auth) delete process.env.SEEKR_INTERNAL_TOKEN;

const context = await startBenchServer();

try {
  const mavlink = await runMavlinkReadOnlyBridge({
    baseUrl: context.url,
    fixtureNames: ["heartbeat", "battery-status", "local-position-ned", "estimator-status", "radio-status"],
    internalToken: args.auth ? String(process.env.SEEKR_INTERNAL_TOKEN) : undefined,
    receivedAt: 1_800_000_000_000
  });
  const ros2 = await runRos2ReadOnlyBridge({
    baseUrl: context.url,
    fixtureNames: ["occupancy-grid", "nvblox-costmap", "detection:evidence-linked-detection", "spatial:lidar-point-cloud"],
    internalToken: args.auth ? String(process.env.SEEKR_INTERNAL_TOKEN) : undefined,
    receivedAt: 1_800_000_001_000,
    missionId: "seekr-local-v1"
  });
  const spatial = await runSpatialReadOnlyBridge({
    baseUrl: context.url,
    fixtureNames: ["lidar-point-cloud"],
    internalToken: args.auth ? String(process.env.SEEKR_INTERNAL_TOKEN) : undefined
  });

  const state = await api<{ missionId: string; commandLifecycles: unknown[] }>("/api/state");
  const sourceHealth = await api<SourceHealthReport>("/api/source-health");
  const hardware = await api<HardwareReadinessReport>(`/api/hardware-readiness?target=${target}`);
  const readinessBeforeExport = await api<ReadinessReport>("/api/readiness");
  const manifest = await api<ReplayManifest>(`/api/missions/${state.missionId}/export`);
  const replayVerify = await api<{ integrity: { ok: boolean; errors: string[] } }>(`/api/replays/${manifest.replayId}/verify`);
  const verify = await api<{ ok: boolean; eventCount: number; errors: string[] }>("/api/verify");

  const ok =
    mavlink.ok &&
    ros2.ok &&
    spatial.ok &&
    hardware.ok &&
    readinessBeforeExport.ok &&
    replayVerify.integrity.ok &&
    verify.ok &&
    state.commandLifecycles.length === 0 &&
    sourceHealth.sources.some((source) => source.id === "mavlink") &&
    sourceHealth.sources.some((source) => source.id === "ros2-slam") &&
    sourceHealth.sources.some((source) => source.id === "lidar-slam" && source.channels.includes("lidar")) &&
    sourceHealth.sources.some((source) => source.id === "isaac-nvblox" && source.channels.includes("costmap"));

  console.log(JSON.stringify({
    ok,
    target,
    bridges: { mavlink, ros2, spatial },
    sourceHealth: sourceHealth.summary,
    hardware: hardware.summary,
    readinessBeforeExport: readinessBeforeExport.summary,
    replay: { replayId: manifest.replayId, eventCount: manifest.eventCount, integrity: replayVerify.integrity },
    verify,
    commandLifecycles: state.commandLifecycles.length,
    safety: {
      commandUploadEnabled: hardware.summary.commandUploadEnabled,
      commandEndpointsTouched: mavlink.commandEndpointsTouched || ros2.commandEndpointsTouched || spatial.commandEndpointsTouched
    }
  }, null, 2));

  if (!ok) process.exitCode = 1;
} finally {
  await context.close();
  restoreEnv("SEEKR_AI_PROVIDER", previousProvider);
  restoreEnv("SEEKR_EXPECTED_SOURCES", previousExpectedSources);
  restoreEnv("SEEKR_SOURCE_STALE_MS", previousStaleMs);
  restoreEnv("SEEKR_INTERNAL_TOKEN", previousInternalToken);
}

async function startBenchServer() {
  const root = await mkdtemp(path.join(os.tmpdir(), "seekr-edge-bench-"));
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

async function api<T>(route: string) {
  const response = await fetch(`${context.url}${route}`);
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function parseArgs(values: string[]) {
  const parsed: Record<string, string | boolean | undefined> = {};
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (typeof inlineValue === "string") parsed[rawKey] = inlineValue;
    else if (values[index + 1] && !values[index + 1].startsWith("--")) parsed[rawKey] = values[++index];
    else parsed[rawKey] = true;
  }
  return parsed;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
