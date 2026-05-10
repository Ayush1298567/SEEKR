import express from "express";
import dgram from "node:dgram";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBodyErrorHandler } from "../api/errors";
import { x25Crc } from "../adapters/mavlinkBinary";
import { createApiRouter } from "../api/routes";
import { runMavlinkReadOnlyBridge, runRos2MapReadOnlyBridge, runRos2ReadOnlyBridge, runSpatialReadOnlyBridge } from "../bridges/readOnlyBridge";
import { MissionPersistence } from "../persistence";
import { MissionStore } from "../state";
import { parseMavlinkBridgeArgs, writeMavlinkReadOnlyBridgeEvidence } from "../../../scripts/bridge-mavlink-readonly";
import { parseSpatialBridgeArgs, writeSpatialReadOnlyBridgeEvidence } from "../../../scripts/bridge-spatial-readonly";

describe("read-only bridge runners", () => {
  let context: Awaited<ReturnType<typeof startBridgeServer>>;
  const previousInternalToken = process.env.SEEKR_INTERNAL_TOKEN;

  beforeEach(async () => {
    delete process.env.SEEKR_INTERNAL_TOKEN;
    context = await startBridgeServer();
  });

  afterEach(async () => {
    await context.close();
    if (previousInternalToken === undefined) delete process.env.SEEKR_INTERNAL_TOKEN;
    else process.env["SEEKR_INTERNAL_TOKEN"] = previousInternalToken;
  });

  it("validates MAVLink and ROS 2 fixtures in dry-run mode without posting events", async () => {
    const mavlink = await runMavlinkReadOnlyBridge({ dryRun: true, fixtureNames: ["heartbeat", "battery-status"], receivedAt: 1_800_000_000_000 });
    const ros2 = await runRos2MapReadOnlyBridge({ dryRun: true, fixtureNames: ["occupancy-grid"], receivedAt: 1_800_000_000_000 });
    const ros2Mixed = await runRos2ReadOnlyBridge({
      dryRun: true,
      fixtureNames: ["occupancy-grid", "detection:evidence-linked-detection", "spatial:lidar-point-cloud"],
      receivedAt: 1_800_000_000_000
    });
    const spatial = await runSpatialReadOnlyBridge({ dryRun: true, fixtureNames: ["lidar-point-cloud"] });

    expect(mavlink).toMatchObject({ ok: true, acceptedCount: 2, postedCount: 0, commandEndpointsTouched: false });
    expect(ros2).toMatchObject({ ok: true, acceptedCount: 1, postedCount: 0, commandEndpointsTouched: false });
    expect(ros2Mixed).toMatchObject({ ok: true, mode: "ros2-readonly", acceptedCount: 3, postedCount: 0, commandEndpointsTouched: false });
    expect(spatial).toMatchObject({ ok: true, mode: "spatial-assets", acceptedCount: 1, postedCount: 0, commandEndpointsTouched: false });
    expect(await context.api<unknown[]>("/api/events?sinceSeq=0")).toHaveLength(0);
  });

  it("posts only ingest events and never creates command lifecycle records", async () => {
    const mavlink = await runMavlinkReadOnlyBridge({
      baseUrl: context.url,
      fixtureNames: ["heartbeat", "battery-status", "local-position-ned"],
      receivedAt: 1_800_000_000_000
    });
    const ros2 = await runRos2MapReadOnlyBridge({
      baseUrl: context.url,
      fixtureNames: ["occupancy-grid", "nvblox-costmap"],
      receivedAt: 1_800_000_001_000
    });
    const ros2Mixed = await runRos2ReadOnlyBridge({
      baseUrl: context.url,
      fixtureNames: ["detection:evidence-linked-detection", "spatial:lidar-point-cloud"],
      receivedAt: 1_800_000_002_000
    });
    const spatial = await runSpatialReadOnlyBridge({
      baseUrl: context.url,
      fixtureNames: ["lidar-point-cloud"]
    });

    expect(mavlink).toMatchObject({ ok: true, postedCount: 3, commandEndpointsTouched: false });
    expect(ros2).toMatchObject({ ok: true, postedCount: 2, commandEndpointsTouched: false });
    expect(ros2Mixed).toMatchObject({ ok: true, mode: "ros2-readonly", postedCount: 2, commandEndpointsTouched: false });
    expect(spatial).toMatchObject({ ok: true, postedCount: 1, commandEndpointsTouched: false });
    const events = await context.api<Array<{ type: string }>>("/api/events?sinceSeq=0");
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["telemetry.ingested", "map.delta.ingested", "detection.created", "spatial.asset.ingested"]));
    expect(events.map((event) => event.type).some((type) => type.startsWith("command."))).toBe(false);
    expect(await context.api("/api/state")).toMatchObject({ commandLifecycles: [] });
    expect(await context.api("/api/source-health")).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({ id: "mavlink", channels: ["telemetry"] }),
        expect.objectContaining({ id: "ros2-slam", channels: expect.arrayContaining(["map", "slam"]) }),
        expect.objectContaining({ id: "isaac-nvblox", channels: expect.arrayContaining(["map", "costmap", "perception"]) }),
        expect.objectContaining({ id: "lidar-slam", channels: expect.arrayContaining(["lidar", "slam", "spatial"]) })
      ])
    });
  });

  it("maps ROS 2 PoseStamped and Odometry records into read-only telemetry", async () => {
    const result = await runRos2ReadOnlyBridge({
      baseUrl: context.url,
      fixtureNames: ["pose:pose-stamped", "odometry:odometry"],
      receivedAt: 1_800_000_003_000
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "ros2-readonly",
      inputCount: 2,
      acceptedCount: 2,
      postedCount: 2,
      commandEndpointsTouched: false
    });
    const state = await context.api<{ commandLifecycles: unknown[]; drones: Array<{ id: string; position?: { x: number; y: number; z: number }; sourceAdapter: string; estimatorQuality: number }> }>("/api/state");
    expect(state.commandLifecycles).toEqual([]);
    expect(state.drones).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "drone-ros2-1", position: { x: 18, y: 12, z: 4 }, sourceAdapter: "ros2-pose", estimatorQuality: 91 }),
      expect.objectContaining({ id: "drone-ros2-odom", position: { x: 21, y: 14, z: 5 }, sourceAdapter: "ros2-pose", estimatorQuality: 88 })
    ]));
    expect(await context.api("/api/source-health")).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({ id: "ros2-pose", channels: ["telemetry"], droneIds: expect.arrayContaining(["drone-ros2-1", "drone-ros2-odom"]) })
      ])
    });
  });

  it("accepts ROS 2 topic echo envelopes for costmaps, poses, and point clouds", async () => {
    const topicEchoInput = [
      {
        topic: "/nvblox_node/static_map",
        msg: {
          header: { frame_id: "map", stamp: { sec: 1_800_000_004, nanosec: 0 } },
          info: {
            width: 2,
            height: 2,
            resolution: 1,
            origin: { position: { x: 0, y: 0, z: 0 } }
          },
          data: [-1, 0, 80, 20],
          transformConfidence: 0.86
        }
      },
      {
        topic: "/lidar/points",
        msg: {
          type: "sensor_msgs/msg/PointCloud2",
          header: { frame_id: "os_lidar", stamp: { sec: 1_800_000_004, nanosec: 200_000_000 } },
          height: 1,
          width: 3,
          fields: [
            { name: "x", offset: 0, datatype: 7, count: 1 },
            { name: "y", offset: 4, datatype: 7, count: 1 },
            { name: "z", offset: 8, datatype: 7, count: 1 }
          ],
          is_dense: true,
          point_step: 16,
          row_step: 48,
          data: [0, 0, 128, 63, 0, 0, 0, 64]
        }
      }
    ].map((record) => JSON.stringify(record)).join("\n");
    const topicEcho = await runRos2ReadOnlyBridge({
      baseUrl: context.url,
      inputText: topicEchoInput,
      receivedAt: 1_800_000_004_000
    });
    const poseTopic = await runRos2ReadOnlyBridge({
      baseUrl: context.url,
      inputText: JSON.stringify({
        header: { frame_id: "map", stamp: { sec: 1_800_000_004, nanosec: 400_000_000 } },
        pose: { position: { x: 31, y: 22, z: 6 } },
        transformConfidence: 0.93
      }),
      ros2Topic: "/drone-topic/pose",
      receivedAt: 1_800_000_004_300
    });

    expect(topicEcho).toMatchObject({
      ok: true,
      mode: "ros2-readonly",
      inputCount: 2,
      acceptedCount: 2,
      postedCount: 2,
      commandEndpointsTouched: false
    });
    expect(poseTopic).toMatchObject({
      ok: true,
      acceptedCount: 1,
      postedCount: 1,
      commandEndpointsTouched: false
    });
    const state = await context.api<{
      commandLifecycles: unknown[];
      drones: Array<{ id: string; position?: { x: number; y: number; z: number }; sourceAdapter: string; estimatorQuality: number }>;
      spatialAssets: Array<{ kind: string; sourceAdapter: string; frameId: string; metadata: Record<string, unknown> }>;
    }>("/api/state");
    expect(state.commandLifecycles).toEqual([]);
    expect(state.drones).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "drone-topic", position: { x: 31, y: 22, z: 6 }, sourceAdapter: "ros2-pose", estimatorQuality: 93 })
    ]));
    expect(state.spatialAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "point-cloud",
        sourceAdapter: "lidar-slam",
        frameId: "os_lidar",
        metadata: expect.objectContaining({
          sourceTopic: "/lidar/points",
          sourceChannels: ["lidar", "slam", "spatial"],
          width: 3,
          fieldCount: 3
        })
      })
    ]));
    expect(await context.api("/api/source-health")).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({ id: "isaac-nvblox", channels: expect.arrayContaining(["costmap", "map"]) }),
        expect.objectContaining({ id: "lidar-slam", channels: expect.arrayContaining(["lidar", "spatial"]) }),
        expect.objectContaining({ id: "ros2-pose", channels: ["telemetry"], droneIds: expect.arrayContaining(["drone-topic"]) })
      ])
    });
  });

  it("parses binary MAVLink captures without touching command endpoints", async () => {
    const capturePath = path.join(context.root, "mavlink-capture.bin");
    await writeFile(capturePath, Buffer.concat([
      mavlinkV2Frame(0, heartbeatPayload({ systemStatus: 4 })),
      mavlinkV2Frame(32, localPositionPayload({ x: 4, y: 7, z: -3, vx: 1, vy: 2, vz: -1 }))
    ]));

    const result = await runMavlinkReadOnlyBridge({
      baseUrl: context.url,
      binaryInputPath: capturePath,
      receivedAt: 1_800_000_003_000
    });

    expect(result).toMatchObject({
      ok: true,
      inputCount: 2,
      acceptedCount: 2,
      postedCount: 2,
      commandEndpointsTouched: false
    });
    const state = await context.api<{ commandLifecycles: unknown[]; drones: Array<{ id: string; position?: { x: number; y: number; z: number } }> }>("/api/state");
    expect(state.commandLifecycles).toEqual([]);
    expect(state.drones).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "42", position: { x: 7, y: 4, z: 3 } })
    ]));
  });

  it("rejects corrupted MAVLink binary frames before posting telemetry", async () => {
    const frame = mavlinkV2Frame(0, heartbeatPayload({ systemStatus: 4 }));
    frame[frame.length - 1] ^= 0xff;

    const result = await runMavlinkReadOnlyBridge({ dryRun: true, binaryInput: frame });

    expect(result).toMatchObject({
      ok: false,
      inputCount: 1,
      acceptedCount: 0,
      postedCount: 0,
      commandEndpointsTouched: false,
      rejected: [expect.objectContaining({ reason: "MAVLink v2 checksum mismatch" })]
    });
  });

  it("listens to MAVLink UDP datagrams as read-only telemetry", async () => {
    const udpPort = await freeUdpPort();
    let markListening!: () => void;
    const listening = new Promise<void>((resolve) => {
      markListening = resolve;
    });
    const run = runMavlinkReadOnlyBridge({
      baseUrl: context.url,
      udpHost: "127.0.0.1",
      udpPort,
      maxPackets: 1,
      durationMs: 1_000,
      receivedAt: 1_800_000_004_000,
      onListening: markListening
    });

    await listening;
    const sender = dgram.createSocket("udp4");
    await sendUdp(sender, Buffer.concat([
      mavlinkV2Frame(0, heartbeatPayload({ systemStatus: 4 })),
      mavlinkV2Frame(32, localPositionPayload({ x: 6, y: 9, z: -4, vx: 1, vy: 2, vz: -1 }))
    ]), udpPort);
    sender.close();

    const result = await run;

    expect(result).toMatchObject({
      ok: true,
      inputCount: 2,
      acceptedCount: 2,
      postedCount: 2,
      commandEndpointsTouched: false,
      listener: expect.objectContaining({ protocol: "udp", packetCount: 1 })
    });
    const state = await context.api<{ commandLifecycles: unknown[]; drones: Array<{ id: string; position?: { x: number; y: number; z: number } }> }>("/api/state");
    expect(state.commandLifecycles).toEqual([]);
    expect(state.drones).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "42", position: { x: 9, y: 6, z: 4 } })
    ]));
  });

  it("writes persisted evidence for MAVLink UDP read-only bench runs", async () => {
    const udpPort = await freeUdpPort();
    let markListening!: () => void;
    const listening = new Promise<void>((resolve) => {
      markListening = resolve;
    });
    const run = writeMavlinkReadOnlyBridgeEvidence({
      root: context.root,
      outDir: ".tmp/bridge-evidence",
      evidenceLabel: "mavlink-udp-bench",
      baseUrl: context.url,
      udpHost: "127.0.0.1",
      udpPort,
      maxPackets: 1,
      durationMs: 1_000,
      receivedAt: 1_800_000_004_000,
      onListening: markListening,
      generatedAt: "2026-05-09T22:30:00.000Z"
    });

    await listening;
    const sender = dgram.createSocket("udp4");
    await sendUdp(sender, Buffer.concat([
      mavlinkV2Frame(0, heartbeatPayload({ systemStatus: 4 })),
      mavlinkV2Frame(32, localPositionPayload({ x: 6, y: 9, z: -4, vx: 1, vy: 2, vz: -1 }))
    ]), udpPort);
    sender.close();

    const evidence = await run;

    expect(evidence.jsonPath).toContain(`${path.sep}.tmp${path.sep}bridge-evidence${path.sep}`);
    expect(evidence.manifest).toMatchObject({
      status: "pass",
      commandUploadEnabled: false,
      validation: {
        ok: true,
        blockers: []
      },
      bridgeResult: {
        mode: "mavlink-telemetry",
        acceptedCount: 2,
        postedCount: 2,
        commandEndpointsTouched: false,
        listener: expect.objectContaining({ protocol: "udp", packetCount: 1 }),
        safety: {
          commandUploadEnabled: false
        }
      }
    });
    await expect(readFile(evidence.jsonPath, "utf8")).resolves.toContain("\"protocol\": \"udp\"");
    await expect(readFile(evidence.markdownPath, "utf8")).resolves.toContain("SEEKR Bridge Evidence");
  });

  it("parses MAVLink bridge CLI evidence options", () => {
    expect(parseMavlinkBridgeArgs([
      "--base-url", "http://127.0.0.1:8787",
      "--udp-host", "127.0.0.1",
      "--udp-port", "14550",
      "--duration-ms", "30000",
      "--max-packets", "200",
      "--evidence-label", "mavlink-udp-bench",
      "--out-dir", ".tmp/bridge-evidence"
    ])).toMatchObject({
      baseUrl: "http://127.0.0.1:8787",
      udpHost: "127.0.0.1",
      udpPort: 14550,
      durationMs: 30000,
      maxPackets: 200,
      evidenceLabel: "mavlink-udp-bench",
      outDir: ".tmp/bridge-evidence"
    });
  });

  it("writes persisted evidence for spatial read-only bench runs", async () => {
    const evidence = await writeSpatialReadOnlyBridgeEvidence({
      root: context.root,
      outDir: ".tmp/bridge-evidence",
      evidenceLabel: "spatial-bench",
      baseUrl: context.url,
      fixtureNames: ["lidar-point-cloud"],
      generatedAt: "2026-05-09T22:45:00.000Z"
    });

    expect(evidence.jsonPath).toContain(`${path.sep}.tmp${path.sep}bridge-evidence${path.sep}`);
    expect(evidence.manifest).toMatchObject({
      status: "pass",
      commandUploadEnabled: false,
      validation: {
        ok: true,
        blockers: []
      },
      bridgeResult: {
        mode: "spatial-assets",
        acceptedCount: 1,
        postedCount: 1,
        commandEndpointsTouched: false,
        safety: {
          commandUploadEnabled: false
        }
      }
    });
    await expect(readFile(evidence.jsonPath, "utf8")).resolves.toContain("\"bridgeMode\": \"spatial-assets\"");
    await expect(readFile(evidence.markdownPath, "utf8")).resolves.toContain("Spatial bridge evidence must be paired");
    expect(await context.api("/api/source-health")).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({ id: "lidar-slam", channels: expect.arrayContaining(["lidar", "spatial"]) })
      ])
    });
  });

  it("parses spatial bridge CLI evidence options", () => {
    expect(parseSpatialBridgeArgs([
      "--base-url", "http://127.0.0.1:8787",
      "--fixture", "lidar-point-cloud",
      "--evidence-label", "spatial-bench",
      "--out-dir", ".tmp/bridge-evidence",
      "--mission-id", "seekr-local-v1",
      "--received-at", "1800000005000"
    ])).toMatchObject({
      baseUrl: "http://127.0.0.1:8787",
      fixtureNames: ["lidar-point-cloud"],
      evidenceLabel: "spatial-bench",
      outDir: ".tmp/bridge-evidence",
      missionId: "seekr-local-v1",
      receivedAt: 1_800_000_005_000
    });
  });

  it("uses the internal token for protected ingest routes", async () => {
    process.env["SEEKR_INTERNAL_TOKEN"] = "bridge-secret";
    await context.close();
    context = await startBridgeServer();

    const unauthorized = await runMavlinkReadOnlyBridge({
      baseUrl: context.url,
      fixtureNames: ["heartbeat"],
      internalToken: "wrong-secret",
      receivedAt: 1_800_000_000_000
    });
    expect(unauthorized).toMatchObject({ ok: false, postedCount: 0, rejected: [expect.objectContaining({ reason: expect.stringContaining("401") })] });

    const authorized = await runMavlinkReadOnlyBridge({
      baseUrl: context.url,
      fixtureNames: ["heartbeat"],
      internalToken: "bridge-secret",
      receivedAt: 1_800_000_000_001
    });
    expect(authorized).toMatchObject({ ok: true, postedCount: 1 });
  });
});

