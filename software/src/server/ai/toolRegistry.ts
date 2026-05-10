import type { MissionEvent, MissionPlan, MissionState, ToolDefinition, Vec3 } from "../../shared/types";
import { validateMissionPlan } from "../domain/validators";
import { buildIncidentLog } from "../domain/incidentLog";
import { buildOperatorInputRequest } from "../domain/operatorInput";
import { buildPassivePlan } from "../domain/passivePlan";
import { distance2d } from "../domain/selectors";

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "query_map",
    description: "Read known occupancy, coverage, frontier, conflict, and stale-source information for the current mission.",
    risk: "read",
    requiresApproval: false,
    schema: { region: "optional zone id or bounding box" }
  },
  {
    name: "estimate_coverage",
    description: "Estimate total mission coverage or coverage for one zone.",
    risk: "read",
    requiresApproval: false,
    schema: { zoneId: "optional string" }
  },
  {
    name: "get_drone_status",
    description: "Read one drone's health, task, battery, link, and localization status.",
    risk: "read",
    requiresApproval: false,
    schema: { droneId: "string" }
  },
  {
    name: "explain_alert",
    description: "Explain an alert using current mission state and related detection/drone records.",
    risk: "read",
    requiresApproval: false,
    schema: { alertId: "string" }
  },
  {
    name: "query_spatial_assets",
    description: "Read local Gaussian splat, point cloud, mesh, 4D reconstruction, spatial video, and VPS/VSP pose metadata.",
    risk: "read",
    requiresApproval: false,
    schema: { kind: "optional spatial asset kind", droneId: "optional drone id" }
  },
  {
    name: "explain_spatial_asset",
    description: "Explain one local spatial asset, its transform confidence, linked evidence, and any VPS/VSP localization effect.",
    risk: "read",
    requiresApproval: false,
    schema: { assetId: "string" }
  },
  {
    name: "summarize_spatial_scene",
    description: "Summarize spatial asset readiness, high-confidence scene anchors, and weak transforms.",
    risk: "read",
    requiresApproval: false,
    schema: {}
  },
  {
    name: "find_coverage_gaps_3d",
    description: "Find low-coverage zones and nearby 3D/spatial assets that can guide follow-up search.",
    risk: "read",
    requiresApproval: false,
    schema: {}
  },
  {
    name: "correlate_detection_evidence",
    description: "Correlate detections with nearby or explicitly linked spatial/evidence assets.",
    risk: "read",
    requiresApproval: false,
    schema: { detectionId: "optional string" }
  },
  {
    name: "explain_vps_pose_shift",
    description: "Explain a VPS/VSP pose correction and its local-estimator effect.",
    risk: "read",
    requiresApproval: false,
    schema: { assetId: "string" }
  },
  {
    name: "rank_spatial_assets",
    description: "Rank spatial assets by confidence, transform quality, recency, and mission relevance.",
    risk: "read",
    requiresApproval: false,
    schema: {}
  },
  {
    name: "generate_search_brief",
    description: "Generate a local advisory search brief from map, detection, drone, and spatial context.",
    risk: "read",
    requiresApproval: false,
    schema: {}
  },
  {
    name: "generate_passive_plan",
    description: "Generate a read-only passive operator plan with watch items and non-command next actions.",
    risk: "read",
    requiresApproval: false,
    schema: {}
  },
  {
    name: "request_focused_search",
    description: "Draft a focused-search command for operator review.",
    risk: "propose",
    requiresApproval: true,
    schema: { coords: "Vec3", radiusM: "number" }
  },
  {
    name: "assign_drone_to_zone_draft",
    description: "Draft assigning a drone to a zone for operator review.",
    risk: "propose",
    requiresApproval: true,
    schema: { droneId: "string", zoneId: "string" }
  },
  {
    name: "set_no_fly_zone_draft",
    description: "Draft a local no-fly zone change for operator review.",
    risk: "propose",
    requiresApproval: true,
    schema: { x: "number", y: "number", width: "number", height: "number" }
  },
  {
    name: "export_incident_log",
    description: "Read/export current incident log metadata.",
    risk: "read",
    requiresApproval: false,
    schema: {}
  },
  {
    name: "predict_survivor_location",
    description: "Estimate likely survivor locations from detections and coverage gaps. Advisory only.",
    risk: "read",
    requiresApproval: false,
    schema: {}
  },
  {
    name: "request_operator_input",
    description: "Request human clarification. Does not modify mission state.",
    risk: "read",
    requiresApproval: false,
    schema: { question: "string" }
  }
];

