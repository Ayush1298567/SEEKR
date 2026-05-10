import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEEKR_SCHEMA_VERSION, SEEKR_SOFTWARE_VERSION } from "../../shared/constants";
import { ReplayManifestSchema } from "../../shared/schemas";
import type { MissionEvent, MissionState, ReplayManifest, RuntimeConfig, SessionManifest } from "../../shared/types";
import { hashValue } from "../domain/ids";

export interface ReplayIntegrity {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ReplayRunMetadata {
  session: SessionManifest;
  config: RuntimeConfig;
}

export class ReplayStore {
  private replays: ReplayManifest[] = [];
  private readonly replayDir: string;

  constructor(private readonly root = process.env.SEEKR_DATA_DIR ?? path.join(process.cwd(), "data")) {
    this.replayDir = path.join(root, "replays");
  }

  async init() {
    await mkdir(this.replayDir, { recursive: true });
    const files = await readdir(this.replayDir).catch(() => []);
    const manifests = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          try {
            const manifest = ReplayManifestSchema.parse(JSON.parse(await readFile(path.join(this.replayDir, file), "utf8")));
            return verifyReplayManifest(manifest).ok ? manifest : undefined;
          } catch {
            return undefined;
          }
        })
    );
    this.replays = manifests
      .filter((manifest): manifest is ReplayManifest => Boolean(manifest))
      .sort((a, b) => b.exportedAt - a.exportedAt || b.eventCount - a.eventCount);
  }

  exportManifest(state: MissionState, events: MissionEvent[], runMetadata?: ReplayRunMetadata): ReplayManifest {
    const manifest: ReplayManifest = {
      replayId: `replay-${state.missionId}-${state.stateSeq}`,
      missionId: state.missionId,
      scenarioId: state.scenarioId,
      exportedAt: Date.now(),
      schemaVersion: SEEKR_SCHEMA_VERSION,
      softwareVersion: SEEKR_SOFTWARE_VERSION,
      eventCount: events.length,
      eventLog: events,
      snapshots: [state],
      evidenceIndex: state.evidenceAssets,
      adapterMetadata: {
        source: state.source,
        scenarioId: state.scenarioId,
        simulator: state.simulator,
        spatialAssets: state.spatialAssets.map((asset) => ({
          assetId: asset.assetId,
          kind: asset.kind,
          assetFormat: asset.assetFormat,
          previewUri: asset.previewUri,
          bounds: asset.bounds,
          sampleCount: asset.sampleCount,
          sourceAdapter: asset.sourceAdapter,
          frameId: asset.frameId,
          status: asset.status
        })),
        imports: events
          .filter((event) => event.type === "import.completed")
          .map((event) => ({ seq: event.seq, importId: event.payload.importId, kind: event.payload.kind, summary: event.payload.summary }))
      },
      runMetadata,
      finalStateHash: hashValue(state)
    };
    this.upsert(manifest);
    return manifest;
  }

  async persistManifest(manifest: ReplayManifest) {
    await mkdir(this.replayDir, { recursive: true });
    await writeFile(path.join(this.replayDir, `${safeReplayFileName(manifest.replayId)}.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  list() {
    return this.replays.map(({ replayId, missionId, scenarioId, exportedAt, schemaVersion, softwareVersion, eventCount, finalStateHash }) => ({
      replayId,
      missionId,
      scenarioId,
      exportedAt,
      schemaVersion,
      softwareVersion,
      eventCount,
      finalStateHash,
      integrity: this.verify(replayId)
    }));
  }

  get(replayId: string) {
    const replay = this.replays.find((candidate) => candidate.replayId === replayId);
    return replay && verifyReplayManifest(replay).ok ? replay : undefined;
  }

  verify(replayId: string): ReplayIntegrity {
    const replay = this.replays.find((candidate) => candidate.replayId === replayId);
    if (!replay) return { ok: false, errors: ["Replay manifest not found"], warnings: [] };
    return verifyReplayManifest(replay);
  }

  private upsert(manifest: ReplayManifest) {
    this.replays = [manifest, ...this.replays.filter((replay) => replay.replayId !== manifest.replayId)].sort(
      (a, b) => b.exportedAt - a.exportedAt || b.eventCount - a.eventCount
    );
  }
}

export function verifyReplayManifest(manifest: ReplayManifest): ReplayIntegrity {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (manifest.schemaVersion !== SEEKR_SCHEMA_VERSION) {
    errors.push(`Schema version mismatch: expected ${SEEKR_SCHEMA_VERSION}, got ${manifest.schemaVersion}`);
  }
  if (manifest.softwareVersion !== SEEKR_SOFTWARE_VERSION) {
    warnings.push(`Software version differs from current build: exported ${manifest.softwareVersion}, current ${SEEKR_SOFTWARE_VERSION}`);
  }
  if (manifest.eventLog.length !== manifest.eventCount) {
    errors.push(`Event count mismatch: manifest says ${manifest.eventCount}, event log has ${manifest.eventLog.length}`);
  }
  if (!manifest.snapshots.length) {
    errors.push("Replay manifest has no snapshots");
  } else {
    const finalSnapshotHash = hashValue(manifest.snapshots[manifest.snapshots.length - 1]);
    if (finalSnapshotHash !== manifest.finalStateHash) {
      errors.push("Final state hash does not match final snapshot");
    }
  }

  manifest.eventLog.forEach((event, index) => {
    const prevHash = index === 0 ? "GENESIS" : manifest.eventLog[index - 1]?.hash;
    if (event.prevHash !== prevHash) errors.push(`Event ${event.eventId} has invalid prevHash`);
    const { hash: _hash, ...base } = event;
    const expectedHash = hashValue(base);
    if (event.hash !== expectedHash) errors.push(`Event ${event.eventId} hash mismatch`);
  });

  return { ok: errors.length === 0, errors, warnings };
}

function safeReplayFileName(replayId: string) {
  return replayId.replace(/[^a-zA-Z0-9._-]/g, "_");
}
