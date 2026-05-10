import { readFile } from "node:fs/promises";
import dgram from "node:dgram";
import { DetectionSchema, SpatialAssetSchema, TelemetrySampleSchema } from "../../shared/schemas";
import { parseMavlinkBinaryMessages } from "../adapters/mavlinkBinary";
import { normalizeMavlinkMessage } from "../adapters/mavlinkAdapter";
import { occupancyGridToMapDelta } from "../adapters/ros2SlamAdapter";
import { readFixture } from "../fixtures";

export interface ReadOnlyBridgeOptions {
  baseUrl?: string;
  dryRun?: boolean;
  fixtureNames?: string[];
  inputPath?: string;
  inputText?: string;
  binaryInputPath?: string;
  binaryInput?: Uint8Array;
  inputHex?: string;
  udpHost?: string;
  udpPort?: number;
  durationMs?: number;
  maxPackets?: number;
  ros2Topic?: string;
  onListening?: (listener: { host: string; port: number }) => void;
  internalToken?: string;
  receivedAt?: number;
  missionId?: string;
}

export interface BridgeRejectedRecord {
  index: number;
  type: string;
  reason: string;
}

export interface BridgeRunResult {
  ok: boolean;
  mode: "mavlink-telemetry" | "ros2-map" | "ros2-readonly" | "spatial-assets";
  endpoint: string;
  endpoints?: string[];
  dryRun: boolean;
  inputCount: number;
  acceptedCount: number;
  postedCount: number;
  rejected: BridgeRejectedRecord[];
  commandEndpointsTouched: false;
  listener?: {
    protocol: "udp";
    host: string;
    port: number;
    durationMs: number;
    maxPackets: number;
    packetCount: number;
  };
}

export async function runMavlinkReadOnlyBridge(options: ReadOnlyBridgeOptions = {}): Promise<BridgeRunResult> {
  if (typeof options.udpPort === "number") return runMavlinkUdpReadOnlyBridge(options);

  const loaded = await loadMavlinkInputs(options);
  const endpoint = apiUrl(options.baseUrl, "/ingest/telemetry");
  return postMavlinkRecords(endpoint, loaded.records, loaded.rejectedFrames, options);
}

async function runMavlinkUdpReadOnlyBridge(options: ReadOnlyBridgeOptions): Promise<BridgeRunResult> {
  const port = options.udpPort ?? 0;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("udpPort must be a valid UDP port.");
  const host = options.udpHost ?? "127.0.0.1";
  const durationMs = Math.min(Math.max(Number(options.durationMs ?? 5_000), 1), 600_000);
  const maxPackets = Math.max(1, Math.floor(Number(options.maxPackets ?? 100)));
  const endpoint = apiUrl(options.baseUrl, "/ingest/telemetry");
  const socket = dgram.createSocket("udp4");
  const records: unknown[] = [];
  const rejectedFrames: Array<{ offset: number; msgid?: number; reason: string }> = [];
  let packetCount = 0;

  return await new Promise<BridgeRunResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => void finish(), durationMs);

    const finish = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (packetCount === 0) {
        rejectedFrames.push({ offset: 0, reason: "No UDP MAVLink datagrams received before listener stopped." });
      }
      socket.close();
      try {
        const result = await postMavlinkRecords(endpoint, records, rejectedFrames, options);
        resolve({
          ...result,
          listener: {
            protocol: "udp",
            host,
            port,
            durationMs,
            maxPackets,
            packetCount
          }
        });
      } catch (error) {
        reject(error);
      }
    };

    socket.on("message", (message) => {
      const parsed = parseMavlinkBinaryMessages(message);
      records.push(...parsed.messages);
      rejectedFrames.push(...parsed.rejectedFrames.map((frame) => ({
        offset: frame.offset,
        msgid: frame.msgid,
        reason: `packet ${packetCount}: ${frame.reason}`
      })));
      packetCount += 1;
      if (packetCount >= maxPackets) void finish();
    });
    socket.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.bind(port, host, () => {
      options.onListening?.({ host, port });
    });
  });
}

