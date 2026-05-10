import type {
  Alert,
  AiProposal,
  CommandLifecycle,
  Detection,
  Drone,
  DroneAction,
  EvidenceAsset,
  MapDelta,
  MissionEvent,
  MissionState,
  ScenarioDefinition,
  SearchZone,
  SpatialAsset,
  TelemetrySample,
  Vec3
} from "../../shared/types";
import { buildAiProposal } from "../ai/proposalEngine";
import { applyMapDeltaToCells } from "./mapFusion";
import { makeInitialMissionState, auditFromEvent, cloneState, deriveMissionState, distance2d, getCell, inZone } from "./selectors";
import { chooseNearestFrontierInZone } from "./taskAllocator";

export function reduceMissionEvent(state: MissionState, event: MissionEvent): MissionState {
  let next = cloneState(state);
  const payload = event.payload as Record<string, unknown>;

  if (event.type === "scenario.loaded" || event.type === "mission.reset") {
    const scenario = payload.scenario as ScenarioDefinition;
    next = makeInitialMissionState(scenario, String(payload.missionId ?? state.missionId), event.createdAt);
  } else if (event.type === "mission.started") {
    next.phase = "running";
    next.startedAt ??= event.createdAt;
  } else if (event.type === "mission.paused") {
    next.phase = "paused";
    next.drones.forEach((drone) => {
      if (drone.status !== "failed" && drone.status !== "offline") {
        drone.status = "holding";
        drone.currentTask = "Mission paused";
        drone.target = undefined;
      }
    });
  } else if (event.type === "trust.set") {
    next.trustMode = String(payload.mode) as MissionState["trustMode"];
  } else if (event.type === "zone.assigned") {
    assignDroneToZone(next, String(payload.droneId), String(payload.zoneId), event.createdAt, String(payload.reason ?? "Zone assignment"));
  } else if (event.type === "drone.action.applied") {
    applyDroneAction(next, String(payload.droneId), payload.action as DroneAction, event.createdAt);
    if (payload.alert) next.alerts.unshift(payload.alert as Alert);
  } else if (event.type === "drone.focused_search.applied") {
    const drone = next.drones.find((candidate) => candidate.id === payload.droneId);
    if (drone && payload.coords) {
      drone.status = "investigating";
      drone.target = payload.coords as Vec3;
      drone.currentTask = "Focused search";
    }
  } else if (event.type === "detection.created") {
    addDetection(next, payload.detection as Detection, payload.alert as Alert | undefined, payload.evidenceAsset as EvidenceAsset | undefined);
  } else if (event.type === "detection.reviewed") {
    reviewDetection(next, String(payload.detectionId), String(payload.review) as Detection["review"], event.createdAt);
  } else if (event.type === "alert.created") {
    next.alerts.unshift(payload.alert as Alert);
    next.alerts = next.alerts.slice(0, 50);
  } else if (event.type === "alert.acknowledged") {
    const alert = next.alerts.find((candidate) => candidate.id === payload.alertId);
    if (alert) alert.acknowledged = true;
  } else if (event.type === "no_fly_zone.added") {
    const zone = payload.bounds as MissionState["noFlyZones"][number] | undefined;
    if (zone && !next.noFlyZones.some((candidate) => JSON.stringify(candidate) === JSON.stringify(zone))) {
      next.noFlyZones.push(zone);
    }
  } else if (event.type === "ai.proposal.created") {
    next.proposals.unshift(payload.proposal as AiProposal);
    next.proposals = next.proposals.slice(0, 12);
  } else if (event.type === "ai.proposal.approved") {
    const proposal = next.proposals.find((candidate) => candidate.id === payload.proposalId);
    if (proposal) {
      proposal.status = "approved";
      proposal.commandIds = [...new Set([...proposal.commandIds, String(payload.commandId)])];
    }
  } else if (event.type === "ai.proposal.executed") {
    const proposal = next.proposals.find((candidate) => candidate.id === payload.proposalId);
    if (proposal) proposal.status = "executed";
  } else if (event.type === "command.lifecycle.updated") {
    upsertLifecycle(next, payload.lifecycle as CommandLifecycle);
  } else if (event.type === "telemetry.ingested") {
    applyTelemetry(next, payload.sample as TelemetrySample);
  } else if (event.type === "map.delta.ingested") {
    applyMapDelta(next, payload.mapDelta as MapDelta);
  } else if (event.type === "spatial.asset.ingested") {
    applySpatialAsset(next, payload.asset as SpatialAsset);
  } else if (event.type === "simulator.tick") {
    applySimulatorTick(next, payload, event.createdAt);
  }

  next.stateSeq = event.seq;
  next.updatedAt = event.createdAt;
  next.source = event.actor === "adapter" ? "adapter" : event.actor === "replay" ? "replay" : event.actor === "operator" ? "operator" : "simulator";
  next.auditTail.unshift(auditFromEvent(event));
  next.auditTail = next.auditTail.slice(0, 25);
  return deriveMissionState(next, event.createdAt);
}

