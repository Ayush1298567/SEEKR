import type {
  Detection,
  ExpectedSourceConfig,
  MapDelta,
  MissionEvent,
  MissionState,
  SourceHealthChannel,
  SourceHealthEntry,
  SourceHealthReport,
  SpatialAsset,
  TelemetrySample
} from "../shared/types";
import { loadLocalEnv } from "./env";

const STALE_SOURCE_MS = 120_000;
const STATUS_RANK: Record<SourceHealthEntry["status"], number> = { fail: 0, warn: 1, pass: 2 };

loadLocalEnv();

interface SourceAccumulator {
  id: string;
  label: string;
  sourceAdapter: string;
  expected: boolean;
  channels: Set<SourceHealthChannel>;
  eventCount: number;
  rejectedCount: number;
  lastEventSeq?: number;
  lastEventAt?: number;
  droneIds: Set<string>;
}

interface SourceSample {
  sourceAdapter: string;
  label: string;
  channels: SourceHealthChannel[];
  at: number;
  droneId?: string;
  rejectedCount?: number;
}

export function buildSourceHealthReport(state: MissionState, events: MissionEvent[], generatedAt = Date.now()): SourceHealthReport {
  const sources = new Map<string, SourceAccumulator>();
  const staleThresholdMs = configuredStaleSourceMs();

  events.forEach((event) => {
    const sample = sourceSampleFromEvent(event);
    if (!sample) return;
    const id = sourceId(sample.sourceAdapter);
    const source = sources.get(id) ?? {
      id,
      label: sample.label,
      sourceAdapter: sample.sourceAdapter,
      expected: false,
      channels: new Set<SourceHealthChannel>(),
      eventCount: 0,
      rejectedCount: 0,
      droneIds: new Set<string>()
    };
    source.eventCount += 1;
    source.rejectedCount += sample.rejectedCount ?? 0;
    sample.channels.forEach((channel) => source.channels.add(channel));
    if (sample.droneId) source.droneIds.add(sample.droneId);
    if (!source.lastEventSeq || event.seq > source.lastEventSeq) source.lastEventSeq = event.seq;
    if (typeof sample.at === "number" && (!source.lastEventAt || sample.at > source.lastEventAt)) source.lastEventAt = sample.at;
    sources.set(id, source);
  });

  configuredExpectedSources().forEach((expected) => {
    const id = sourceId(expected.sourceAdapter);
    const source = sources.get(id) ?? {
      id,
      label: expected.label ?? labelFor(expected.sourceAdapter),
      sourceAdapter: expected.sourceAdapter,
      expected: true,
      channels: new Set<SourceHealthChannel>(),
      eventCount: 0,
      rejectedCount: 0,
      droneIds: new Set<string>()
    };
    source.expected = true;
    expected.channels.forEach((channel) => source.channels.add(channel));
    expected.droneIds?.forEach((droneId) => source.droneIds.add(droneId));
    sources.set(id, source);
  });

  state.drones.forEach((drone) => {
    const adapter = drone.sourceAdapter || "unknown";
    const id = sourceId(adapter);
    const source = sources.get(id);
    if (!source) return;
    source.droneIds.add(drone.id);
    if (typeof drone.lastHeartbeat === "number" && (!source.lastEventAt || drone.lastHeartbeat > source.lastEventAt)) {
      source.lastEventAt = drone.lastHeartbeat;
    }
  });

  const entries = [...sources.values()]
    .map((source) => sourceEntry(source, generatedAt, state.phase, staleThresholdMs))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0) || a.id.localeCompare(b.id));

  const channels = [...new Set(entries.flatMap((entry) => entry.channels))].sort();
  const summary = {
    pass: entries.filter((entry) => entry.status === "pass").length,
    warn: entries.filter((entry) => entry.status === "warn").length,
    fail: entries.filter((entry) => entry.status === "fail").length,
    sourceCount: entries.length,
    eventCount: events.length,
    rejectedCount: entries.reduce((total, entry) => total + entry.rejectedCount, 0),
    expectedSourceCount: entries.filter((entry) => entry.expected).length,
    staleThresholdMs,
    channels,
    staleSourceIds: entries.filter((entry) => entry.status !== "pass").map((entry) => entry.id)
  };

  return {
    ok: summary.fail === 0,
    generatedAt,
    missionId: state.missionId,
    stateSeq: state.stateSeq,
    sources: entries,
    summary
  };
}

