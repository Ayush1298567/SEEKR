import { afterEach, describe, expect, it } from "vitest";
import { buildSourceHealthReport } from "../sourceHealth";
import { MissionStore } from "../state";

const now = 1_800_000_000_000;
const fixedClock = () => now;
const previousExpectedSources = process.env.SEEKR_EXPECTED_SOURCES;
const previousStaleSourceMs = process.env.SEEKR_SOURCE_STALE_MS;

describe("source health reports", () => {
  afterEach(() => {
    if (previousExpectedSources === undefined) delete process.env.SEEKR_EXPECTED_SOURCES;
    else process.env.SEEKR_EXPECTED_SOURCES = previousExpectedSources;
    if (previousStaleSourceMs === undefined) delete process.env.SEEKR_SOURCE_STALE_MS;
    else process.env.SEEKR_SOURCE_STALE_MS = previousStaleSourceMs;
  });

  it("summarizes adapter, import, command, and AI sources without mutating events", () => {
    const store = new MissionStore({ clock: fixedClock });
    store.start();
    store.ingestTelemetry({
      sampleId: "src-health-mav-1",
      droneId: "mav-1",
      receivedAt: now,
      heartbeat: true,
      sourceAdapter: "mavlink"
    });
    store.ingestMapDelta({
      deltaId: "src-health-map-1",
      sourceDroneId: "drone-1",
      sourceAdapter: "ros2-slam",
      frameId: "map",
      transformConfidence: 0.9,
      createdAt: now,
      cells: [{ x: 4, y: 4, occupancy: "free", probability: 0.1, confidence: 0.8 }]
    });
    store.ingestDetection({
      id: "src-health-det-1",
      droneId: "drone-1",
      kind: "person",
      position: { x: 7, y: 7, z: 1 },
      confidence: 91,
      severity: "P1",
      review: "new",
      createdAt: now,
      updatedAt: now,
      sourceAdapter: "detector",
      immutable: true,
      evidenceAssetIds: [],
      evidence: { frameId: "src-health-frame", thumbnailTone: "red", notes: "source health fixture" }
    });
    store.ingestSpatialAsset({
      assetId: "src-health-splat-1",
      kind: "gaussian-splat",
      uri: "local://spatial/source-health/splat.splat",
      sourceAdapter: "spatial-pipeline",
      frameId: "map",
      createdAt: now,
      position: { x: 8, y: 8, z: 1 },
      confidence: 0.86,
      transformConfidence: 0.84
    });
    store.recordImportSummary("src-health-import", "rosbag-lite", { telemetry: 1 });
    const beforeEvents = store.allEvents().length;

    const report = buildSourceHealthReport(store.snapshot(), store.allEvents(), now);

    expect(report.ok).toBe(true);
    expect(report.summary.staleThresholdMs).toBe(120_000);
    expect(report.summary.channels).toEqual(expect.arrayContaining(["command", "telemetry", "map", "detection", "perception", "spatial", "import"]));
    expect(report.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "operator-command", status: "pass", channels: ["command"] }),
      expect.objectContaining({ id: "mavlink", label: "MAVLink", status: "pass", channels: ["telemetry"], droneIds: ["mav-1"], lastEventSeq: expect.any(Number) }),
      expect.objectContaining({ id: "ros2-slam", label: "ROS 2 SLAM", status: "pass", channels: expect.arrayContaining(["map", "slam"]) }),
      expect.objectContaining({ id: "detector", status: "pass", channels: expect.arrayContaining(["detection", "perception"]) }),
      expect.objectContaining({ id: "spatial-pipeline", status: "pass", channels: expect.arrayContaining(["spatial", "perception"]) }),
      expect.objectContaining({ id: "import:rosbag-lite", status: "pass", channels: ["import"] })
    ]));
    expect(store.allEvents()).toHaveLength(beforeEvents);
  });

  it("surfaces LiDAR, SLAM, costmap, and perception channels from spatial/map metadata", () => {
    const store = new MissionStore({ clock: fixedClock });
    store.ingestSpatialAsset({
      assetId: "src-health-lidar-cloud-1",
      kind: "point-cloud",
      uri: "local://spatial/source-health/lidar.pcd",
      sourceAdapter: "lidar-slam",
      frameId: "lidar_map",
      createdAt: now,
      position: { x: 8, y: 8, z: 1 },
      bounds: { x: 6, y: 6, width: 5, height: 5 },
      sampleCount: 120,
      confidence: 0.86,
      transformConfidence: 0.84,
      metadata: { sourceChannels: ["lidar", "slam", "spatial"], pointCount: 9000, densityPointsPerM2: 360 }
    });
    store.ingestMapDelta({
      deltaId: "src-health-nvblox-1",
      sourceDroneId: "drone-1",
      sourceAdapter: "isaac-nvblox",
      frameId: "map",
      transformConfidence: 0.86,
      createdAt: now,
      metadata: { sourceChannels: ["map", "costmap", "perception"] },
      cells: [{ x: 7, y: 7, occupancy: "occupied", probability: 0.82, confidence: 0.8 }]
    });
    store.ingestSpatialAsset({
      assetId: "src-health-isaac-hil-1",
      kind: "point-cloud",
      uri: "local://spatial/source-health/isaac-hil.pcd",
      sourceAdapter: "isaac-sim-hil",
      frameId: "isaac_sim_lidar",
      createdAt: now,
      position: { x: 10, y: 10, z: 2 },
      bounds: { x: 8, y: 8, width: 5, height: 5 },
      sampleCount: 140,
      confidence: 0.86,
      transformConfidence: 0.84,
      metadata: { sourceChannels: ["lidar", "slam", "spatial", "perception"] }
    });

    const report = buildSourceHealthReport(store.snapshot(), store.allEvents(), now);

    expect(report.summary.channels).toEqual(expect.arrayContaining(["lidar", "slam", "costmap", "perception"]));
    expect(report.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "lidar-slam", label: "LiDAR SLAM", channels: expect.arrayContaining(["lidar", "slam", "spatial"]) }),
      expect.objectContaining({ id: "isaac-nvblox", label: "Isaac ROS Nvblox", channels: expect.arrayContaining(["map", "costmap", "perception"]) }),
      expect.objectContaining({ id: "isaac-sim-hil", label: "Isaac Sim HIL", channels: expect.arrayContaining(["lidar", "slam", "spatial", "perception"]) })
    ]));
  });

  it("includes rejected import counts without mutating failed LiDAR records into state", async () => {
    const { importBagLite } = await import("../importers/bagLiteImporter");
    const store = new MissionStore({ clock: fixedClock });

    const summary = importBagLite(store, {
      importId: "source-health-rejected-lidar",
      records: [
        {
          type: "spatialAsset",
          asset: {
            assetId: "source-health-rejected-lidar",
            kind: "point-cloud",
            uri: "local://spatial/source-health/rejected.pcd",
            sourceAdapter: "lidar-slam",
            frameId: "lidar_map",
            createdAt: now,
            position: { x: 8, y: 8, z: 1 },
            bounds: { x: 6, y: 6, width: 5, height: 5 },
            sampleCount: 120,
            confidence: 0.86,
            transformConfidence: 0.1,
            metadata: { sourceChannels: ["lidar", "slam", "spatial"] }
          }
        }
      ]
    });

    const report = buildSourceHealthReport(store.snapshot(), store.allEvents(), now);

    expect(summary.ok).toBe(false);
    expect(store.snapshot().spatialAssets).toEqual([]);
    expect(report.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "import:rosbag-lite", rejectedCount: 1, details: expect.stringContaining("1 rejected record") })
    ]));
    expect(report.summary.rejectedCount).toBe(1);
  });

  it("warns when a live telemetry source is stale", () => {
    const store = new MissionStore({ clock: fixedClock });
    store.start();
    store.ingestTelemetry({
      sampleId: "src-health-stale-1",
      droneId: "mav-stale",
      receivedAt: now - 121_000,
      heartbeat: true,
      sourceAdapter: "mavlink"
    });

    const report = buildSourceHealthReport(store.snapshot(), store.allEvents(), now);

    expect(report.ok).toBe(true);
    expect(report.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mavlink", status: "warn", ageMs: 121_000 })
    ]));
    expect(report.summary.staleSourceIds).toContain("mavlink");
  });

  it("allows the live source stale threshold to be configured", () => {
    process.env.SEEKR_SOURCE_STALE_MS = "180000";
    const store = new MissionStore({ clock: fixedClock });
    store.start();
    store.ingestTelemetry({
      sampleId: "src-health-custom-stale-1",
      droneId: "mav-stale",
      receivedAt: now - 121_000,
      heartbeat: true,
      sourceAdapter: "mavlink"
    });

    const report = buildSourceHealthReport(store.snapshot(), store.allEvents(), now);

    expect(report.summary.staleThresholdMs).toBe(180_000);
    expect(report.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mavlink", status: "pass", ageMs: 121_000 })
    ]));
  });

  it("warns when an expected source has not produced events", () => {
    process.env.SEEKR_EXPECTED_SOURCES = "mavlink:telemetry:drone-1,ros2-slam:map";
    const store = new MissionStore({ clock: fixedClock });

    const report = buildSourceHealthReport(store.snapshot(), store.allEvents(), now);

    expect(report.summary.sourceCount).toBe(2);
    expect(report.summary.expectedSourceCount).toBe(2);
    expect(report.summary.staleSourceIds).toEqual(["mavlink", "ros2-slam"]);
    expect(report.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mavlink", expected: true, status: "warn", channels: ["telemetry"], droneIds: ["drone-1"] }),
      expect.objectContaining({ id: "ros2-slam", expected: true, status: "warn", channels: ["map"] })
    ]));
  });
});
