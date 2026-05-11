import express from "express";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBodyErrorHandler } from "../api/errors";
import { createApiRouter } from "../api/routes";
import { attachWebSocket } from "../api/ws";
import { REQUIRED_ACCEPTANCE_COMMANDS, writeAcceptanceStatus } from "../acceptanceEvidence";
import { REQUIRED_STRICT_AI_SMOKE_CASES } from "../ai/localAiEvidence";
import { MissionPersistence } from "../persistence";
import { MissionStore } from "../state";
import { SEEKR_SCHEMA_VERSION, SEEKR_SOFTWARE_VERSION } from "../../shared/constants";

const fixedClock = () => 1_800_000_000_000;

describe("HTTP and WebSocket API contracts", () => {
  let context: Awaited<ReturnType<typeof startTestServer>>;
  const previousProvider = process.env.SEEKR_AI_PROVIDER;
  const previousInternalToken = process.env.SEEKR_INTERNAL_TOKEN;
  const previousAiSmokeStatusPath = process.env.SEEKR_AI_SMOKE_STATUS_PATH;
  const previousAcceptanceStatusPath = process.env.SEEKR_ACCEPTANCE_STATUS_PATH;

  beforeEach(async () => {
    process.env.SEEKR_AI_PROVIDER = "rules";
    process.env.SEEKR_AI_SMOKE_STATUS_PATH = path.join(os.tmpdir(), `seekr-api-ai-smoke-missing-${process.pid}.json`);
    process.env.SEEKR_ACCEPTANCE_STATUS_PATH = path.join(os.tmpdir(), `seekr-api-acceptance-missing-${process.pid}.json`);
    delete process.env.SEEKR_INTERNAL_TOKEN;
    context = await startTestServer();
  });

  afterEach(async () => {
    await context.close();
    if (previousProvider === undefined) delete process.env.SEEKR_AI_PROVIDER;
    else process.env.SEEKR_AI_PROVIDER = previousProvider;
    if (previousInternalToken === undefined) delete process.env.SEEKR_INTERNAL_TOKEN;
    else process.env["SEEKR_INTERNAL_TOKEN"] = previousInternalToken;
    if (previousAiSmokeStatusPath === undefined) delete process.env.SEEKR_AI_SMOKE_STATUS_PATH;
    else process.env.SEEKR_AI_SMOKE_STATUS_PATH = previousAiSmokeStatusPath;
    if (previousAcceptanceStatusPath === undefined) delete process.env.SEEKR_ACCEPTANCE_STATUS_PATH;
    else process.env.SEEKR_ACCEPTANCE_STATUS_PATH = previousAcceptanceStatusPath;
  });

  it("covers the documented HTTP surface and response codes", async () => {
    const health = await context.api("/api/health");
    expect(health).toMatchObject({ ok: true, schemaVersion: 1, stateSeq: 0 });

    expect(await context.api("/api/session")).toMatchObject({
      ok: true,
      softwareVersion: expect.any(String),
      dataDir: expect.any(String),
      acceptance: { ok: false, status: "missing", commandUploadEnabled: false },
      config: { internalAuthEnabled: false, aiProvider: "rules", expectedSourcesConfigured: false }
    });
    expect(await context.api("/api/config")).toMatchObject({
      ok: false,
      softwareVersion: expect.any(String),
      server: { bindHost: "127.0.0.1", dataDir: expect.any(String) },
      auth: { internalAuthEnabled: false, tokenConfigured: false, tokenRedacted: true },
      safety: { commandUploadEnabled: false, realAdaptersReadOnly: true },
      warnings: expect.arrayContaining([expect.stringContaining("SEEKR_INTERNAL_TOKEN")])
    });
    expect(await context.api("/api/state")).toMatchObject({ missionId: "seekr-local-v1" });
    expect((await context.raw("/api/state")).headers.get("access-control-allow-origin")).toBeNull();
    const crossOriginState = await context.raw("/api/state", { headers: { Origin: "https://example.invalid" } });
    expect(crossOriginState.headers.get("access-control-allow-origin")).toBeNull();
    expect(crossOriginState.headers.get("access-control-allow-credentials")).toBeNull();
    expect(await context.api("/api/events?sinceSeq=0")).toEqual([]);
    expect((await context.raw("/api/events?sinceSeq=nope")).status).toBe(400);
    expect(await context.api("/api/verify")).toMatchObject({ ok: true, missionId: "seekr-local-v1", finalStateHash: expect.any(String) });
    expect(await context.api("/api/scenarios")).toHaveLength(2);
    expect(await context.api("/api/passive-plan")).toMatchObject({
      ok: true,
      plan: { mode: "passive-read-only", nextActions: expect.any(Array), safetyNotes: expect.any(Array) }
    });
    expect(await context.api("/api/operator-input-request")).toMatchObject({
      ok: true,
      request: { mode: "operator-input-request", question: expect.any(String), options: expect.any(Array) }
    });
    const readinessBefore = await context.api<any>("/api/readiness");
    expect(readinessBefore).toMatchObject({
      ok: true,
      missionId: "seekr-local-v1",
      stateSeq: 0,
      checks: expect.any(Array),
      summary: {
        eventCount: 0,
        replayCount: 0,
        finalStateHash: expect.any(String),
        ai: { provider: "local-rule-engine", model: "deterministic-v1" },
        sourceHealth: { ok: true, sourceCount: 0, staleSourceIds: [] },
        configWarnings: expect.arrayContaining([expect.stringContaining("SEEKR_EXPECTED_SOURCES")]),
        blockers: []
      }
    });
    expect(readinessBefore.checks.map((check: { id: string }) => check.id)).toEqual([
      "hash-chain",
      "persisted-replay",
      "report-export",
      "incident-log",
      "fixture-ingest",
      "source-health",
      "runtime-config",
      "local-ai",
      "local-ai-strict-smoke",
      "safety-boundary",
      "open-blockers"
    ]);
    expect(readinessBefore.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hash-chain", status: "pass", blocking: true }),
      expect.objectContaining({ id: "persisted-replay", status: "warn", blocking: false }),
      expect.objectContaining({ id: "local-ai", status: "warn", blocking: false }),
      expect.objectContaining({ id: "local-ai-strict-smoke", status: "warn", blocking: false }),
      expect.objectContaining({ id: "safety-boundary", status: "pass", blocking: true })
    ]));
    const beforeReadinessEvents = await context.api<any[]>("/api/events?sinceSeq=0");
    await context.api("/api/readiness");
    expect(await context.api<any[]>("/api/events?sinceSeq=0")).toHaveLength(beforeReadinessEvents.length);
    const hardwareBefore = await context.api<any>("/api/hardware-readiness?target=jetson-orin-nano");
    expect(hardwareBefore).toMatchObject({
      ok: true,
      target: { id: "jetson-orin-nano", isaacSupport: "recommended" },
      summary: { commandUploadEnabled: false },
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "host-platform" }),
        expect.objectContaining({ id: "bench-fixtures", status: "pass", blocking: true }),
        expect.objectContaining({ id: "safety-boundary", status: "pass", blocking: true })
      ])
    });
    expect(await context.api<any[]>("/api/events?sinceSeq=0")).toHaveLength(beforeReadinessEvents.length);
    expect(await context.api("/api/hardware-readiness?target=raspberry-pi-5")).toMatchObject({
      ok: true,
      target: { id: "raspberry-pi-5", isaacSupport: "bridge-only" },
      summary: { commandUploadEnabled: false }
    });
    expect((await context.raw("/api/hardware-readiness?target=bad-target")).status).toBe(400);
    expect(await context.api("/api/source-health")).toMatchObject({
      ok: true,
      missionId: "seekr-local-v1",
      stateSeq: 0,
      sources: [],
      summary: { sourceCount: 0, eventCount: 0, expectedSourceCount: 0, staleSourceIds: [] }
    });
    expect(await context.api("/api/tools")).toEqual(expect.arrayContaining([expect.objectContaining({ name: "query_map" })]));
    expect(await context.api("/api/tools")).toEqual(expect.arrayContaining([expect.objectContaining({ name: "query_spatial_assets" })]));
    expect(await context.api("/api/tools")).toEqual(expect.arrayContaining([expect.objectContaining({ name: "generate_passive_plan" })]));
    expect(await context.api("/api/ai/status")).toMatchObject({ ok: false, provider: "local-rule-engine" });
    expect(await context.api("/api/tools/query_map/invoke", { method: "POST", body: "{}" })).toMatchObject({ coveragePct: expect.any(Number) });
    const beforeToolEvents = await context.api<any[]>("/api/events?sinceSeq=0");
    expect(await context.api("/api/tools/generate_passive_plan/invoke", { method: "POST", body: "{}" })).toMatchObject({
      mode: "passive-read-only",
      nextActions: expect.any(Array)
    });
    expect(await context.api("/api/tools/request_operator_input/invoke", { method: "POST", body: JSON.stringify({ question: "Which detection should be reviewed first?" }) })).toMatchObject({
      mode: "operator-input-request",
      question: "Which detection should be reviewed first?"
    });
    expect(await context.api<any[]>("/api/events?sinceSeq=0")).toHaveLength(beforeToolEvents.length);
    expect(
      await context.api("/api/tools/set_no_fly_zone_draft/invoke", {
        method: "POST",
        body: JSON.stringify({ x: 20, y: 20, width: 4, height: 3 })
      })
    ).toMatchObject({ requiresApproval: true, validator: { ok: true } });
    expect(await context.api<any[]>("/api/events?sinceSeq=0")).toHaveLength(beforeToolEvents.length);
    expect(await context.api("/api/state")).toMatchObject({ noFlyZones: [] });

    const started = await context.api("/api/commands", {
      method: "POST",
      body: JSON.stringify({ kind: "mission.start", requestedBy: "operator" })
    });
    expect(started).toMatchObject({ ok: true, state: { phase: "running" } });
    expect(await context.api("/api/events?sinceSeq=1")).toEqual(expect.arrayContaining([expect.objectContaining({ seq: expect.any(Number) })]));

    const malformed = await context.raw("/api/commands", { method: "POST", body: JSON.stringify({}) });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ ok: false, code: "BAD_REQUEST", error: "Missing command kind" });

    const malformedJson = await context.raw("/api/commands", { method: "POST", body: "{" });
    expect(malformedJson.status).toBe(400);
    expect(await malformedJson.json()).toMatchObject({ ok: false, code: "MALFORMED_JSON" });

    const oversizedBody = await context.raw("/api/commands", { method: "POST", body: JSON.stringify({ payload: "x".repeat(2_100_000) }) });
    expect(oversizedBody.status).toBe(413);
    expect(await oversizedBody.json()).toMatchObject({ ok: false, code: "REQUEST_BODY_TOO_LARGE" });

    await context.api("/api/commands", {
      method: "POST",
      body: JSON.stringify({ kind: "drone.action", target: { droneId: "drone-1" }, params: { droneId: "drone-1", action: "simulate-link-loss" } })
    });
    const rejected = await context.raw("/api/commands", {
      method: "POST",
      body: JSON.stringify({ kind: "zone.assign", target: { droneId: "drone-1", zoneId: "zone-a" }, params: { droneId: "drone-1", zoneId: "zone-a" } })
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ ok: false, validation: { blockers: expect.arrayContaining(["SEEKR 1 is offline"]) } });

    const missingCommand = await context.raw("/api/commands/nope/approve", { method: "POST" });
    expect(missingCommand.status).toBe(404);

    expect(await context.api("/api/ingest/telemetry", { method: "POST", body: JSON.stringify({ type: "HEARTBEAT", sysid: "mav-1", system_status: "ACTIVE" }) })).toMatchObject({ ok: true });
    expect(await context.api("/api/ingest/map-deltas", { method: "POST", body: JSON.stringify(mapDelta()) })).toMatchObject({ ok: true });
    expect(await context.api("/api/ingest/detections", { method: "POST", body: JSON.stringify(detection()) })).toMatchObject({ ok: true });
    expect(await context.api("/api/ingest/spatial-assets", { method: "POST", body: JSON.stringify(spatialAsset()) })).toMatchObject({
      ok: true,
      state: { spatialAssets: expect.arrayContaining([expect.objectContaining({ assetId: "api-spatial-splat-1", status: "aligned" })]) }
    });
    expect(await context.api("/api/tools/query_spatial_assets/invoke", { method: "POST", body: "{}" })).toMatchObject({ total: expect.any(Number), byKind: expect.any(Object) });
    expect(await context.api("/api/tools/explain_spatial_asset/invoke", { method: "POST", body: JSON.stringify({ assetId: "api-spatial-splat-1" }) })).toMatchObject({
      asset: { assetId: "api-spatial-splat-1" },
      advisory: expect.stringContaining("metadata")
    });
    const beforeIncidentToolEvents = await context.api<any[]>("/api/events?sinceSeq=0");
    expect(await context.api("/api/tools/export_incident_log/invoke", { method: "POST", body: "{}" })).toMatchObject({
      mode: "read-only-incident-log",
      counts: { events: beforeIncidentToolEvents.length, detections: expect.any(Number), spatialAssets: expect.any(Number) },
      hashChain: { finalStateHash: expect.any(String) }
    });
    expect(await context.api<any[]>("/api/events?sinceSeq=0")).toHaveLength(beforeIncidentToolEvents.length);
    expect(await context.api("/api/spatial-assets")).toMatchObject({ ok: true, assets: expect.arrayContaining([expect.objectContaining({ assetId: "api-spatial-splat-1" })]) });
    expect(await context.api("/api/spatial-assets/api-spatial-splat-1")).toMatchObject({ ok: true, asset: { assetId: "api-spatial-splat-1" } });
    expect(await context.api("/api/spatial-assets/api-spatial-splat-1/preview")).toMatchObject({
      ok: true,
      preview: { assetId: "api-spatial-splat-1", points: expect.any(Array), generated: true }
    });
    expect((await context.raw("/api/spatial-assets/missing")).status).toBe(404);
    expect((await context.raw("/api/ingest/spatial-assets", { method: "POST", body: JSON.stringify({ ...spatialAsset(), assetId: "api-spatial-low-transform", transformConfidence: 0.1 }) })).status).toBe(400);
    expect(await context.api("/api/ingest/adapter-events", { method: "POST", body: JSON.stringify({ adapter: "fixture" }) })).toMatchObject({ ok: true });
    expect(await context.api("/api/source-health")).toMatchObject({
      ok: true,
      sources: expect.arrayContaining([
        expect.objectContaining({ id: "mavlink", channels: ["telemetry"] }),
        expect.objectContaining({ id: "test", channels: expect.arrayContaining(["map", "detection"]) }),
        expect.objectContaining({ id: "api-test", channels: expect.arrayContaining(["spatial", "perception"]) })
      ])
    });

    const noFly = await context.api("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        kind: "no_fly_zone.add",
        target: { bounds: { x: 30, y: 22, width: 3, height: 3 } },
        params: { bounds: { x: 30, y: 22, width: 3, height: 3 }, reason: "API contract test" },
        requestedBy: "operator"
      })
    });
    expect(noFly).toMatchObject({ ok: true, state: { noFlyZones: expect.arrayContaining([{ x: 30, y: 22, width: 3, height: 3 }]) } });

    const evidence = await context.raw("/api/evidence/missing");
    expect(evidence.status).toBe(404);

    const proposal = await context.api("/api/ai/proposals", { method: "POST", body: "{}" });
    expect(proposal).toMatchObject({ ok: true, proposal: { diff: expect.any(Array) } });
    const approve = await context.raw(`/api/ai/proposals/${proposal.proposal.id}/approve`, { method: "POST" });
    expect([202, 409]).toContain(approve.status);
    if (approve.status === 202) expect(await approve.json()).toMatchObject({ ok: true, state: { proposals: expect.any(Array) } });
    expect((await context.raw("/api/ai/proposals/missing/approve", { method: "POST" })).status).toBe(404);

    const manifest = await context.api("/api/missions/seekr-local-v1/export");
    expect(manifest).toMatchObject({
      eventCount: expect.any(Number),
      finalStateHash: expect.any(String),
      scenarioId: expect.any(String),
      runMetadata: {
        session: { missionId: "seekr-local-v1", eventCount: expect.any(Number) },
        config: { auth: { tokenRedacted: true }, safety: { commandUploadEnabled: false } }
      }
    });
    expect((await context.raw("/api/missions/missing/export")).status).toBe(404);
    expect(await context.api("/api/replays")).toEqual(expect.arrayContaining([
      expect.objectContaining({ replayId: manifest.replayId, integrity: expect.objectContaining({ ok: true, errors: [] }) })
    ]));
    expect(await context.api(`/api/replays/${manifest.replayId}/verify`)).toMatchObject({ ok: true, replayId: manifest.replayId, integrity: { ok: true, errors: [] } });
    const readinessAfterExport = await context.api<any>("/api/readiness");
    expect(readinessAfterExport.summary.replayCount).toBeGreaterThan(0);
    expect(readinessAfterExport.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: "persisted-replay", status: "pass" })]));
    expect(await context.api(`/api/replays/${manifest.replayId}/start`, { method: "POST", body: "{}" })).toMatchObject({
      ok: true,
      mode: "replay",
      totalEventCount: manifest.eventCount
    });
    expect((await context.raw(`/api/replays/${manifest.replayId}/start`, { method: "POST", body: JSON.stringify({ seq: "bad" }) })).status).toBe(400);
    expect(await context.api(`/api/replays/${manifest.replayId}/seek`, { method: "POST", body: JSON.stringify({ seq: 0 }) })).toMatchObject({
      currentSeq: 0,
      state: { stateSeq: 0 }
    });
    expect((await context.raw(`/api/replays/${manifest.replayId}/seek`, { method: "POST", body: JSON.stringify({ seq: 0, speed: 3 }) })).status).toBe(400);
    expect(await context.api(`/api/replays/${manifest.replayId}/state`)).toMatchObject({ ok: true, replayId: manifest.replayId });
    expect((await context.raw("/api/replays/missing/state")).status).toBe(404);

    const report = await context.raw("/api/missions/seekr-local-v1/report", { headers: { Accept: "text/markdown" } });
    expect(report.status).toBe(200);
    expect(await report.text()).toContain("Final state hash");
    const incidentLog = await context.raw("/api/missions/seekr-local-v1/incident-log", { headers: { Accept: "text/markdown" } });
    expect(incidentLog.status).toBe(200);
    expect(await incidentLog.text()).toContain("SEEKR Incident Log");
    expect(await context.api("/api/missions/seekr-local-v1/incident-log?format=json")).toMatchObject({
      ok: true,
      log: { mode: "read-only-incident-log", timeline: expect.any(Array), safetyNotes: expect.any(Array) }
    });
    expect(await context.api("/api/missions/seekr-local-v1/report?format=json")).toMatchObject({
      ok: true,
      report: { timeline: expect.any(Array), droneHealth: expect.any(Array), spatialSceneSummary: expect.any(Object), incidentLog: expect.any(Object), limitations: expect.any(Array) }
    });
    expect(await context.api("/api/missions/seekr-local-v1/verify")).toMatchObject({ ok: true, finalStateHash: expect.any(String) });
  });

  it("covers local fixture ingest endpoints", async () => {
    expect(await context.api("/api/ingest/fixtures/mavlink/heartbeat", { method: "POST" })).toMatchObject({ ok: true, ingested: 1 });
    expect(await context.api("/api/ingest/fixtures/mavlink/unknown-message", { method: "POST" })).toMatchObject({ ok: true, ignored: 1 });
    expect(await context.api("/api/ingest/fixtures/ros2-map/occupancy-grid", { method: "POST" })).toMatchObject({ ok: true });
    expect(await context.api("/api/ingest/fixtures/ros2-map/nvblox-costmap", { method: "POST" })).toMatchObject({
      ok: true,
      mapDelta: { sourceAdapter: "isaac-nvblox", metadata: { sourceChannels: expect.arrayContaining(["costmap"]) } }
    });
    expect((await context.raw("/api/ingest/fixtures/ros2-map/low-transform-confidence", { method: "POST" })).status).toBe(400);
    expect(await context.api("/api/ingest/fixtures/detection/evidence-linked-detection", { method: "POST" })).toMatchObject({ ok: true });
    expect((await context.raw("/api/ingest/fixtures/detection/malformed-detection", { method: "POST" })).status).toBe(400);
    expect(await context.api("/api/ingest/fixtures/spatial/rubble-gaussian-splat", { method: "POST" })).toMatchObject({
      ok: true,
      state: { spatialAssets: expect.arrayContaining([expect.objectContaining({ kind: "gaussian-splat", status: "aligned" })]) }
    });
    expect(await context.api("/api/ingest/fixtures/spatial/lidar-point-cloud", { method: "POST" })).toMatchObject({
      ok: true,
      state: { spatialAssets: expect.arrayContaining([expect.objectContaining({ kind: "point-cloud", sourceAdapter: "lidar-slam", status: "aligned" })]) }
    });
    expect(await context.api("/api/ingest/fixtures/spatial/vps-pose-fix", { method: "POST" })).toMatchObject({
      ok: true,
      state: {
        drones: expect.arrayContaining([expect.objectContaining({ id: "drone-2", mode: "vps-localized", position: { x: 5, y: 15, z: 2 } })]),
        spatialAssets: expect.arrayContaining([expect.objectContaining({ kind: "vps-pose", droneId: "drone-2" })])
      }
    });
    expect(await context.api("/api/import/fixtures/spatial-manifest", { method: "POST" })).toMatchObject({
      ok: true,
      summary: { kind: "spatial-manifest", counts: { "gaussian-splat": 1 }, rejected: [] }
    });
    expect(await context.api("/api/import/fixtures/rosbag-lite", { method: "POST" })).toMatchObject({
      ok: true,
      summary: { kind: "rosbag-lite", counts: { telemetry: 1, spatialAsset: 1 }, rejected: [] }
    });
    expect(await context.api("/api/import/fixtures/lidar-perception-bag-lite", { method: "POST" })).toMatchObject({
      ok: false,
      summary: { kind: "rosbag-lite", counts: { telemetry: 1, mapDelta: 1, spatialAsset: 1 }, rejected: [expect.objectContaining({ type: "spatialAsset" })] }
    });
    expect(await context.api("/api/import/fixtures/isaac-sim-hil-lite", { method: "POST" })).toMatchObject({
      ok: true,
      summary: { kind: "rosbag-lite", counts: { telemetry: 1, mapDelta: 1, detection: 1, spatialAsset: 1 }, rejected: [] },
      state: {
        spatialAssets: expect.arrayContaining([expect.objectContaining({ sourceAdapter: "isaac-sim-hil", kind: "point-cloud" })]),
        detections: expect.arrayContaining([expect.objectContaining({ sourceAdapter: "isaac-sim-hil", kind: "person" })])
      }
    });
    const importedEvents = await context.api<any>("/api/import/fixtures/mission-events-replay-parity", { method: "POST" });
    expect(importedEvents).toMatchObject({
      ok: true,
      summary: { kind: "mission-events", counts: { missionEvent: 1 }, rejected: [] },
      state: {
        stateSeq: 2,
        drones: expect.arrayContaining([expect.objectContaining({ id: "drone-1", batteryPct: 89, mode: "AUTO" })])
      }
    });
    expect(await context.api("/api/verify")).toMatchObject({ ok: true, eventCount: 2 });
    const parityManifest = await context.api<any>("/api/missions/seekr-local-v1/export");
    expect(parityManifest).toMatchObject({
      eventCount: 2,
      finalStateHash: importedEvents.summary.finalStateHash,
      eventLog: expect.arrayContaining([expect.objectContaining({ eventId: "evt-00000001", hash: "38adc536cbddfed27fed6e08f8af5880702fe7e82e8b22480635f6a0a09dbc18" })])
    });
    expect(await context.api(`/api/replays/${parityManifest.replayId}/verify`)).toMatchObject({ integrity: { ok: true, errors: [] } });
    expect(await context.api("/api/import/spatial-manifest", {
      method: "POST",
      body: JSON.stringify({ importId: "api-manifest-inline", assets: [{ ...spatialAsset(), assetId: "api-spatial-manifest-1" }] })
    })).toMatchObject({ ok: true, summary: { importId: "api-manifest-inline", counts: { "gaussian-splat": 1 } } });
    expect(await context.api("/api/import/rosbag-lite", {
      method: "POST",
      body: JSON.stringify({ importId: "api-bag-partial", records: [{ type: "spatialAsset", asset: { ...spatialAsset(), assetId: "api-bag-spatial-1" } }, { type: "unknown" }] })
    })).toMatchObject({ ok: false, summary: { rejected: [expect.objectContaining({ type: "unknown" })] } });
  });

  it("exposes acceptance release checksum and command-boundary scan summaries in the session manifest", async () => {
    writeAcceptanceStatus({
      ok: true,
      generatedAt: Date.now(),
      schemaVersion: SEEKR_SCHEMA_VERSION,
      softwareVersion: SEEKR_SOFTWARE_VERSION,
      cwd: "/tmp/seekr",
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
      completedCommands: REQUIRED_ACCEPTANCE_COMMANDS,
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest",
        caseCount: REQUIRED_STRICT_AI_SMOKE_CASES.length,
        caseNames: [...REQUIRED_STRICT_AI_SMOKE_CASES],
        generatedAt: Date.now()
      },
      releaseChecksum: {
        jsonPath: ".tmp/release-evidence/release.json",
        sha256Path: ".tmp/release-evidence/release.sha256",
        markdownPath: ".tmp/release-evidence/release.md",
        overallSha256: "b".repeat(64),
        fileCount: 221,
        totalBytes: 4_943_380
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
    }, process.env.SEEKR_ACCEPTANCE_STATUS_PATH);

    await expect(context.api("/api/session")).resolves.toMatchObject({
      acceptance: {
        ok: true,
        status: "pass",
        commandUploadEnabled: false,
        releaseChecksum: {
          overallSha256: "b".repeat(64),
          fileCount: 221,
          totalBytes: 4_943_380
        },
        commandBoundaryScan: {
          status: "pass",
          scannedFileCount: 109,
          violationCount: 0,
          allowedFindingCount: 36
        }
      }
    });
  });

  it("protects mutating routes when internal auth is configured without leaking the token", async () => {
    process.env["SEEKR_INTERNAL_TOKEN"] = "alpha-secret";

    const session = await context.raw("/api/session");
    expect(session.status).toBe(200);
    const sessionText = await session.text();
    expect(sessionText).toContain("\"internalAuthEnabled\":true");
    expect(sessionText).not.toContain("alpha-secret");
    const config = await context.raw("/api/config");
    expect(config.status).toBe(200);
    const configText = await config.text();
    expect(configText).toContain("\"tokenRedacted\":true");
    expect(configText).not.toContain("alpha-secret");

    expect((await context.raw("/api/readiness")).status).toBe(200);
    expect((await context.raw("/api/source-health")).status).toBe(200);

    const beforeEvents = await context.api<any[]>("/api/events?sinceSeq=0");
    await expectUnauthorized(context, "/api/commands", { kind: "mission.start", requestedBy: "operator" });
    await expectUnauthorized(context, "/api/ingest/telemetry", { type: "HEARTBEAT", sysid: "mav-1", system_status: "ACTIVE" });
    await expectUnauthorized(context, "/api/import/rosbag-lite", { importId: "auth-blocked", records: [] });
    await expectUnauthorized(context, "/api/ai/proposals", {});
    expect((await context.raw("/api/export")).status).toBe(401);
    expect((await context.raw("/api/replays/missing/start", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await context.raw("/api/mission/start", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await context.raw("/api/ingest/fixtures/mavlink/heartbeat", { method: "POST", body: "{}" })).status).toBe(401);
    expect(await context.api<any[]>("/api/events?sinceSeq=0")).toHaveLength(beforeEvents.length);

    const authorized = await context.api("/api/commands", {
      method: "POST",
      headers: { "x-seekr-token": "alpha-secret" },
      body: JSON.stringify({ kind: "mission.start", requestedBy: "operator" })
    });
    expect(authorized).toMatchObject({ ok: true, state: { phase: "running" } });

    expect((await context.raw("/api/missions/seekr-local-v1/export")).status).toBe(401);
    expect(await context.api("/api/missions/seekr-local-v1/export", {
      headers: { Authorization: "Bearer alpha-secret" }
    })).toMatchObject({ replayId: expect.any(String), eventCount: expect.any(Number) });
  });

  it("sends a snapshot envelope first and reconnects with the latest snapshot", async () => {
    const first = await wsMessage(context.wsUrl);
    expect(first).toMatchObject({
      type: "state.snapshot",
      missionId: "seekr-local-v1",
      seq: 0,
      sentAt: expect.any(Number),
      payload: { stateSeq: 0 }
    });

    await context.api("/api/commands", { method: "POST", body: JSON.stringify({ kind: "mission.start", requestedBy: "operator" }) });
    const second = await wsMessage(context.wsUrl);
    expect(second.seq).toBeGreaterThan(0);
    expect(second.payload.stateSeq).toBe(second.seq);
  });
});

