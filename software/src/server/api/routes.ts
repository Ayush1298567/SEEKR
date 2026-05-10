import express from "express";
import { z } from "zod";
import { CommandRequestSchema, DetectionSchema, MapDeltaSchema, SpatialAssetSchema, TelemetrySampleSchema } from "../../shared/schemas";
import type { CommandRequest } from "../../shared/types";
import { buildAiProposal, buildAiProposalWithLocalAi, invokeTool, localLlamaStatus, toolDefinitions } from "../aiTools";
import { normalizeMavlinkMessage } from "../adapters/mavlinkAdapter";
import { occupancyGridToMapDelta } from "../adapters/ros2SlamAdapter";
import { buildRuntimeConfig } from "../config";
import { hashValue } from "../domain/ids";
import { buildIncidentLog, buildIncidentLogMarkdown } from "../domain/incidentLog";
import { buildOperatorInputRequest } from "../domain/operatorInput";
import { buildPassivePlan } from "../domain/passivePlan";
import { buildSpatialPreview } from "../domain/spatialPreview";
import { readFixture } from "../fixtures";
import { buildHardwareReadinessReport, parseHardwareTarget } from "../hardwareReadiness";
import { importBagLite, importMissionEvents, importSpatialManifest } from "../importers/bagLiteImporter";
import type { MissionPersistence } from "../persistence";
import { buildReadinessReport } from "../readiness";
import { buildMissionReportData, buildMissionReportMarkdown } from "../report";
import { buildSessionManifest } from "../session";
import { buildSourceHealthReport } from "../sourceHealth";
import type { MissionStore } from "../state";
import { scenarios } from "../sim/scenarios";
import { requireInternalAuth } from "./auth";
import { sendError } from "./errors";