export function invokeTool(state: MissionState, name: string, args: Record<string, unknown>, events: MissionEvent[] = []) {
  if (name === "query_map") {
    return {
      coveragePct: state.metrics.coveragePct,
      frontiers: state.map.cells.filter((cell) => cell.frontier).length,
      knownCells: state.map.cells.filter((cell) => cell.known).length,
      occupiedCells: state.map.cells.filter((cell) => cell.occupied && cell.known).length,
      conflictCells: state.metrics.conflictCells,
      staleSources: state.metrics.staleSources
    };
  }

  if (name === "estimate_coverage") {
    const zoneId = typeof args.zoneId === "string" ? args.zoneId : undefined;
    const zone = zoneId ? state.zones.find((candidate) => candidate.id === zoneId) : undefined;
    return zone
      ? { zoneId, coveragePct: zone.coverage, status: zone.status }
      : { coveragePct: state.metrics.coveragePct, zoneCount: state.zones.length };
  }

  if (name === "get_drone_status") {
    const droneId = typeof args.droneId === "string" ? args.droneId : "";
    const drone = state.drones.find((candidate) => candidate.id === droneId);
    return drone ?? { error: `Unknown drone ${droneId}` };
  }

  if (name === "explain_alert") {
    const alertId = typeof args.alertId === "string" ? args.alertId : "";
    const alert = state.alerts.find((candidate) => candidate.id === alertId);
    if (!alert) return { error: `Unknown alert ${alertId}` };
    return {
      alert,
      drone: alert.droneId ? state.drones.find((candidate) => candidate.id === alert.droneId) : undefined,
      detection: alert.detectionId ? state.detections.find((candidate) => candidate.id === alert.detectionId) : undefined
    };
  }

  if (name === "query_spatial_assets") {
    const kind = typeof args.kind === "string" ? args.kind : undefined;
    const droneId = typeof args.droneId === "string" ? args.droneId : undefined;
    const assets = state.spatialAssets.filter((asset) => (!kind || asset.kind === kind) && (!droneId || asset.droneId === droneId));
    return {
      total: assets.length,
      byKind: assets.reduce<Record<string, number>>((counts, asset) => {
        counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
        return counts;
      }, {}),
      aligned: assets.filter((asset) => asset.status === "aligned").length,
      vpsPoseFixes: assets.filter((asset) => asset.kind === "vps-pose").length,
      highConfidence: assets.filter((asset) => asset.confidence >= 0.8 && asset.transformConfidence >= 0.75).length,
      recent: assets.slice(0, 8).map((asset) => ({
        assetId: asset.assetId,
        kind: asset.kind,
        status: asset.status,
        confidence: asset.confidence,
        transformConfidence: asset.transformConfidence,
        sourceAdapter: asset.sourceAdapter,
        frameId: asset.frameId,
        droneId: asset.droneId,
        linkedDetectionIds: asset.linkedDetectionIds
      }))
    };
  }

  if (name === "explain_spatial_asset") {
    const assetId = typeof args.assetId === "string" ? args.assetId : "";
    const asset = state.spatialAssets.find((candidate) => candidate.assetId === assetId);
    if (!asset) return { error: `Unknown spatial asset ${assetId}` };
    const drone = asset.droneId ? state.drones.find((candidate) => candidate.id === asset.droneId) : undefined;
    const linkedDetections = asset.linkedDetectionIds
      .map((detectionId) => state.detections.find((candidate) => candidate.id === detectionId))
      .filter(Boolean);
    const linkedEvidence = asset.evidenceAssetIds
      .map((evidenceAssetId) => state.evidenceAssets.find((candidate) => candidate.assetId === evidenceAssetId))
      .filter(Boolean);
    return {
      asset,
      drone,
      linkedDetections,
      linkedEvidence,
      advisory: asset.kind === "vps-pose"
        ? "VPS/VSP pose fixes update local estimator state only; they do not command aircraft."
        : "Scene assets are metadata references for operator context and replay, not embedded binaries."
    };
  }

  if (name === "summarize_spatial_scene") {
    const ranked = rankSpatialAssets(state);
    return {
      total: state.spatialAssets.length,
      aligned: state.spatialAssets.filter((asset) => asset.status === "aligned").length,
      byKind: spatialCounts(state),
      highConfidenceAnchors: ranked.filter((asset) => asset.confidence >= 0.8 && asset.transformConfidence >= 0.75).slice(0, 5),
      weakTransforms: state.spatialAssets
        .filter((asset) => asset.transformConfidence < 0.65)
        .map((asset) => ({ assetId: asset.assetId, kind: asset.kind, transformConfidence: asset.transformConfidence })),
      advisoryOnly: true
    };
  }

  if (name === "find_coverage_gaps_3d") {
    return state.zones
      .filter((zone) => zone.status !== "complete")
      .sort((a, b) => a.coverage - b.coverage)
      .slice(0, 5)
      .map((zone) => ({
        zoneId: zone.id,
        name: zone.name,
        coverage: zone.coverage,
        priority: zone.priority,
        nearbyAssets: state.spatialAssets
          .filter((asset) => asset.kind !== "vps-pose" && rectContainsPoint(zone.bounds, asset.position))
          .map((asset) => ({ assetId: asset.assetId, kind: asset.kind, confidence: asset.confidence, transformConfidence: asset.transformConfidence }))
      }));
  }

  if (name === "correlate_detection_evidence") {
    const detectionId = typeof args.detectionId === "string" ? args.detectionId : undefined;
    return state.detections
      .filter((detection) => !detectionId || detection.id === detectionId)
      .slice(0, 8)
      .map((detection) => ({
        detectionId: detection.id,
        kind: detection.kind,
        severity: detection.severity,
        review: detection.review,
        linkedEvidence: detection.evidenceAssetIds,
        spatialAssets: state.spatialAssets
          .filter((asset) => asset.linkedDetectionIds.includes(detection.id) || distance2d(asset.position, detection.position) <= 10)
          .slice(0, 5)
          .map((asset) => ({ assetId: asset.assetId, kind: asset.kind, distanceM: Math.round(distance2d(asset.position, detection.position)), confidence: asset.confidence }))
      }));
  }

  if (name === "explain_vps_pose_shift") {
    const assetId = typeof args.assetId === "string" ? args.assetId : "";
    const asset = state.spatialAssets.find((candidate) => candidate.assetId === assetId);
    if (!asset) return { error: `Unknown spatial asset ${assetId}` };
    if (asset.kind !== "vps-pose") return { error: `${assetId} is ${asset.kind}, not a VPS/VSP pose asset` };
    const drone = asset.droneId ? state.drones.find((candidate) => candidate.id === asset.droneId) : undefined;
    return {
      assetId,
      droneId: asset.droneId,
      droneName: drone?.name,
      position: asset.position,
      estimatorQuality: drone?.estimatorQuality,
      transformConfidence: asset.transformConfidence,
      confidence: asset.confidence,
      advisory: "This is a local read-model correction only; it does not command aircraft or upload navigation."
    };
  }

  if (name === "rank_spatial_assets") {
    return rankSpatialAssets(state);
  }

  if (name === "generate_search_brief") {
    const topGap = [...state.zones].filter((zone) => zone.status !== "complete").sort((a, b) => a.coverage - b.coverage)[0];
    const topAsset = rankSpatialAssets(state)[0];
    const openDetections = state.detections.filter((detection) => detection.review === "new");
    return {
      missionId: state.missionId,
      coveragePct: state.metrics.coveragePct,
      topCoverageGap: topGap ? { zoneId: topGap.id, name: topGap.name, coverage: topGap.coverage } : undefined,
      topSpatialAsset: topAsset,
      openDetectionCount: openDetections.length,
      brief: `Coverage ${state.metrics.coveragePct}%, ${openDetections.length} unreviewed detections, ${state.spatialAssets.length} spatial assets, priority gap ${topGap?.name ?? "none"}.`,
      advisoryOnly: true
    };
  }

  if (name === "generate_passive_plan") {
    return buildPassivePlan(state, [], Date.now());
  }

  if (name === "request_focused_search") {
    const coords = args.coords as Vec3;
    return proposeFocusedSearch(state, coords, Number(args.radiusM ?? 20));
  }

  if (name === "assign_drone_to_zone_draft") {
    const plan: MissionPlan = {
      kind: "assign-zone",
      droneId: String(args.droneId),
      zoneId: String(args.zoneId),
      reason: "Tool-drafted zone assignment"
    };
    return {
      plan,
      validator: validateMissionPlan(state, plan),
      requiresApproval: true
    };
  }

  if (name === "set_no_fly_zone_draft") {
    const bounds = {
      x: Number(args.x),
      y: Number(args.y),
      width: Number(args.width),
      height: Number(args.height)
    };
    const plan: MissionPlan = {
      kind: "set-no-fly-zone",
      bounds,
      coords: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, z: 0 },
      radiusM: Math.max(bounds.width, bounds.height),
      reason: "Tool-drafted no-fly zone"
    };
    return {
      plan,
      validator: validateMissionPlan(state, plan),
      requiresApproval: true
    };
  }

  if (name === "export_incident_log") {
    return buildIncidentLog(state, events, { ok: true, errors: [] }, Date.now());
  }

  if (name === "predict_survivor_location") {
    const openDetection = state.detections.find((detection) => detection.review === "new");
    const lowestCoverage = [...state.zones].sort((a, b) => a.coverage - b.coverage)[0];
    return {
      advisoryOnly: true,
      detectionAnchor: openDetection?.position,
      lowCoverageZone: lowestCoverage?.id,
      confidence: openDetection ? "medium" : "low"
    };
  }

  if (name === "request_operator_input") {
    return buildOperatorInputRequest(state, typeof args.question === "string" ? args.question : undefined, Date.now());
  }

  return { error: `Unknown tool ${name}` };
}