async function startTestServer() {
  const root = await mkdtemp(path.join(os.tmpdir(), "seekr-api-"));
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(jsonBodyErrorHandler);
  const server = http.createServer(app);
  const persistence = new MissionPersistence(root);
  await persistence.init();
  const store = new MissionStore({ clock: fixedClock, eventStore: persistence.events });
  const { broadcastSnapshot, wss } = attachWebSocket(server, store);
  store.onEvent(broadcastSnapshot);
  app.use("/api", createApiRouter(store, persistence));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    api: <T = any>(route: string, options: RequestInit = {}) => request<T>(`http://127.0.0.1:${port}${route}`, options),
    raw: (route: string, options: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${route}`, withJson(options)),
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: async () => {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function expectUnauthorized(context: Awaited<ReturnType<typeof startTestServer>>, route: string, body: unknown) {
  const response = await context.raw(route, { method: "POST", body: JSON.stringify(body) });
  expect(response.status).toBe(401);
}

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, withJson(options));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return (await response.json()) as T;
}

function withJson(options: RequestInit): RequestInit {
  return {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  };
}

function wsMessage(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("message", (data) => {
      socket.close();
      resolve(JSON.parse(String(data)));
    });
    socket.once("error", reject);
  });
}

function mapDelta() {
  return {
    deltaId: "api-map-delta-1",
    sourceDroneId: "api-drone",
    sourceAdapter: "test",
    frameId: "map",
    transformConfidence: 0.9,
    createdAt: fixedClock(),
    cells: [{ x: 6, y: 6, occupancy: "free", probability: 0.1, confidence: 0.8 }]
  };
}

function detection() {
  return {
    id: "api-det-1",
    droneId: "drone-1",
    kind: "person",
    position: { x: 7, y: 7, z: 2 },
    confidence: 90,
    severity: "P1",
    review: "new",
    createdAt: fixedClock(),
    updatedAt: fixedClock(),
    sourceAdapter: "test",
    immutable: true,
    evidenceAssetIds: [],
    evidence: { frameId: "api-frame", thumbnailTone: "red", notes: "api fixture" }
  };
}

function spatialAsset() {
  return {
    assetId: "api-spatial-splat-1",
    kind: "gaussian-splat",
    uri: "local://spatial/api/splat-1.splat",
    sourceAdapter: "api-test",
    frameId: "map",
    createdAt: fixedClock(),
    position: { x: 8, y: 8, z: 1 },
    confidence: 0.86,
    transformConfidence: 0.84,
    linkedDetectionIds: ["api-det-1"],
    evidenceAssetIds: [],
    assetFormat: "splat",
    coordinateSystem: "mission-local",
    bounds: { x: 6, y: 6, width: 5, height: 5 },
    sampleCount: 48,
    renderHints: { color: "#50d7b8" },
    metadata: { technique: "3d-gaussian-splatting" }
  };
}
