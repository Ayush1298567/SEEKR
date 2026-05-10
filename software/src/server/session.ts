import { SEEKR_SCHEMA_VERSION, SEEKR_SOFTWARE_VERSION } from "../shared/constants";
import type { SessionManifest } from "../shared/types";
import { readAcceptanceEvidence } from "./acceptanceEvidence";
import { internalAuthEnabled } from "./api/auth";
import { loadLocalEnv } from "./env";
import type { MissionPersistence } from "./persistence";
import type { MissionStore } from "./state";

loadLocalEnv();

const BOOTED_AT = Date.now();

export function buildSessionManifest(
  store: MissionStore,
  persistence: MissionPersistence,
  generatedAt = Date.now()
): SessionManifest {
  return {
    ok: true,
    generatedAt,
    bootedAt: BOOTED_AT,
    uptimeMs: Math.max(0, generatedAt - BOOTED_AT),
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    dataDir: persistence.root,
    schemaVersion: SEEKR_SCHEMA_VERSION,
    softwareVersion: SEEKR_SOFTWARE_VERSION,
    missionId: store.snapshot().missionId,
    stateSeq: store.snapshot().stateSeq,
    eventCount: store.allEvents().length,
    replayCount: persistence.replays.list().length,
    acceptance: readAcceptanceEvidence(generatedAt, BOOTED_AT),
    config: {
      apiPort: String(process.env.PORT ?? 8787),
      clientPort: String(process.env.SEEKR_CLIENT_PORT ?? 5173),
      aiProvider: process.env.SEEKR_AI_PROVIDER ?? "ollama",
      ollamaModel: process.env.SEEKR_OLLAMA_MODEL ?? "llama3.2:latest",
      ollamaUrlConfigured: Boolean(process.env.SEEKR_OLLAMA_URL),
      internalAuthEnabled: internalAuthEnabled(),
      expectedSourcesConfigured: Boolean(process.env.SEEKR_EXPECTED_SOURCES)
    }
  };
}