export function configuredStaleSourceMs() {
  const configured = Number(process.env.SEEKR_SOURCE_STALE_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : STALE_SOURCE_MS;
}

function sourceEntry(source: SourceAccumulator, generatedAt: number, phase: MissionState["phase"], staleThresholdMs: number): SourceHealthEntry {
  const channels = [...source.channels].sort();
  const ageMs = typeof source.lastEventAt === "number" ? Math.max(0, generatedAt - source.lastEventAt) : undefined;
  const missingExpected = source.expected && source.eventCount === 0;
  const stale = typeof ageMs === "number" && ageMs > staleThresholdMs;
  const hasLiveChannel = channels.some((channel) => ["telemetry", "map", "simulator", "lidar", "slam", "costmap", "perception"].includes(channel));
  const status: SourceHealthEntry["status"] = missingExpected || (stale && hasLiveChannel && phase === "running") ? "warn" : "pass";
  const detailParts = [
    `${source.eventCount} event${source.eventCount === 1 ? "" : "s"}`,
    `${channels.join(", ")} channel${channels.length === 1 ? "" : "s"}`
  ];
  if (source.rejectedCount) detailParts.push(`${source.rejectedCount} rejected record${source.rejectedCount === 1 ? "" : "s"}`);
  if (missingExpected) detailParts.push("expected source has not produced events");
  if (typeof ageMs === "number") detailParts.push(`last update ${Math.round(ageMs / 1000)}s ago`);
  if (source.droneIds.size) detailParts.push(`drones ${[...source.droneIds].sort().join(", ")}`);

  return {
    id: source.id,
    label: source.label,
    sourceAdapter: source.sourceAdapter,
    expected: source.expected,
    status,
    channels,
    eventCount: source.eventCount,
    rejectedCount: source.rejectedCount,
    lastEventSeq: source.lastEventSeq,
    lastEventAt: source.lastEventAt,
    ageMs,
    droneIds: [...source.droneIds].sort(),
    details: detailParts.join("; ")
  };
}

export function configuredExpectedSources(): ExpectedSourceConfig[] {
  const raw = process.env.SEEKR_EXPECTED_SOURCES;
  if (!raw) return [];
  const parsed = parseExpectedSourcesJson(raw);
  if (parsed) return parsed;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [sourceAdapter, channel = "telemetry", droneIds = ""] = item.split(":");
      return {
        sourceAdapter,
        channels: [normalizeChannel(channel)],
        droneIds: droneIds ? droneIds.split("|").filter(Boolean) : []
      };
    })
    .filter((source) => source.sourceAdapter);
}

function parseExpectedSourcesJson(raw: string): ExpectedSourceConfig[] | undefined {
  try {
    const value = JSON.parse(raw) as Array<Partial<ExpectedSourceConfig>>;
    if (!Array.isArray(value)) return undefined;
    return value
      .map((source) => ({
        sourceAdapter: String(source.sourceAdapter ?? ""),
        label: typeof source.label === "string" ? source.label : undefined,
        channels: Array.isArray(source.channels) && source.channels.length ? source.channels.map((channel) => normalizeChannel(String(channel))) : ["telemetry" as const],
        droneIds: Array.isArray(source.droneIds) ? source.droneIds.map(String) : []
      }))
      .filter((source) => source.sourceAdapter);
  } catch {
    return undefined;
  }
}

function normalizeChannel(value: string): SourceHealthChannel {
  if (["simulator", "telemetry", "map", "detection", "spatial", "lidar", "slam", "costmap", "perception", "import", "command", "ai", "replay"].includes(value)) {
    return value as SourceHealthChannel;
  }
  return "telemetry";
}

