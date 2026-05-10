import { z } from "zod";
import { DetectionSchema, MapDeltaSchema, MissionEventSchema, SpatialAssetSchema, TelemetrySampleSchema } from "../../shared/schemas";
import type { MissionEvent } from "../../shared/types";
import { normalizeMavlinkMessage } from "../adapters/mavlinkAdapter";
import { occupancyGridToMapDelta } from "../adapters/ros2SlamAdapter";
import { hashValue } from "../domain/ids";
import type { MissionStore } from "../state";

const ImportEnvelopeSchema = z.object({
  importId: z.string().optional(),
  records: z.array(z.unknown()).default([])
});

const SpatialManifestSchema = z.object({
  importId: z.string().optional(),
  assets: z.array(z.unknown()).default([])
});

const MissionEventsImportSchema = z.object({
  importId: z.string().optional(),
  events: z.array(MissionEventSchema)
});

export interface ImportRejectedRecord {
  index: number;
  type: string;
  reason: string;
}

export interface ImportSummary {
  ok: boolean;
  importId: string;
  kind: string;
  counts: Record<string, number>;
  rejected: ImportRejectedRecord[];
  stateSeq: number;
  finalStateHash: string;
}

export function importBagLite(store: MissionStore, input: unknown): ImportSummary {
  const parsed = ImportEnvelopeSchema.parse(input);
  const counts: Record<string, number> = {};
  const rejected: ImportRejectedRecord[] = [];
  const importId = parsed.importId ?? `bag-lite-${Date.now()}`;

  parsed.records.forEach((record, index) => {
    const type = recordType(record);
    try {
      ingestRecord(store, record);
      counts[type] = (counts[type] ?? 0) + 1;
    } catch (error) {
      rejected.push({ index, type, reason: error instanceof Error ? error.message : String(error) });
    }
  });

  const summary = finishAndRecord(store, importId, "rosbag-lite", counts, rejected);
  return summary;
}

export function importSpatialManifest(store: MissionStore, input: unknown): ImportSummary {
  const parsed = SpatialManifestSchema.parse(input);
  const counts: Record<string, number> = {};
  const rejected: ImportRejectedRecord[] = [];
  const importId = parsed.importId ?? `spatial-manifest-${Date.now()}`;

  parsed.assets.forEach((assetInput, index) => {
    try {
      const asset = SpatialAssetSchema.parse(assetInput);
      store.ingestSpatialAsset(asset);
      counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
    } catch (error) {
      rejected.push({ index, type: "spatialAsset", reason: error instanceof Error ? error.message : String(error) });
    }
  });

  const summary = finishAndRecord(store, importId, "spatial-manifest", counts, rejected);
  return summary;
}

export function importMissionEvents(store: MissionStore, input: unknown): ImportSummary & { events: MissionEvent[] } {
  const parsed = MissionEventsImportSchema.parse(input);
  const importId = parsed.importId ?? `mission-events-${Date.now()}`;
  const validation = store.validateHashChain(parsed.events);
  if (!validation.ok) {
    return {
      ...finishSummary(store, importId, "mission-events", {}, validation.errors.map((reason, index) => ({ index, type: "missionEvent", reason }))),
      events: parsed.events
    };
  }

  store.replay(parsed.events);
  const summary = finishAndRecord(store, importId, "mission-events", { missionEvent: parsed.events.length }, []);
  return { ...summary, events: parsed.events };
}

function ingestRecord(store: MissionStore, record: unknown) {
  if (!record || typeof record !== "object") throw new Error("Record must be an object");
  const candidate = record as Record<string, unknown>;
  const type = String(candidate.type ?? "");

  if (type === "telemetry") {
    store.ingestTelemetry(TelemetrySampleSchema.parse(candidate.sample ?? candidate));
    return;
  }
  if (type === "mavlink") {
    const sample = normalizeMavlinkMessage((candidate.message ?? candidate) as Record<string, unknown>);
    if (!sample) throw new Error("Unsupported MAVLink message");
    store.ingestTelemetry(sample);
    return;
  }
  if (type === "mapDelta") {
    store.ingestMapDelta(MapDeltaSchema.parse(candidate.mapDelta ?? candidate));
    return;
  }
  if (type === "ros2Map") {
    store.ingestMapDelta(occupancyGridToMapDelta((candidate.grid ?? candidate) as Parameters<typeof occupancyGridToMapDelta>[0], store.snapshot().missionId));
    return;
  }
  if (type === "detection") {
    const detection = DetectionSchema.parse(candidate.detection ?? candidate);
    store.ingestDetection(detection, candidate.evidenceAsset);
    return;
  }
  if (type === "spatialAsset") {
    const asset = SpatialAssetSchema.parse(candidate.asset ?? candidate);
    store.ingestSpatialAsset(asset);
    return;
  }

  throw new Error(`Unsupported bag-lite record type ${type || "unknown"}`);
}

function recordType(record: unknown) {
  if (!record || typeof record !== "object") return "unknown";
  return String((record as Record<string, unknown>).type ?? "unknown");
}

function finishSummary(
  store: MissionStore,
  importId: string,
  kind: string,
  counts: Record<string, number>,
  rejected: ImportRejectedRecord[]
): ImportSummary {
  const state = store.snapshot();
  return {
    ok: rejected.length === 0,
    importId,
    kind,
    counts,
    rejected,
    stateSeq: state.stateSeq,
    finalStateHash: hashValue(state)
  };
}

function finishAndRecord(
  store: MissionStore,
  importId: string,
  kind: string,
  counts: Record<string, number>,
  rejected: ImportRejectedRecord[]
) {
  const preSummary = finishSummary(store, importId, kind, counts, rejected);
  store.recordImportSummary(importId, kind, { ...preSummary });
  return finishSummary(store, importId, kind, counts, rejected);
}