export function reduceMissionEvents(initialState: MissionState, events: MissionEvent[]) {
  return events.reduce((state, event) => reduceMissionEvent(state, event), initialState);
}

function assignDroneToZone(state: MissionState, droneId: string, zoneId: string, createdAt: number, reason: string) {
  const drone = state.drones.find((candidate) => candidate.id === droneId);
  const zone = state.zones.find((candidate) => candidate.id === zoneId);
  if (!drone || !zone) return;
  const incompleteTask = state.taskLedger.find((task) => task.zoneId === zoneId && task.status === "incomplete");

  state.zones.forEach((candidate) => {
    candidate.assignedDroneIds = candidate.assignedDroneIds.filter((id) => id !== droneId);
  });
  zone.assignedDroneIds = [...new Set([...zone.assignedDroneIds, droneId])];
  zone.status = "active";
  drone.assignedZoneId = zone.id;
  drone.status = state.phase === "running" ? "exploring" : "idle";
  drone.currentTask = `Search ${zone.name}`;
  drone.target = undefined;

  state.taskLedger.unshift({
    taskId: `task-${zoneId}-${droneId}-${createdAt}`,
    zoneId,
    droneId,
    status: incompleteTask ? "reassigned" : state.phase === "running" ? "in_progress" : "assigned",
    reason,
    reassignedFromTaskId: incompleteTask?.taskId,
    createdAt,
    updatedAt: createdAt
  });
  state.taskLedger = state.taskLedger.slice(0, 100);
}

function applyDroneAction(state: MissionState, droneId: string, action: DroneAction, createdAt: number) {
  const drone = state.drones.find((candidate) => candidate.id === droneId);
  if (!drone) return;

  if (action === "hold") {
    drone.status = "holding";
    drone.currentTask = "Hold position";
    drone.target = undefined;
  } else if (action === "return-home") {
    drone.status = "returning";
    drone.currentTask = "Return home";
    drone.target = { ...drone.home };
  } else if (action === "resume") {
    drone.status = drone.assignedZoneId ? "exploring" : "idle";
    drone.currentTask = drone.assignedZoneId ? `Search ${state.zones.find((zone) => zone.id === drone.assignedZoneId)?.name}` : "Standby";
    drone.target = undefined;
  } else if (action === "simulate-link-loss") {
    drone.status = "offline";
    drone.linkQuality = 0;
    drone.offlineSince = createdAt;
    drone.currentTask = "Offline failsafe timer";
    markDroneAssignmentsIncomplete(state, drone, createdAt, "Link loss");
  } else if (action === "simulate-failure") {
    drone.status = "failed";
    drone.linkQuality = 0;
    drone.offlineSince = createdAt;
    drone.currentTask = "Failed / no telemetry";
    markDroneAssignmentsIncomplete(state, drone, createdAt, "Drone failure");
  }
}

function markDroneAssignmentsIncomplete(state: MissionState, drone: Drone, createdAt: number, reason: string) {
  state.zones.forEach((zone) => {
    if (!zone.assignedDroneIds.includes(drone.id)) return;
    zone.assignedDroneIds = zone.assignedDroneIds.filter((id) => id !== drone.id);
    if (zone.coverage < 95) zone.status = "unassigned";
    state.taskLedger.unshift({
      taskId: `task-${zone.id}-${drone.id}-${createdAt}`,
      zoneId: zone.id,
      droneId: drone.id,
      status: "incomplete",
      reason,
      createdAt,
      updatedAt: createdAt
    });
  });
  drone.assignedZoneId = undefined;
  addReassignmentProposal(state, createdAt);
}