async function postMavlinkRecords(
  endpoint: string,
  records: unknown[],
  rejectedFrames: Array<{ offset: number; msgid?: number; reason: string }>,
  options: ReadOnlyBridgeOptions
): Promise<BridgeRunResult> {
  const rejected: BridgeRejectedRecord[] = rejectedFrames.map((frame) => ({
    index: frame.offset,
    type: typeof frame.msgid === "number" ? `mavlink-${frame.msgid}` : "mavlink-binary",
    reason: frame.reason
  }));
  let acceptedCount = 0;
  let postedCount = 0;
  const baseReceivedAt = options.receivedAt ?? Date.now();

  for (const [index, record] of records.entries()) {
    try {
      const sample = normalizeMavlinkMessage(asObject(record), baseReceivedAt + index);
      if (!sample) throw new Error("Unsupported MAVLink message");
      acceptedCount += 1;
      if (!options.dryRun) {
        await postJson(endpoint, sample, options.internalToken);
        postedCount += 1;
      }
    } catch (error) {
      rejected.push({ index, type: recordType(record), reason: formatError(error) });
    }
  }

  return {
    ok: rejected.length === 0,
    mode: "mavlink-telemetry",
    endpoint,
    dryRun: Boolean(options.dryRun),
    inputCount: records.length + rejectedFrames.length,
    acceptedCount,
    postedCount,
    rejected,
    commandEndpointsTouched: false
  };
}

async function loadMavlinkInputs(options: ReadOnlyBridgeOptions): Promise<{
  records: unknown[];
  rejectedFrames: Array<{ offset: number; msgid?: number; reason: string }>;
}> {
  if (options.binaryInput || options.binaryInputPath || options.inputHex) {
    const binary = options.binaryInput ?? (options.inputHex ? hexToBytes(options.inputHex) : await readFile(options.binaryInputPath ?? ""));
    const parsed = parseMavlinkBinaryMessages(binary);
    return { records: parsed.messages, rejectedFrames: parsed.rejectedFrames };
  }

  return {
    records: await loadInputs(options, "mavlink", ["heartbeat"]),
    rejectedFrames: []
  };
}

export async function runRos2MapReadOnlyBridge(options: ReadOnlyBridgeOptions = {}): Promise<BridgeRunResult> {
  const records = await loadInputs(options, "ros2-map", ["occupancy-grid"]);
  const endpoint = apiUrl(options.baseUrl, "/ingest/map-deltas");
  const rejected: BridgeRejectedRecord[] = [];
  let acceptedCount = 0;
  let postedCount = 0;
  const missionId = options.missionId ?? "seekr-local-v1";
  const baseCreatedAt = options.receivedAt ?? Date.now();

  for (const [index, record] of records.entries()) {
    try {
      const grid = asObject(record);
      const delta = occupancyGridToMapDelta(grid as unknown as Parameters<typeof occupancyGridToMapDelta>[0], missionId, baseCreatedAt + index);
      acceptedCount += 1;
      if (!options.dryRun) {
        await postJson(endpoint, delta, options.internalToken);
        postedCount += 1;
      }
    } catch (error) {
      rejected.push({ index, type: recordType(record), reason: formatError(error) });
    }
  }

  return {
    ok: rejected.length === 0,
    mode: "ros2-map",
    endpoint,
    dryRun: Boolean(options.dryRun),
    inputCount: records.length,
    acceptedCount,
    postedCount,
    rejected,
    commandEndpointsTouched: false
  };
}

export async function runRos2ReadOnlyBridge(options: ReadOnlyBridgeOptions = {}): Promise<BridgeRunResult> {
  const records = await loadRos2Inputs(options);
  const endpoints = {
    telemetry: apiUrl(options.baseUrl, "/ingest/telemetry"),
    map: apiUrl(options.baseUrl, "/ingest/map-deltas"),
    detection: apiUrl(options.baseUrl, "/ingest/detections"),
    spatial: apiUrl(options.baseUrl, "/ingest/spatial-assets")
  };
  const rejected: BridgeRejectedRecord[] = [];
  let acceptedCount = 0;
  let postedCount = 0;
  const missionId = options.missionId ?? "seekr-local-v1";
  const baseCreatedAt = options.receivedAt ?? Date.now();

  for (const [index, record] of records.entries()) {
    try {
      const normalized = normalizeRos2Record(record, missionId, baseCreatedAt + index);
      acceptedCount += 1;
      if (!options.dryRun) {
        await postJson(endpoints[normalized.kind], normalized.payload, options.internalToken);
        postedCount += 1;
      }
    } catch (error) {
      rejected.push({ index, type: recordType(record), reason: formatError(error) });
    }
  }

  return {
    ok: rejected.length === 0,
    mode: "ros2-readonly",
    endpoint: Object.values(endpoints).join(","),
    endpoints: Object.values(endpoints),
    dryRun: Boolean(options.dryRun),
    inputCount: records.length,
    acceptedCount,
    postedCount,
    rejected,
    commandEndpointsTouched: false
  };
}

