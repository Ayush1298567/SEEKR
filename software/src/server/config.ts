import path from "node:path";
import { SEEKR_SCHEMA_VERSION, SEEKR_SOFTWARE_VERSION } from "../shared/constants";
import type { RuntimeConfig } from "../shared/types";
import { internalAuthEnabled } from "./api/auth";
import { loadLocalEnv } from "./env";
import type { MissionPersistence } from "./persistence";
import { configuredExpectedSources, configuredStaleSourceMs } from "./sourceHealth";
import type { MissionStore } from "./state";

loadLocalEnv();

export function buildRuntimeConfig(
  store: MissionStore,
  persistence: MissionPersistence,
  generatedAt = Date.now()
): RuntimeConfig {
  const state = store.snapshot();
  const expectedSources = configuredExpectedSources();
  const authEnabled = internalAuthEnabled();
  const warnings: string[] = [];

  if (!authEnabled) {
    warnings.push("SEEKR_INTERNAL_TOKEN is not set; mutating API routes are open for local development.");
  }
  if (!expectedSources.length) {
    warnings.push("SEEKR_EXPECTED_SOURCES is not set; source health cannot warn about missing rehearsal adapters before first ingest.");
  }

  return {
    ok: warnings.length === 0,
    generatedAt,
    schemaVersion: SEEKR_SCHEMA_VERSION,
    softwareVersion: SEEKR_SOFTWARE_VERSION,
    missionId: state.missionId,
    stateSeq: state.stateSeq,
    server: {
      bindHost: "127.0.0.1",
      apiPort: String(process.env.PORT ?? 8787),
      clientPort: String(process.env.SEEKR_CLIENT_PORT ?? 5173),
      nodeVersion: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      dataDir: persistence.root
    },
    storage: {
      eventLogPath: path.join(persistence.root, "mission-events.ndjson"),
      replayDir: path.join(persistence.root, "replays"),
      latestSnapshotPath: path.join(persistence.root, "latest-state.json")
    },
    ai: {
      provider: process.env.SEEKR_AI_PROVIDER ?? "ollama",
      ollamaModel: process.env.SEEKR_OLLAMA_MODEL ?? "llama3.2:latest",
      ollamaUrlConfigured: Boolean(process.env.SEEKR_OLLAMA_URL)
    },
    auth: {
      internalAuthEnabled: authEnabled,
      tokenConfigured: authEnabled,
      tokenRedacted: true
    },
    expectedSources,
    sourceHealth: {
      staleThresholdMs: configuredStaleSourceMs(),
      expectedSourcesConfigured: expectedSources.length > 0
    },
    safety: {
      commandUploadEnabled: false,
      realAdaptersReadOnly: true,
      blockedCommandClasses: ["MAVLink mission upload", "MAVLink hold", "MAVLink return-home", "ROS 2 mission upload", "ROS 2 hold", "ROS 2 return-home", "aircraft geofence upload"]
    },
    warnings
  };
}