function sourceSampleFromEvent(event: MissionEvent): SourceSample | undefined {
  const payload = event.payload as Record<string, unknown>;

  if (event.type === "telemetry.ingested") {
    const sample = payload.sample as TelemetrySample | undefined;
    const adapter = String(sample?.sourceAdapter ?? "telemetry");
    return { sourceAdapter: adapter, label: labelFor(adapter), channels: inferChannels(adapter, ["telemetry"]), at: Number(sample?.receivedAt ?? event.createdAt), droneId: sample?.droneId };
  }

  if (event.type === "map.delta.ingested") {
    const mapDelta = payload.mapDelta as MapDelta | undefined;
    const adapter = String(mapDelta?.sourceAdapter ?? "map");
    const metadataChannels = channelsFromMetadata((mapDelta as unknown as { metadata?: unknown })?.metadata);
    return { sourceAdapter: adapter, label: labelFor(adapter), channels: inferChannels(adapter, ["map", ...metadataChannels]), at: Number(mapDelta?.createdAt ?? event.createdAt), droneId: mapDelta?.sourceDroneId };
  }

  if (event.type === "detection.created") {
    const detection = payload.detection as Detection | undefined;
    const adapter = String(detection?.sourceAdapter ?? "detection");
    return { sourceAdapter: adapter, label: labelFor(adapter), channels: inferChannels(adapter, ["detection", "perception"]), at: Number(detection?.createdAt ?? event.createdAt), droneId: detection?.droneId };
  }

  if (event.type === "spatial.asset.ingested") {
    const asset = payload.asset as SpatialAsset | undefined;
    const adapter = String(asset?.sourceAdapter ?? "spatial");
    const channels: SourceHealthChannel[] = ["spatial", ...channelsFromSpatialAsset(asset)];
    return { sourceAdapter: adapter, label: labelFor(adapter), channels: inferChannels(adapter, channels), at: Number(asset?.createdAt ?? event.createdAt), droneId: asset?.droneId };
  }

  if (event.type === "import.completed") {
    const adapter = `import:${String(payload.kind ?? "unknown")}`;
    const summary = payload.summary as { rejected?: unknown[] } | undefined;
    return { sourceAdapter: adapter, label: labelFor(adapter), channels: ["import"], at: event.createdAt, rejectedCount: Array.isArray(summary?.rejected) ? summary.rejected.length : 0 };
  }

  if (event.type === "simulator.tick") {
    return { sourceAdapter: "simulator", label: "Simulator", channels: ["simulator"], at: event.createdAt };
  }

  if (event.type === "command.lifecycle.updated") {
    return { sourceAdapter: "operator-command", label: "Operator Commands", channels: ["command"], at: event.createdAt };
  }

  if (event.type === "ai.proposal.created") {
    const proposal = payload.proposal as { provider?: string; model?: string } | undefined;
    const adapter = `ai:${String(proposal?.provider ?? "unknown")}`;
    return { sourceAdapter: adapter, label: proposal?.model ? `${labelFor(adapter)} / ${proposal.model}` : labelFor(adapter), channels: ["ai"], at: event.createdAt };
  }

  return undefined;
}

function sourceId(sourceAdapter: string) {
  return sourceAdapter.toLowerCase().replace(/[^a-z0-9._:-]/g, "-");
}

function labelFor(sourceAdapter: string) {
  if (sourceAdapter === "mavlink") return "MAVLink";
  if (sourceAdapter === "ros2-slam") return "ROS 2 SLAM";
  if (sourceAdapter === "lidar-slam") return "LiDAR SLAM";
  if (sourceAdapter === "isaac-nvblox") return "Isaac ROS Nvblox";
  if (sourceAdapter === "isaac-sim-hil") return "Isaac Sim HIL";
  if (sourceAdapter === "dimos-readonly") return "DimOS Read-Only";
  if (sourceAdapter === "rtab-map") return "RTAB-Map";
  if (sourceAdapter === "lio-sam") return "LIO-SAM";
  if (sourceAdapter === "fast-lio2") return "FAST-LIO2";
  if (sourceAdapter === "simulator") return "Simulator";
  if (sourceAdapter === "operator-command") return "Operator Commands";
  if (sourceAdapter.startsWith("import:")) return `Import ${sourceAdapter.slice("import:".length)}`;
  if (sourceAdapter.startsWith("ai:")) return `AI ${sourceAdapter.slice("ai:".length)}`;
  return sourceAdapter;
}

function inferChannels(sourceAdapter: string, channels: SourceHealthChannel[]) {
  const normalized = sourceAdapter.toLowerCase();
  const inferred = new Set<SourceHealthChannel>(channels);
  if (/(lidar|point.?cloud|velodyne|ouster|livox|realsense|zed)/.test(normalized)) inferred.add("lidar");
  if (/(slam|rtab|lio|vslam|odometry|dimos)/.test(normalized)) inferred.add("slam");
  if (/(costmap|nvblox|nav2|voxel)/.test(normalized)) inferred.add("costmap");
  if (/(perception|detector|vision|yolo|segment|sam|dimos)/.test(normalized)) inferred.add("perception");
  return [...inferred].sort();
}

function channelsFromSpatialAsset(asset?: SpatialAsset): SourceHealthChannel[] {
  if (!asset) return [];
  const channels = new Set<SourceHealthChannel>(channelsFromMetadata(asset.metadata));
  if (asset.kind === "point-cloud") channels.add("lidar");
  if (asset.kind === "mesh" || asset.kind === "gaussian-splat" || asset.kind === "4d-reconstruction" || asset.kind === "spatial-video") channels.add("perception");
  if (asset.kind === "vps-pose") channels.add("slam");
  return [...channels];
}

function channelsFromMetadata(metadata: unknown): SourceHealthChannel[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const value = (metadata as { sourceChannels?: unknown; channels?: unknown }).sourceChannels ?? (metadata as { channels?: unknown }).channels;
  if (!Array.isArray(value)) return [];
  return value.map((channel) => normalizeChannel(String(channel))).filter((channel, index, channels) => channels.indexOf(channel) === index);
}