export async function runSpatialReadOnlyBridge(options: ReadOnlyBridgeOptions = {}): Promise<BridgeRunResult> {
  const records = await loadInputs(options, "spatial", ["lidar-point-cloud"]);
  const endpoint = apiUrl(options.baseUrl, "/ingest/spatial-assets");
  const rejected: BridgeRejectedRecord[] = [];
  let acceptedCount = 0;
  let postedCount = 0;

  for (const [index, record] of records.entries()) {
    try {
      const asset = SpatialAssetSchema.parse(spatialAssetRecord(record));
      acceptedCount += 1;
      if (!options.dryRun) {
        await postJson(endpoint, asset, options.internalToken);
        postedCount += 1;
      }
    } catch (error) {
      rejected.push({ index, type: recordType(record), reason: formatError(error) });
    }
  }

  return {
    ok: rejected.length === 0,
    mode: "spatial-assets",
    endpoint,
    dryRun: Boolean(options.dryRun),
    inputCount: records.length,
    acceptedCount,
    postedCount,
    rejected,
    commandEndpointsTouched: false
  };
}

async function loadInputs(
  options: ReadOnlyBridgeOptions,
  fixtureKind: "mavlink" | "ros2-map" | "spatial",
  defaultFixtures: string[]
) {
  if (options.inputText) return parseInputText(options.inputText);
  if (options.inputPath) return parseInputText(await readFile(options.inputPath, "utf8"));

  const fixtureNames = options.fixtureNames?.length ? options.fixtureNames : defaultFixtures;
  const records = await Promise.all(fixtureNames.map((name) => readFixture(fixtureKind, name)));
  return records.flatMap((record) => Array.isArray(record) ? record : [record]);
}

async function loadRos2Inputs(options: ReadOnlyBridgeOptions) {
  if (options.inputText) return applyRos2TopicOption(parseInputText(options.inputText), options.ros2Topic);
  if (options.inputPath) return applyRos2TopicOption(parseInputText(await readFile(options.inputPath, "utf8")), options.ros2Topic);

  const fixtureNames = options.fixtureNames?.length ? options.fixtureNames : ["occupancy-grid"];
  const records = await Promise.all(fixtureNames.map((name) => readRos2Fixture(name)));
  return records.flatMap((record) => Array.isArray(record) ? record : [record]);
}

function applyRos2TopicOption(records: unknown[], topic?: string) {
  if (!topic) return records;
  return records.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return { topic, message: record };
    const candidate = record as Record<string, unknown>;
    return candidate.topic ? candidate : { topic, message: candidate };
  });
}

async function readRos2Fixture(name: string) {
  const [prefix, fixtureName] = name.includes(":") ? name.split(":", 2) : ["ros2-map", name];
  if (prefix === "ros2-map" || prefix === "map") return readFixture("ros2-map", fixtureName);
  if (prefix === "ros2-pose" || prefix === "pose" || prefix === "odometry") return readFixture("ros2-pose", fixtureName);
  if (prefix === "detection" || prefix === "detections") return readFixture("detection", fixtureName);
  if (prefix === "spatial" || prefix === "spatial-assets") return readFixture("spatial", fixtureName);
  throw new Error(`Unsupported ROS 2 fixture prefix ${prefix}`);
}

function parseInputText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown[] }).records)) {
      return (parsed as { records: unknown[] }).records;
    }
    return [parsed];
  } catch {
    return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);
  }
}

