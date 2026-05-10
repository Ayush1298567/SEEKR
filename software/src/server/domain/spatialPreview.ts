import type { MissionState, SpatialAsset, Vec3 } from "../../shared/types";

export interface SpatialPreviewPoint extends Vec3 {
  intensity: number;
  color: string;
}

export interface SpatialPreview {
  assetId: string;
  kind: SpatialAsset["kind"];
  mode: "points" | "mesh" | "video" | "pose";
  uri?: string;
  previewUri?: string;
  timeRange?: { startMs: number; endMs: number };
  bounds?: { x: number; y: number; width: number; height: number };
  points: SpatialPreviewPoint[];
  generated: boolean;
}

export function buildSpatialPreview(asset: SpatialAsset, state: MissionState): SpatialPreview {
  const explicit = Array.isArray(asset.metadata.previewPoints)
    ? (asset.metadata.previewPoints as unknown[]).flatMap(parsePreviewPoint).slice(0, 1000)
    : [];
  const mode = asset.kind === "mesh"
    ? "mesh"
    : asset.kind === "spatial-video" || asset.kind === "4d-reconstruction"
      ? "video"
      : asset.kind === "vps-pose"
        ? "pose"
        : "points";

  return {
    assetId: asset.assetId,
    kind: asset.kind,
    mode,
    uri: asset.uri,
    previewUri: asset.previewUri,
    timeRange: asset.timeRange,
    bounds: asset.bounds,
    points: explicit.length ? explicit : generatePreviewPoints(asset, state),
    generated: explicit.length === 0
  };
}

function parsePreviewPoint(value: unknown): SpatialPreviewPoint[] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as Record<string, unknown>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const z = Number(candidate.z ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return [];
  return [{
    x,
    y,
    z,
    intensity: clamp01(Number(candidate.intensity ?? 0.7)),
    color: typeof candidate.color === "string" ? candidate.color : "#50d7b8"
  }];
}

function generatePreviewPoints(asset: SpatialAsset, state: MissionState): SpatialPreviewPoint[] {
  if (asset.kind === "vps-pose") {
    return [{ ...asset.position, intensity: 1, color: "#82cfff" }];
  }

  const count = Math.min(320, Math.max(24, asset.sampleCount ?? Number(asset.metadata.pointCount ?? 96)));
  const rect = asset.bounds ?? {
    x: Math.max(0, asset.position.x - 4),
    y: Math.max(0, asset.position.y - 4),
    width: Math.min(8, state.map.width),
    height: Math.min(8, state.map.height)
  };
  const points: SpatialPreviewPoint[] = [];
  let seed = stringSeed(asset.assetId);
  for (let index = 0; index < count; index += 1) {
    seed = lcg(seed);
    const rx = (seed % 10_000) / 10_000;
    seed = lcg(seed);
    const ry = (seed % 10_000) / 10_000;
    seed = lcg(seed);
    const rz = (seed % 4_000) / 1_000;
    const wave = Math.sin(index * 0.37 + asset.position.x) * 0.6;
    points.push({
      x: clamp(rect.x + rx * rect.width, 0, state.map.width),
      y: clamp(rect.y + ry * rect.height, 0, state.map.height),
      z: Math.max(0, asset.position.z + rz * 0.35 + wave),
      intensity: clamp01(asset.confidence * (0.72 + rx * 0.28)),
      color: colorForKind(asset.kind)
    });
  }
  return points;
}

function colorForKind(kind: SpatialAsset["kind"]) {
  if (kind === "point-cloud") return "#82cfff";
  if (kind === "mesh") return "#b6c2cf";
  if (kind === "4d-reconstruction") return "#50d7b8";
  if (kind === "spatial-video") return "#e2ad4d";
  return "#50d7b8";
}

function stringSeed(value: string) {
  return [...value].reduce((seed, char) => (seed * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
}

function lcg(seed: number) {
  return (1664525 * seed + 1013904223) >>> 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number) {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}