function addDetection(state: MissionState, detection: Detection, alert?: Alert, evidenceAsset?: EvidenceAsset) {
  if (!state.detections.some((candidate) => candidate.id === detection.id)) {
    state.detections.unshift(detection);
    state.detections = state.detections.slice(0, 40);
  }
  if (alert && !state.alerts.some((candidate) => candidate.id === alert.id)) {
    state.alerts.unshift(alert);
    state.alerts = state.alerts.slice(0, 50);
  }
  if (evidenceAsset && !state.evidenceAssets.some((candidate) => candidate.assetId === evidenceAsset.assetId)) {
    state.evidenceAssets.unshift(evidenceAsset);
  }
}

function reviewDetection(state: MissionState, detectionId: string, review: Detection["review"], updatedAt: number) {
  const detection = state.detections.find((candidate) => candidate.id === detectionId);
  if (!detection) return;
  detection.review = review;
  detection.updatedAt = updatedAt;
  state.alerts
    .filter((alert) => alert.detectionId === detectionId)
    .forEach((alert) => {
      alert.acknowledged = review !== "new";
    });
}

function upsertLifecycle(state: MissionState, lifecycle: CommandLifecycle) {
  const index = state.commandLifecycles.findIndex((candidate) => candidate.commandId === lifecycle.commandId);
  if (index >= 0) state.commandLifecycles[index] = lifecycle;
  else state.commandLifecycles.unshift(lifecycle);
  state.commandLifecycles = state.commandLifecycles.slice(0, 100);
}

function applyTelemetry(state: MissionState, sample: TelemetrySample) {
  let drone = state.drones.find((candidate) => candidate.id === sample.droneId);
  if (!drone) {
    drone = {
      id: sample.droneId,
      name: sample.droneId,
      status: sample.status ?? "idle",
      position: sample.position ?? { x: 0, y: 0, z: 0 },
      home: sample.position ?? { x: 0, y: 0, z: 0 },
      batteryPct: sample.batteryPct ?? 100,
      dynamicReservePct: 22,
      linkQuality: sample.linkQuality ?? 100,
      estimatorQuality: sample.estimatorQuality ?? 100,
      currentTask: "Read-only telemetry",
      speedMps: 0,
      lastHeartbeat: sample.receivedAt,
      sourceAdapter: sample.sourceAdapter,
      mode: sample.mode ?? "unknown",
      payloads: { rgb: "offline", thermal: "not-installed", lidar: "not-installed" }
    };
    state.drones.push(drone);
  }

  drone.lastHeartbeat = sample.receivedAt;
  drone.sourceAdapter = sample.sourceAdapter;
  if (sample.position) drone.position = sample.position;
  if (typeof sample.batteryPct === "number") drone.batteryPct = sample.batteryPct;
  if (typeof sample.linkQuality === "number") drone.linkQuality = sample.linkQuality;
  if (typeof sample.estimatorQuality === "number") drone.estimatorQuality = sample.estimatorQuality;
  if (sample.status) drone.status = sample.status;
  if (sample.mode) drone.mode = sample.mode;
}

function applyMapDelta(state: MissionState, mapDelta: MapDelta) {
  const result = applyMapDeltaToCells(state.map.cells, state.map.width, state.map.height, mapDelta);
  if (result.alert && !state.alerts.some((alert) => alert.id === result.alert?.id)) {
    state.alerts.unshift(result.alert);
    state.alerts = state.alerts.slice(0, 50);
  }
}

function applySpatialAsset(state: MissionState, asset: SpatialAsset) {
  const normalized: SpatialAsset = {
    ...asset,
    missionId: asset.missionId ?? state.missionId,
    status: asset.status === "rejected" ? "rejected" : "aligned"
  };
  const existingIndex = state.spatialAssets.findIndex((candidate) => candidate.assetId === normalized.assetId);
  if (existingIndex >= 0) state.spatialAssets[existingIndex] = normalized;
  else state.spatialAssets.unshift(normalized);
  state.spatialAssets = state.spatialAssets.slice(0, 60);

  if (normalized.kind === "vps-pose" && normalized.droneId) {
    const drone = state.drones.find((candidate) => candidate.id === normalized.droneId);
    if (drone) {
      drone.position = normalized.position;
      drone.estimatorQuality = Math.max(drone.estimatorQuality, Math.round(normalized.confidence * 100));
      drone.sourceAdapter = normalized.sourceAdapter;
      drone.mode = "vps-localized";
      drone.currentTask = drone.currentTask === "Standby" ? "VPS localized" : drone.currentTask;
    }
  }
}