function hexToBytes(value: string) {
  const normalized = value.replace(/0x/gi, "").replace(/[\s:_-]+/g, "");
  if (!normalized || normalized.length % 2 !== 0 || /[^a-f0-9]/i.test(normalized)) {
    throw new Error("MAVLink hex input must contain an even number of hexadecimal characters.");
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

function apiUrl(baseUrl = "http://127.0.0.1:8787", route: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`}${route}`;
}

async function postJson(url: string, body: unknown, internalToken?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = internalToken ?? process.env.SEEKR_INTERNAL_TOKEN;
  if (token) headers.set("x-seekr-token", token);
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await responseError(response));
}

async function responseError(response: Response) {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as { error?: unknown; validation?: { blockers?: unknown[] } };
    if (parsed.validation?.blockers?.length) return `${response.status} ${parsed.validation.blockers.join("; ")}`;
    if (parsed.error) return `${response.status} ${String(parsed.error)}`;
  } catch {
    return `${response.status} ${text.slice(0, 180)}`;
  }
  return `${response.status} ${response.statusText}`;
}

function asObject(record: unknown): Record<string, unknown> {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Record must be an object");
  const candidate = record as Record<string, unknown>;
  const topicMessage = ros2TopicMessage(candidate);
  if (topicMessage) return { ...topicMessage, topic: candidate.topic };
  if (candidate.type === "mavlink" && candidate.message && typeof candidate.message === "object") return candidate.message as Record<string, unknown>;
  if (candidate.type === "ros2Map" && candidate.grid && typeof candidate.grid === "object") return candidate.grid as Record<string, unknown>;
  if ((candidate.type === "ros2Pose" || candidate.type === "poseStamped" || candidate.type === "odometry") && candidate.message && typeof candidate.message === "object") {
    return {
      ...(candidate.message as Record<string, unknown>),
      type: candidate.type,
      droneId: candidate.droneId,
      sourceDroneId: candidate.sourceDroneId,
      sourceAdapter: candidate.sourceAdapter,
      transformConfidence: candidate.transformConfidence
    };
  }
  return candidate;
}

function spatialAssetRecord(record: unknown) {
  const candidate = asObject(record);
  if (candidate.type === "spatialAsset" && candidate.asset && typeof candidate.asset === "object") return candidate.asset;
  if (candidate.asset && typeof candidate.asset === "object") return candidate.asset;
  return candidate;
}

function normalizeRos2Record(record: unknown, missionId: string, createdAt: number): { kind: "telemetry" | "map" | "detection" | "spatial"; payload: unknown } {
  const candidate = asObject(record);
  const type = String(candidate.type ?? "");
  const topic = stringValue(candidate.topic, "");
  if (topic) {
    if (!candidate.sourceAdapter) candidate.sourceAdapter = sourceAdapterFromRos2Topic(topic, "ros2-slam");
    const topicDroneId = droneIdFromRos2Topic(topic);
    if (topicDroneId && !candidate.droneId) candidate.droneId = topicDroneId;
    if (topicDroneId && !candidate.sourceDroneId) candidate.sourceDroneId = topicDroneId;
  }
  if (isRos2PoseRecord(candidate, topic)) {
    return { kind: "telemetry", payload: TelemetrySampleSchema.parse(ros2PoseToTelemetry(candidate, createdAt)) };
  }
  if (isRos2PointCloudRecord(candidate, topic)) {
    return { kind: "spatial", payload: SpatialAssetSchema.parse(ros2PointCloudToSpatialAsset(candidate, createdAt)) };
  }
  if (
    type === "detection" ||
    candidate.detection ||
    candidate.kind === "person" ||
    candidate.kind === "thermal-hotspot" ||
    candidate.kind === "motion-anomaly"
  ) {
    return { kind: "detection", payload: DetectionSchema.parse(detectionRecord(record)) };
  }
  if (type === "spatialAsset" || candidate.assetId || candidate.asset) {
    return { kind: "spatial", payload: SpatialAssetSchema.parse(spatialAssetRecord(record)) };
  }
  const delta = occupancyGridToMapDelta(candidate as unknown as Parameters<typeof occupancyGridToMapDelta>[0], missionId, createdAt);
  return { kind: "map", payload: delta };
}