function proposeFocusedSearch(state: MissionState, coords: Vec3, radiusM: number) {
  const drone = [...state.drones]
    .filter((candidate) => candidate.status !== "failed" && candidate.status !== "offline")
    .sort((a, b) => distance2d(a.position, coords) - distance2d(b.position, coords))[0];

  const plan: MissionPlan = {
    kind: "focused-search",
    droneId: drone?.id,
    coords,
    radiusM,
    reason: "Nearest healthy drone to focus point"
  };

  return {
    plan,
    validator: validateMissionPlan(state, plan),
    requiresApproval: true
  };
}

function spatialCounts(state: MissionState) {
  return state.spatialAssets.reduce<Record<string, number>>((counts, asset) => {
    counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function rankSpatialAssets(state: MissionState) {
  return state.spatialAssets
    .map((asset) => {
      const linkedDetections = state.detections.filter((detection) => asset.linkedDetectionIds.includes(detection.id)).length;
      const nearbyDetections = state.detections.filter((detection) => distance2d(detection.position, asset.position) <= 10).length;
      const score = asset.confidence * 0.4 + asset.transformConfidence * 0.4 + Math.min(0.2, (linkedDetections + nearbyDetections) * 0.05);
      return {
        assetId: asset.assetId,
        kind: asset.kind,
        status: asset.status,
        score: Number(score.toFixed(3)),
        confidence: asset.confidence,
        transformConfidence: asset.transformConfidence,
        linkedDetections,
        nearbyDetections,
        droneId: asset.droneId
      };
    })
    .sort((a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId));
}

function rectContainsPoint(rect: { x: number; y: number; width: number; height: number }, point: Vec3) {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}
