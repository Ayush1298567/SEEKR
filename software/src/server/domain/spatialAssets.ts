import { SPATIAL_ASSET_STALE_REJECT_MS, SPATIAL_ASSET_TRANSFORM_MIN } from "../../shared/constants";
import type { MissionState, SpatialAsset, ValidationResult } from "../../shared/types";
import { distance2d, isInsideMap } from "./selectors";

export function validateSpatialAssetForState(state: MissionState, asset: SpatialAsset, nowMs: number): ValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (asset.missionId && asset.missionId !== state.missionId) blockers.push(`Spatial asset mission ${asset.missionId} does not match ${state.missionId}`);
  if (!asset.uri && !asset.previewUri && asset.kind !== "vps-pose") blockers.push("Spatial asset URI or preview URI is required for scene assets");
  if (asset.previewUri && !isSafeLocalUri(asset.previewUri)) blockers.push("Spatial preview URI must be local or fixture-safe");
  if (asset.uri && !isSafeLocalUri(asset.uri)) warnings.push("Spatial asset URI is external; V2 viewer will use generated preview metadata only");
  if (!Number.isFinite(asset.createdAt) || nowMs - asset.createdAt > SPATIAL_ASSET_STALE_REJECT_MS) {
    blockers.push("Spatial asset is stale and must be replayed or recaptured");
  }
  if (!isInsideMap(asset.position, state)) blockers.push("Spatial asset anchor is outside mission map bounds");
  if (asset.bounds && !rectIntersectsMap(asset.bounds, state)) blockers.push("Spatial asset bounds do not intersect mission map");
  if ((asset.kind === "4d-reconstruction" || asset.kind === "spatial-video") && !asset.timeRange) {
    blockers.push("Time-ranged spatial asset requires a timeRange");
  }
  if (asset.kind === "point-cloud") {
    if (!asset.bounds) blockers.push("Point-cloud spatial asset requires 2D bounds");
    if (!asset.sampleCount || asset.sampleCount <= 0) blockers.push("Point-cloud spatial asset requires a positive sampleCount");
    if (typeof asset.metadata.densityPointsPerM2 !== "number") warnings.push("Point-cloud densityPointsPerM2 metadata is missing");
  }
  if (asset.timeRange && asset.timeRange.endMs <= asset.timeRange.startMs) blockers.push("Spatial asset timeRange end must be after start");
  if (asset.transformConfidence < SPATIAL_ASSET_TRANSFORM_MIN) {
    blockers.push(`Spatial transform confidence ${asset.transformConfidence} is below ${SPATIAL_ASSET_TRANSFORM_MIN}`);
  } else if (asset.transformConfidence < 0.55) {
    warnings.push("Spatial transform confidence is degraded");
  }
  if (asset.confidence < 0.45) blockers.push("Spatial asset confidence is below ingest threshold");
  else if (asset.confidence < 0.65) warnings.push("Spatial asset confidence is low");

  if (asset.kind === "vps-pose") {
    if (!asset.droneId) blockers.push("VPS/VSP pose asset requires a drone id");
    const drone = asset.droneId ? state.drones.find((candidate) => candidate.id === asset.droneId) : undefined;
    if (!drone) blockers.push(`Unknown drone ${asset.droneId ?? ""}`);
    if (drone && distance2d(drone.position, asset.position) > 18) {
      warnings.push(`${drone.name} VPS/VSP correction is a large jump from current telemetry`);
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

function isSafeLocalUri(uri: string) {
  return uri.startsWith("local://") || uri.startsWith("fixture://") || uri.startsWith("/fixtures/") || uri.startsWith("/api/spatial-assets/");
}

function rectIntersectsMap(rect: { x: number; y: number; width: number; height: number }, state: MissionState) {
  return rect.x < state.map.width && rect.y < state.map.height && rect.x + rect.width >= 0 && rect.y + rect.height >= 0;
}