function isRos2PoseRecord(candidate: Record<string, unknown>, topic = "") {
  const type = String(candidate.type ?? "").toLowerCase();
  const normalizedTopic = topic.toLowerCase();
  return (
    type === "ros2pose" ||
    type === "posestamped" ||
    type === "pose-stamped" ||
    type === "odometry" ||
    /(^|\/)(odom|odometry|pose|pose_stamped|tf_pose)(\/|$)/.test(normalizedTopic) ||
    Boolean(candidate.pose && !candidate.info && !candidate.data) ||
    Boolean(candidate.poseWithCovariance)
  );
}

function isRos2PointCloudRecord(candidate: Record<string, unknown>, topic = "") {
  const type = String(candidate.type ?? candidate.messageType ?? candidate.msgType ?? "").toLowerCase();
  const normalizedTopic = topic.toLowerCase();
  return (
    type.includes("pointcloud2") ||
    type === "point-cloud" ||
    /(^|\/)(points|pointcloud|point_cloud|lidar|velodyne|ouster|livox)(\/|$)/.test(normalizedTopic) ||
    (candidate.fields && candidate.point_step && candidate.row_step)
  );
}

function ros2PoseToTelemetry(candidate: Record<string, unknown>, fallbackReceivedAt: number) {
  const poseEnvelope = objectRecord(candidate.pose);
  const pose = objectRecord(poseEnvelope.pose ?? poseEnvelope);
  const position = objectRecord(pose.position);
  const twistEnvelope = objectRecord(candidate.twist);
  const twist = objectRecord(twistEnvelope.twist ?? twistEnvelope);
  const linear = objectRecord(twist.linear);
  const header = objectRecord(candidate.header);
  const frameId = stringValue(header.frame_id ?? candidate.frame_id ?? candidate.frameId, "map");
  const droneId = stringValue(candidate.droneId ?? candidate.sourceDroneId ?? candidate.child_frame_id ?? candidate.childFrameId, "ros2-pose");
  const receivedAt = timestampMs(header.stamp ?? candidate.stamp, fallbackReceivedAt);
  const sourceAdapter = stringValue(candidate.sourceAdapter, "ros2-pose");
  const transformConfidence = numberValue(candidate.transformConfidence, 0.85);

  return {
    sampleId: `${sourceAdapter}-${droneId}-${frameId}-${receivedAt}`,
    droneId,
    receivedAt,
    heartbeat: false,
    position: {
      x: numberValue(position.x, 0),
      y: numberValue(position.y, 0),
      z: numberValue(position.z, 0)
    },
    velocity: typeof twist.linear === "object"
      ? {
          x: numberValue(linear.x, 0),
          y: numberValue(linear.y, 0),
          z: numberValue(linear.z, 0)
        }
      : undefined,
    mode: "ros2-pose",
    estimatorQuality: Math.round(Math.max(0, Math.min(1, transformConfidence)) * 100),
    sourceAdapter
  };
}