function applySimulatorTick(state: MissionState, payload: Record<string, unknown>, createdAt: number) {
  state.elapsedSec = Number(payload.elapsedSec ?? state.elapsedSec);
  state.simulator.tick = Number(payload.tick ?? state.simulator.tick + 1);

  const droneUpdates = (payload.droneUpdates ?? []) as Array<Partial<Drone> & { id: string }>;
  droneUpdates.forEach((update) => {
    const drone = state.drones.find((candidate) => candidate.id === update.id);
    if (!drone) return;
    const previousStatus = drone.status;
    Object.assign(drone, update);
    drone.lastHeartbeat = drone.status === "offline" || drone.status === "failed" ? drone.lastHeartbeat : createdAt;
    if (previousStatus !== drone.status && (drone.status === "offline" || drone.status === "failed")) {
      markDroneAssignmentsIncomplete(state, drone, createdAt, drone.status === "offline" ? "Simulator link loss" : "Simulator dropout");
    }
  });

  const revealedCells = (payload.revealedCells ?? []) as Array<{
    x: number;
    y: number;
    droneId: string;
    confidence: number;
    stale?: boolean;
  }>;
  revealedCells.forEach((revealed) => {
    const cell = getCell(state, revealed.x, revealed.y);
    if (!cell || cell.occupied) return;
    cell.known = true;
    cell.occupancy = "free";
    cell.confidence = Math.min(0.99, Math.max(cell.confidence, revealed.confidence));
    cell.lastSeenBy = revealed.droneId;
    cell.sourceDroneId = revealed.droneId;
    cell.sourceAdapter = "simulator";
    cell.frameId = "sim-local";
    cell.transformConfidence = 0.95;
    cell.lastSeenAt = revealed.stale ? createdAt - 60_000 : createdAt;
    cell.stale = Boolean(revealed.stale);
  });

  ((payload.mapDeltas ?? []) as MapDelta[]).forEach((mapDelta) => applyMapDelta(state, mapDelta));
  ((payload.detections ?? []) as Detection[]).forEach((detection) => addDetection(state, detection));
  ((payload.alerts ?? []) as Alert[]).forEach((alert) => {
    if (!state.alerts.some((candidate) => candidate.id === alert.id)) state.alerts.unshift(alert);
  });
  ((payload.evidenceAssets ?? []) as EvidenceAsset[]).forEach((asset) => {
    if (!state.evidenceAssets.some((candidate) => candidate.assetId === asset.assetId)) state.evidenceAssets.unshift(asset);
  });
  ((payload.appliedFaultIds ?? []) as string[]).forEach((faultId) => {
    if (!state.simulator.appliedFaultIds.includes(faultId)) state.simulator.appliedFaultIds.push(faultId);
  });

  state.drones.forEach((drone) => {
    if (drone.batteryPct <= drone.dynamicReservePct && drone.status !== "returning" && drone.status !== "offline" && drone.status !== "failed") {
      drone.status = "returning";
      drone.target = { ...drone.home };
      drone.currentTask = "Dynamic reserve reached";
    }
  });
}

export function zoneForDrone(state: MissionState, drone: Drone): SearchZone | undefined {
  return drone.assignedZoneId ? state.zones.find((zone) => zone.id === drone.assignedZoneId) : undefined;
}

export function chooseNearestUnknownInZone(state: MissionState, drone: Drone) {
  const zone = zoneForDrone(state, drone);
  if (!zone) return undefined;
  const frontier = chooseNearestFrontierInZone(state, drone, zone);
  if (frontier) return frontier;
  const candidates = state.map.cells
    .filter((cell) => inZone(cell, zone) && !cell.known && !cell.occupied)
    .sort((a, b) => distance2d(drone.position, a) - distance2d(drone.position, b));
  const target = candidates[0];
  return target ? { x: target.x, y: target.y, z: 2 } : undefined;
}

function addReassignmentProposal(state: MissionState, createdAt: number) {
  if (!state.taskLedger.some((task) => task.status === "incomplete")) return;
  if (state.proposals.some((proposal) => proposal.status !== "executed" && proposal.plan.kind === "assign-zone")) return;
  const proposal = buildAiProposal(state, createdAt);
  if (proposal.plan.kind !== "assign-zone") return;
  state.proposals.unshift(proposal);
  state.proposals = state.proposals.slice(0, 12);
}