export function createApiRouter(store: MissionStore, persistence: MissionPersistence) {
  const router = express.Router();
  const replaySessions = new Map<string, { replayId: string; currentSeq: number; playing: boolean; speed: number }>();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, now: Date.now(), schemaVersion: store.snapshot().schemaVersion, stateSeq: store.snapshot().stateSeq });
  });

  router.get("/session", (_req, res) => {
    res.json(buildSessionManifest(store, persistence));
  });

  router.get("/config", (_req, res) => {
    res.json(buildRuntimeConfig(store, persistence));
  });

  router.get("/state", (_req, res) => {
    res.json(store.snapshot());
  });

  router.get("/events", (req, res) => {
    const sinceSeq = parseOptionalNumber(req.query.sinceSeq, 0);
    if (!Number.isFinite(sinceSeq) || sinceSeq < 0) {
      res.status(400).json({ error: "sinceSeq must be a nonnegative number" });
      return;
    }
    res.json(store.eventsSince(sinceSeq));
  });

  router.get("/verify", (_req, res) => {
    res.json(verificationResponse(store));
  });

  router.get("/scenarios", (_req, res) => {
    res.json(
      scenarios.map(({ id, name, description, width, height, seed, drones, zones, scriptedFaults, expectedOutcomes }) => ({
        id,
        name,
        description,
        width,
        height,
        seed,
        drones,
        zones,
        scriptedFaults,
        expectedOutcomes
      }))
    );
  });

  router.get("/passive-plan", (_req, res) => {
    res.json({ ok: true, plan: buildPassivePlan(store.snapshot(), store.allEvents(), Date.now()) });
  });

  router.get("/operator-input-request", (_req, res) => {
    res.json({ ok: true, request: buildOperatorInputRequest(store.snapshot()) });
  });

  router.get("/readiness", async (_req, res) => {
    try {
      res.json(await buildReadinessReport(store, persistence));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/hardware-readiness", async (req, res) => {
    try {
      res.json(await buildHardwareReadinessReport(parseHardwareTarget(req.query.target), store, persistence));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/source-health", (_req, res) => {
    res.json(buildSourceHealthReport(store.snapshot(), store.allEvents()));
  });

  router.get("/tools", (_req, res) => {
    res.json(toolDefinitions);
  });

  router.get("/ai/status", async (_req, res) => {
    res.json(await localLlamaStatus());
  });

  router.post("/tools/:name/invoke", (req, res) => {
    res.json(invokeTool(store.snapshot(), req.params.name, req.body ?? {}, store.allEvents()));
  });

  router.post("/commands", requireInternalAuth, (req, res) => {
    try {
      const result = store.submitCommand(normalizeCommandBody(req.body));
      res.status(result.ok ? 202 : 409).json({ ...result, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/commands/:id/approve", requireInternalAuth, (req, res) => {
    const lifecycle = store.snapshot().commandLifecycles.find((candidate) => candidate.commandId === req.params.id);
    if (!lifecycle) {
      res.status(404).json({ error: "Command not found" });
      return;
    }
    res.json({ ok: lifecycle.status !== "rejected", lifecycle });
  });

  router.post("/commands/:id/cancel", requireInternalAuth, (req, res) => {
    const lifecycle = store.snapshot().commandLifecycles.find((candidate) => candidate.commandId === req.params.id);
    if (!lifecycle) {
      res.status(404).json({ error: "Command not found" });
      return;
    }
    res.status(409).json({ error: "Local commands dispatch synchronously; cancellation is only available for future pending adapter commands." });
  });

  router.post("/scenarios/:id/load", requireInternalAuth, (req, res) => {
    const result = store.submitCommand({
      kind: "scenario.load",
      target: { scenarioId: req.params.id },
      params: { scenarioId: req.params.id },
      requestedBy: "operator"
    });
    res.status(result.ok ? 202 : 409).json(result.ok ? { ok: true, state: store.snapshot() } : { ok: false, error: result.error, result });
  });

  router.get("/missions/:missionId/export", requireInternalAuth, async (req, res) => {
    const state = store.snapshot();
    if (req.params.missionId !== state.missionId) {
      res.status(404).json({ error: "Mission not found" });
      return;
    }
    try {
      res.json(await persistence.exportBundle(state, store.allEvents(), {
        session: buildSessionManifest(store, persistence),
        config: buildRuntimeConfig(store, persistence)
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/missions/:missionId/report", (req, res) => {
    const state = store.snapshot();
    if (req.params.missionId !== state.missionId) {
      res.status(404).json({ error: "Mission not found" });
      return;
    }
    const verify = store.validateHashChain();
    if (req.query.format === "json" || req.accepts(["text/markdown", "json"]) === "json") {
      res.json({ ok: true, report: buildMissionReportData(state, store.allEvents(), verify) });
      return;
    }
    res.type("text/markdown").send(buildMissionReportMarkdown(state, store.allEvents(), verify));
  });

  router.get("/missions/:missionId/incident-log", (req, res) => {
    const state = store.snapshot();
    if (req.params.missionId !== state.missionId) {
      res.status(404).json({ error: "Mission not found" });
      return;
    }
    const log = buildIncidentLog(state, store.allEvents(), store.validateHashChain());
    if (req.query.format === "json" || req.accepts(["text/markdown", "json"]) === "json") {
      res.json({ ok: true, log });
      return;
    }
    res.type("text/markdown").send(buildIncidentLogMarkdown(log));
  });

  router.get("/missions/:missionId/verify", (req, res) => {
    const state = store.snapshot();
    if (req.params.missionId !== state.missionId) {
      res.status(404).json({ error: "Mission not found" });
      return;
    }
    res.json(verificationResponse(store));
  });

  router.get("/replays", (_req, res) => {
    res.json(persistence.replays.list());
  });

  router.get("/replays/:id/state", (req, res) => {
    const replayId = String(req.params.id);
    const replay = persistence.replays.get(replayId);
    if (!replay) {
      res.status(404).json({ error: "Replay not found" });
      return;
    }
    const session = replaySessions.get(replayId) ?? {
      replayId,
      currentSeq: replay.eventCount,
      playing: false,
      speed: 1
    };
    res.json(replayResponse(store, replay, session));
  });

  router.get("/replays/:id/verify", (req, res) => {
    const replayId = String(req.params.id);
    const replay = persistence.replays.get(replayId);
    if (!replay) {
      res.status(404).json({ error: "Replay not found" });
      return;
    }
    res.json({ ok: true, replayId, integrity: persistence.replays.verify(replayId) });
  });

  router.post("/replays/:id/start", requireInternalAuth, (req, res) => {
    const replayId = String(req.params.id);
    const replay = persistence.replays.get(replayId);
    if (!replay) {
      res.status(404).json({ error: "Replay not found" });
      return;
    }
    const seq = parseOptionalNumber(req.body?.seq, replay.eventCount);
    const speed = parseOptionalNumber(req.body?.speed, 1);
    if (!validReplaySeq(seq, replay.eventCount) || !validReplaySpeed(speed)) {
      res.status(400).json({ error: "Replay seq or speed is malformed" });
      return;
    }
    const session = {
      replayId,
      currentSeq: Math.max(0, Math.min(replay.eventCount, seq)),
      playing: Boolean(req.body?.playing ?? false),
      speed
    };
    replaySessions.set(replayId, session);
    res.json(replayResponse(store, replay, session));
  });

  router.post("/replays/:id/seek", requireInternalAuth, (req, res) => {
    const replayId = String(req.params.id);
    const replay = persistence.replays.get(replayId);
    if (!replay) {
      res.status(404).json({ error: "Replay not found" });
      return;
    }
    const seq = parseOptionalNumber(req.body?.seq, replay.eventCount);
    const speed = parseOptionalNumber(req.body?.speed, 1);
    if (!validReplaySeq(seq, replay.eventCount) || !validReplaySpeed(speed)) {
      res.status(400).json({ error: "Replay seq or speed is malformed" });
      return;
    }
    const session = replaySessions.get(replayId) ?? { replayId, currentSeq: seq, playing: false, speed: 1 };
    session.currentSeq = Math.max(0, Math.min(replay.eventCount, seq));
    if (typeof req.body?.playing === "boolean") session.playing = req.body.playing;
    if (typeof req.body?.speed !== "undefined") session.speed = speed;
    replaySessions.set(replayId, session);
    res.json(replayResponse(store, replay, session));
  });

  router.get("/evidence/:assetId", (req, res) => {
    const asset = store.snapshot().evidenceAssets.find((candidate) => candidate.assetId === req.params.assetId);
    if (!asset) {
      res.status(404).json({ error: "Evidence asset not found" });
      return;
    }
    res.json(asset);
  });

  router.get("/spatial-assets", (req, res) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const droneId = typeof req.query.droneId === "string" ? req.query.droneId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const assets = store.snapshot().spatialAssets.filter((asset) =>
      (!kind || asset.kind === kind) &&
      (!droneId || asset.droneId === droneId) &&
      (!status || asset.status === status)
    );
    res.json({ ok: true, assets });
  });

  router.get("/spatial-assets/:assetId", (req, res) => {
    const asset = store.snapshot().spatialAssets.find((candidate) => candidate.assetId === req.params.assetId);
    if (!asset) {
      res.status(404).json({ error: "Spatial asset not found" });
      return;
    }
    res.json({ ok: true, asset });
  });

  router.get("/spatial-assets/:assetId/preview", (req, res) => {
    const state = store.snapshot();
    const asset = state.spatialAssets.find((candidate) => candidate.assetId === req.params.assetId);
    if (!asset) {
      res.status(404).json({ error: "Spatial asset not found" });
      return;
    }
    res.json({ ok: true, preview: buildSpatialPreview(asset, state) });
  });

  router.post("/ai/proposals", requireInternalAuth, async (_req, res) => {
    const proposal = await buildAiProposalWithLocalAi(store.snapshot());
    store.addProposal(proposal);
    res.status(201).json({ ok: true, proposal, state: store.snapshot() });
  });

  router.post("/ai/proposals/:id/approve", requireInternalAuth, (req, res) => {
    const proposalId = String(req.params.id);
    const proposal = store.snapshot().proposals.find((candidate) => candidate.id === proposalId);
    if (!proposal) {
      res.status(404).json({ ok: false, error: "Proposal not found" });
      return;
    }
    const ok = store.approveProposal(proposalId);
    res.status(ok ? 202 : 409).json(ok ? { ok: true, state: store.snapshot() } : { ok: false, error: "Proposal did not validate", state: store.snapshot() });
  });

  router.post("/ingest/telemetry", requireInternalAuth, (req, res) => {
    try {
      const mavlink = normalizeMavlinkMessage(req.body);
      const sample = mavlink ?? TelemetrySampleSchema.parse(req.body);
      store.ingestTelemetry(sample);
      res.status(202).json({ ok: true, sample, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/ingest/map-deltas", requireInternalAuth, (req, res) => {
    try {
      const mapDelta = isOccupancyGrid(req.body)
        ? occupancyGridToMapDelta(req.body, store.snapshot().missionId)
        : MapDeltaSchema.parse(req.body);
      store.ingestMapDelta(mapDelta);
      res.status(202).json({ ok: true, mapDelta, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/ingest/detections", requireInternalAuth, (req, res) => {
    try {
      const detection = DetectionSchema.parse(req.body);
      store.ingestDetection(detection);
      res.status(202).json({ ok: true, detection, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/ingest/spatial-assets", requireInternalAuth, (req, res) => {
    try {
      const asset = SpatialAssetSchema.parse(req.body);
      store.ingestSpatialAsset(asset);
      res.status(202).json({ ok: true, asset, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/ingest/adapter-events", requireInternalAuth, (req, res) => {
    res.status(202).json({ ok: true, received: req.body ?? {} });
  });

  router.post("/import/rosbag-lite", requireInternalAuth, (req, res) => {
    try {
      const summary = importBagLite(store, req.body);
      res.status(summary.ok ? 202 : 207).json({ ok: summary.ok, summary, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/import/spatial-manifest", requireInternalAuth, (req, res) => {
    try {
      const summary = importSpatialManifest(store, req.body);
      res.status(summary.ok ? 202 : 207).json({ ok: summary.ok, summary, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/import/mission-events", requireInternalAuth, (req, res) => {
    try {
      const summary = importMissionEvents(store, req.body);
      res.status(summary.ok ? 202 : 400).json({ ok: summary.ok, summary, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/import/fixtures/:name", requireInternalAuth, async (req, res) => {
    try {
      const fixtureName = String(req.params.name);
      const fixture = await readFixture("import", fixtureName);
      const candidate = fixture as { records?: unknown; assets?: unknown; events?: unknown };
      const summary = Array.isArray(candidate.records)
        ? importBagLite(store, fixture)
        : Array.isArray(candidate.assets)
          ? importSpatialManifest(store, fixture)
          : Array.isArray(candidate.events)
            ? importMissionEvents(store, fixture)
          : undefined;
      if (!summary) {
        res.status(400).json({ ok: false, error: "Import fixture must contain records, assets, or events" });
        return;
      }
      res.status(summary.ok ? 202 : 207).json({ ok: summary.ok, fixture: fixtureName, summary, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/ingest/fixtures/mavlink/:name", requireInternalAuth, async (req, res) => {
    try {
      const fixtureName = String(req.params.name);
      const fixture = await readFixture("mavlink", fixtureName);
      const messages = Array.isArray(fixture) ? fixture : [fixture];
      const samples = messages.map((message) => normalizeMavlinkMessage(message as Record<string, unknown>)).filter(Boolean);
      samples.forEach((sample) => store.ingestTelemetry(sample));
      res.status(202).json({ ok: true, fixture: fixtureName, ingested: samples.length, ignored: messages.length - samples.length, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/ingest/fixtures/ros2-map/:name", requireInternalAuth, async (req, res) => {
    try {
      const fixtureName = String(req.params.name);
      const fixture = await readFixture("ros2-map", fixtureName);
      const mapDelta = occupancyGridToMapDelta(fixture as Parameters<typeof occupancyGridToMapDelta>[0], store.snapshot().missionId);
      store.ingestMapDelta(mapDelta);
      res.status(202).json({ ok: true, fixture: fixtureName, mapDelta, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/ingest/fixtures/detection/:name", requireInternalAuth, async (req, res) => {
    try {
      const fixtureName = String(req.params.name);
      const fixture = await readFixture("detection", fixtureName);
      const candidate = fixture as { detection?: unknown; evidenceAsset?: unknown };
      const detection = DetectionSchema.parse(candidate.detection ?? fixture);
      store.ingestDetection(detection, candidate.evidenceAsset);
      res.status(202).json({ ok: true, fixture: fixtureName, detection, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/ingest/fixtures/spatial/:name", requireInternalAuth, async (req, res) => {
    try {
      const fixtureName = String(req.params.name);
      const fixture = await readFixture("spatial", fixtureName);
      const candidate = fixture as { asset?: unknown };
      const asset = SpatialAssetSchema.parse(candidate.asset ?? fixture);
      store.ingestSpatialAsset(asset);
      res.status(202).json({ ok: true, fixture: fixtureName, asset, state: store.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  addCompatibilityRoutes(router, store, persistence);
  return router;
}

function replayResponse(
  store: MissionStore,
  replay: NonNullable<ReturnType<MissionPersistence["replays"]["get"]>>,
  session: { replayId: string; currentSeq: number; playing: boolean; speed: number }
) {
  const state = store.buildReplayState(replay.eventLog, session.currentSeq);
  return {
    ok: true,
    mode: "replay" as const,
    replayId: session.replayId,
    currentSeq: session.currentSeq,
    totalEventCount: replay.eventCount,
    playing: session.playing,
    speed: session.speed,
    finalStateHash: replay.finalStateHash,
    state
  };
}

function verificationResponse(store: MissionStore) {
  const state = store.snapshot();
  const verify = store.validateHashChain();
  return {
    ok: verify.ok,
    missionId: state.missionId,
    eventCount: store.allEvents().length,
    stateSeq: state.stateSeq,
    finalStateHash: hashValue(state),
    errors: verify.errors
  };
}

function addCompatibilityRoutes(router: express.Router, store: MissionStore, persistence: MissionPersistence) {
  router.get("/export", requireInternalAuth, async (_req, res) => {
    try {
      res.json(await persistence.exportBundle(store.snapshot(), store.allEvents(), {
        session: buildSessionManifest(store, persistence),
        config: buildRuntimeConfig(store, persistence)
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/export/audit.ndjson", requireInternalAuth, (_req, res) => {
    res.type("text/plain").send(store.allEvents().map((event) => JSON.stringify(event)).join("\n"));
  });

  router.post("/mission/start", requireInternalAuth, (_req, res) => {
    store.start();
    res.json(store.snapshot());
  });

  router.post("/mission/pause", requireInternalAuth, (_req, res) => {
    store.pause();
    res.json(store.snapshot());
  });

  router.post("/mission/reset", requireInternalAuth, (_req, res) => {
    store.reset();
    res.json(store.snapshot());
  });

  router.post("/trust-mode", requireInternalAuth, (req, res) => {
    const parsed = z.object({ mode: z.enum(["advisory", "semi-auto", "full-auto-training"]) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    store.setTrustMode(parsed.data.mode);
    res.json(store.snapshot());
  });

  router.post("/zones/assign", requireInternalAuth, (req, res) => {
    const parsed = z.object({ droneId: z.string(), zoneId: z.string() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const ok = store.assignDroneToZone(parsed.data.droneId, parsed.data.zoneId);
    res.status(ok ? 202 : 409).json(ok ? store.snapshot() : { error: "Drone or zone not valid" });
  });

  router.post("/drones/:id/action", requireInternalAuth, (req, res) => {
    const parsed = z
      .object({
        action: z.enum(["resume", "hold", "return-home", "simulate-link-loss", "simulate-failure"])
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const ok = store.applyDroneAction(String(req.params.id), parsed.data.action);
    res.status(ok ? 202 : 409).json(ok ? store.snapshot() : { error: "Drone action rejected" });
  });

  router.post("/detections/:id/review", requireInternalAuth, (req, res) => {
    const parsed = z.object({ review: z.enum(["new", "confirmed", "false-positive", "needs-follow-up"]) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const ok = store.reviewDetection(String(req.params.id), parsed.data.review);
    res.status(ok ? 202 : 409).json(ok ? store.snapshot() : { error: "Detection review rejected" });
  });

  router.post("/alerts/:id/ack", requireInternalAuth, (req, res) => {
    const ok = store.acknowledgeAlert(String(req.params.id));
    res.status(ok ? 202 : 409).json(ok ? store.snapshot() : { error: "Alert not found" });
  });

  router.post("/ai/propose", requireInternalAuth, async (_req, res) => {
    const proposal = await buildAiProposalWithLocalAi(store.snapshot());
    store.addProposal(proposal);
    res.status(201).json(proposal);
  });
}

function normalizeCommandBody(body: unknown): Partial<CommandRequest> & Pick<CommandRequest, "kind"> {
  const value = body as Partial<CommandRequest>;
  if (value.commandId) return CommandRequestSchema.parse(value);
  if (!value.kind) throw new Error("Missing command kind");
  return value as Partial<CommandRequest> & Pick<CommandRequest, "kind">;
}

function isOccupancyGrid(value: unknown): value is Parameters<typeof occupancyGridToMapDelta>[0] {
  const candidate = value as { info?: unknown; data?: unknown };
  return Boolean(candidate && typeof candidate === "object" && candidate.info && Array.isArray(candidate.data));
}

function parseOptionalNumber(value: unknown, fallback: number) {
  if (typeof value === "undefined") return fallback;
  if (Array.isArray(value)) return Number.NaN;
  return Number(value);
}

function validReplaySeq(seq: number, eventCount: number) {
  return Number.isFinite(seq) && seq >= 0 && seq <= eventCount;
}

function validReplaySpeed(speed: number) {
  return [0.25, 0.5, 1, 2, 4].includes(speed);
}