async function startBridgeServer() {
  const root = await mkdtemp(path.join(os.tmpdir(), "seekr-bridge-test-"));
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(jsonBodyErrorHandler);
  const server = http.createServer(app);
  const persistence = new MissionPersistence(root);
  await persistence.init();
  const store = new MissionStore({ clock: () => 1_800_000_000_000, eventStore: persistence.events });
  app.use("/api", createApiRouter(store, persistence));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    root,
    url: `http://127.0.0.1:${port}`,
    api: async <T>(route: string) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      if (!response.ok) throw new Error(`${route} returned ${response.status}`);
      return (await response.json()) as T;
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  };
}

const CRC_EXTRAS: Record<number, number> = {
  0: 50,
  32: 185
};

function mavlinkV2Frame(msgid: number, payload: Buffer) {
  const header = Buffer.from([
    0xfd,
    payload.length,
    0,
    0,
    17,
    42,
    1,
    msgid & 0xff,
    (msgid >> 8) & 0xff,
    (msgid >> 16) & 0xff
  ]);
  const crc = x25Crc(Buffer.concat([header.subarray(1), payload]), CRC_EXTRAS[msgid]);
  return Buffer.concat([header, payload, Buffer.from([crc & 0xff, (crc >> 8) & 0xff])]);
}

function heartbeatPayload(input: { systemStatus: number }) {
  const payload = Buffer.alloc(9);
  payload.writeUInt32LE(12, 0);
  payload[6] = 81;
  payload[7] = input.systemStatus;
  payload[8] = 3;
  return payload;
}

function localPositionPayload(input: { x: number; y: number; z: number; vx: number; vy: number; vz: number }) {
  const payload = Buffer.alloc(28);
  payload.writeUInt32LE(1000, 0);
  payload.writeFloatLE(input.x, 4);
  payload.writeFloatLE(input.y, 8);
  payload.writeFloatLE(input.z, 12);
  payload.writeFloatLE(input.vx, 16);
  payload.writeFloatLE(input.vy, 20);
  payload.writeFloatLE(input.vz, 24);
  return payload;
}

async function freeUdpPort() {
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
  const port = (socket.address() as AddressInfo).port;
  socket.close();
  return port;
}

async function sendUdp(socket: dgram.Socket, packet: Buffer, port: number) {
  await new Promise<void>((resolve, reject) => {
    socket.send(packet, port, "127.0.0.1", (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