function ros2PointCloudToSpatialAsset(candidate: Record<string, unknown>, fallbackCreatedAt: number) {
  const header = objectRecord(candidate.header);
  const topic = stringValue(candidate.topic, "/points");
  const frameId = stringValue(header.frame_id ?? candidate.frame_id ?? candidate.frameId, "lidar_map");
  const createdAt = timestampMs(header.stamp ?? candidate.stamp, fallbackCreatedAt);
  const sourceAdapter = stringValue(candidate.sourceAdapter, sourceAdapterFromRos2Topic(topic, "lidar-slam"));
  const width = Math.max(0, Math.floor(numberValue(candidate.width, 0)));
  const height = Math.max(1, Math.floor(numberValue(candidate.height, 1)));
  const pointCount = Math.max(0, width * height);
  const transformConfidence = Math.max(0, Math.min(1, numberValue(candidate.transformConfidence, 0.8)));
  const data = Array.isArray(candidate.data) ? candidate.data : [];
  const fields = Array.isArray(candidate.fields) ? candidate.fields.map((field) => {
    const fieldRecord = objectRecord(field);
    return {
      name: stringValue(fieldRecord.name, "unknown"),
      offset: numberValue(fieldRecord.offset, 0),
      datatype: numberValue(fieldRecord.datatype, 0),
      count: numberValue(fieldRecord.count, 1)
    };
  }) : [];

  return {
    assetId: `ros2-point-cloud-${slugValue(sourceAdapter)}-${createdAt}`,
    kind: "point-cloud",
    uri: `local://ros2-topic/${topic.replace(/^\/+/, "")}`,
    assetFormat: "preview-points",
    coordinateSystem: "map",
    bounds: { x: 0, y: 0, width: Math.max(1, Math.min(20, width || data.length || 1)), height: Math.max(1, Math.min(20, height || 1)) },
    sampleCount: pointCount || data.length,
    renderHints: { pointSize: 0.12 },
    sourceAdapter,
    frameId,
    createdAt,
    position: { x: 0, y: 0, z: 0 },
    orientation: {},
    confidence: transformConfidence,
    transformConfidence,
    linkedDetectionIds: [],
    evidenceAssetIds: [],
    status: "aligned",
    metadata: {
      sourceTopic: topic,
      messageType: stringValue(candidate.type ?? candidate.messageType ?? candidate.msgType, "sensor_msgs/msg/PointCloud2"),
      sourceChannels: ["lidar", "slam", "spatial"],
      height,
      width,
      pointStep: numberValue(candidate.point_step ?? candidate.pointStep, 0),
      rowStep: numberValue(candidate.row_step ?? candidate.rowStep, 0),
      isDense: Boolean(candidate.is_dense ?? candidate.isDense ?? false),
      fieldCount: fields.length,
      fields,
      dataBytesObserved: data.length,
      densityPointsPerM2: pointCount || data.length,
      safety: "read-only ROS 2 PointCloud2 metadata ingest; no flight command output"
    }
  };
}

function detectionRecord(record: unknown) {
  const candidate = asObject(record);
  if (candidate.type === "detection" && candidate.detection && typeof candidate.detection === "object") return candidate.detection;
  if (candidate.detection && typeof candidate.detection === "object") return candidate.detection;
  return candidate;
}

function ros2TopicMessage(candidate: Record<string, unknown>) {
  if (!candidate.topic || typeof candidate.topic !== "string") return undefined;
  const message = candidate.message ?? candidate.msg ?? candidate.payload;
  return message && typeof message === "object" && !Array.isArray(message) ? message as Record<string, unknown> : undefined;
}

function recordType(record: unknown) {
  if (!record || typeof record !== "object") return "unknown";
  return String((record as Record<string, unknown>).type ?? (record as Record<string, unknown>).msgid ?? (record as Record<string, unknown>).assetId ?? "unknown");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function timestampMs(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const stamp = objectRecord(value);
  if (Object.keys(stamp).length) {
    const sec = numberValue(stamp.sec ?? stamp.seconds, 0);
    const nanosec = numberValue(stamp.nanosec ?? stamp.nsec ?? stamp.nanoseconds, 0);
    const ms = sec * 1000 + Math.round(nanosec / 1_000_000);
    if (ms > 0) return ms;
  }
  return fallback;
}

function sourceAdapterFromRos2Topic(topic: string, fallback: string) {
  const normalized = topic.toLowerCase();
  if (/(^|\/)(odom|odometry|pose|pose_stamped|tf_pose)(\/|$)/.test(normalized)) return "ros2-pose";
  if (/(nvblox|costmap|voxel)/.test(normalized)) return "isaac-nvblox";
  if (/(lidar|points|pointcloud|point_cloud|velodyne|ouster|livox)/.test(normalized)) return "lidar-slam";
  if (/(detect|perception|vision|yolo|segment|sam)/.test(normalized)) return "ros2-perception";
  if (/(rtab)/.test(normalized)) return "rtab-map";
  if (/(lio_sam|lio-sam)/.test(normalized)) return "lio-sam";
  if (/(fast_lio|fast-lio)/.test(normalized)) return "fast-lio2";
  return fallback;
}

function slugValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || "ros2";
}

function droneIdFromRos2Topic(topic: string) {
  const segments = topic.split("/").map((segment) => segment.trim()).filter(Boolean);
  const explicit = segments.find((segment) => /^(drone|uav|vehicle|robot)[-_a-z0-9]*$/i.test(segment));
  if (explicit) return explicit;
  return undefined;
}
