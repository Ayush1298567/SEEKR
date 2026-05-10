import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MissionPersistence } from "../persistence";
import { buildMissionReportData, buildMissionReportMarkdown } from "../report";
import { MissionStore } from "../state";

const fixedClock = () => 1_800_000_000_000;

describe("persistence, verification, and mission reports", () => {
  it("rebuilds state from persisted append-only events and validates snapshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-persist-"));
    try {
      const persistence = new MissionPersistence(root);
      await persistence.init();
      const store = new MissionStore({ clock: fixedClock, eventStore: persistence.events });
      store.start();
      for (let index = 0; index < 3; index += 1) store.tick(1);
      for (const event of store.allEvents()) await persistence.events.persistEvent(event);
      await persistence.writeSnapshot(store.snapshot());

      const snapshot = await persistence.snapshots.readSnapshot();
      expect(snapshot?.stateSeq).toBe(store.snapshot().stateSeq);

      const restoredPersistence = new MissionPersistence(root);
      await restoredPersistence.init();
      const restored = new MissionStore({ clock: fixedClock, eventStore: restoredPersistence.events });
      const events = await restoredPersistence.events.readPersisted();
      expect(restored.restoreFromEvents(events).ok).toBe(true);
      expect(restored.snapshot().stateSeq).toBe(store.snapshot().stateSeq);
      expect(restored.validateHashChain().ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes concurrent event persistence in hash-chain order", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-event-order-"));
    try {
      const persistence = new MissionPersistence(root);
      await persistence.init();
      const store = new MissionStore({ clock: fixedClock, eventStore: persistence.events });
      store.onEvent((event) => {
        void persistence.events.persistEvent(event);
      });
      store.start();
      await persistence.events.flush();

      const persisted = await persistence.events.readPersisted();
      expect(persisted.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(persistence.events.validateHashChain(persisted).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists exported replay manifests and reloads them on restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-replay-persist-"));
    try {
      const persistence = new MissionPersistence(root);
      await persistence.init();
      const store = new MissionStore({ clock: fixedClock, eventStore: persistence.events });
      store.start();
      store.tick(1);

      const manifest = await persistence.exportBundle(store.snapshot(), store.allEvents());
      expect(persistence.replays.list()).toEqual(expect.arrayContaining([expect.objectContaining({ replayId: manifest.replayId })]));
      expect(persistence.replays.verify(manifest.replayId)).toMatchObject({ ok: true, errors: [] });

      const restoredPersistence = new MissionPersistence(root);
      await restoredPersistence.init();
      expect(restoredPersistence.replays.list()).toEqual(expect.arrayContaining([
        expect.objectContaining({ replayId: manifest.replayId, integrity: expect.objectContaining({ ok: true, errors: [] }) })
      ]));
      expect(restoredPersistence.replays.get(manifest.replayId)).toMatchObject({
        replayId: manifest.replayId,
        eventCount: manifest.eventCount,
        finalStateHash: manifest.finalStateHash
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects tampered replay manifests on read", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-replay-tamper-"));
    try {
      const persistence = new MissionPersistence(root);
      await persistence.init();
      const store = new MissionStore({ clock: fixedClock, eventStore: persistence.events });
      store.start();
      const manifest = await persistence.exportBundle(store.snapshot(), store.allEvents());
      const manifestPath = path.join(root, "replays", `${manifest.replayId}.json`);
      const body = JSON.parse(await readFile(manifestPath, "utf8")) as typeof manifest;
      body.eventCount += 1;
      await writeFile(manifestPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");

      const restoredPersistence = new MissionPersistence(root);
      await restoredPersistence.init();

      expect(restoredPersistence.replays.list()).not.toEqual(expect.arrayContaining([expect.objectContaining({ replayId: manifest.replayId })]));
      expect(restoredPersistence.replays.get(manifest.replayId)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects tampered restored logs and generates Markdown reports with final hashes", () => {
    const store = new MissionStore({ clock: fixedClock });
    store.start();
    store.ingestSpatialAsset({
      assetId: "report-spatial-splat",
      kind: "gaussian-splat",
      uri: "local://spatial/report/splat.splat",
      sourceAdapter: "report-test",
      frameId: "map",
      createdAt: fixedClock(),
      position: { x: 8, y: 8, z: 1 },
      confidence: 0.86,
      transformConfidence: 0.84
    });
    const tampered = store.allEvents().map((event) => ({ ...event }));
    tampered[0] = { ...tampered[0], payload: { ...tampered[0].payload, tampered: true } };
    expect(store.validateHashChain(tampered).ok).toBe(false);

    const report = buildMissionReportMarkdown(store.snapshot(), store.allEvents(), store.validateHashChain());
    expect(report).toContain("## Mission Summary");
    expect(report).toContain("## AI Proposal Summary");
    expect(report).toContain("## Spatial Asset Summary");
    expect(report).toContain("## Passive Read-Only Plan");
    expect(report).toContain("## Incident Log Summary");
    expect(report).toContain("report-spatial-splat");
    expect(report).toContain("Final state hash");
    expect(report).toContain("Real MAVLink, ROS 2, or aircraft command upload is blocked in V1");

    const reportData = buildMissionReportData(store.snapshot(), store.allEvents(), store.validateHashChain());
    expect(reportData).toMatchObject({
      missionId: "seekr-local-v1",
      timeline: expect.arrayContaining([expect.objectContaining({ type: "mission.started" })]),
      droneHealth: expect.arrayContaining([expect.objectContaining({ id: "drone-1" })]),
      spatialAssets: expect.arrayContaining([expect.objectContaining({ assetId: "report-spatial-splat", kind: "gaussian-splat" })]),
      incidentLog: expect.objectContaining({ mode: "read-only-incident-log", hashChain: expect.objectContaining({ finalStateHash: expect.any(String) }) }),
      passivePlan: expect.objectContaining({ mode: "passive-read-only", nextActions: expect.any(Array) }),
      commandLifecycles: expect.arrayContaining([expect.objectContaining({ kind: "mission.start", status: "accepted" })]),
      limitations: expect.arrayContaining([
        "Real MAVLink, ROS 2, or aircraft command upload is blocked in V1.",
        "Gaussian splats, point clouds, meshes, 4D reconstructions, spatial video, and VPS/VSP pose fixes are local-first metadata ingest surfaces in V1."
      ])
    });
  });
});
