import { SEEKR_SCHEMA_VERSION, STALE_MAP_SOURCE_MS } from "../../shared/constants";
import type {
  AuditEvent,
  Drone,
  MapCell,
  MissionEvent,
  MissionState,
  ScenarioDefinition,
  SearchZone,
  Vec3
} from "../../shared/types";

export function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function makeInitialMissionState(scenario: ScenarioDefinition, missionId: string, createdAt: number): MissionState {
  const cells = makeCells(scenario);
  const state: MissionState = {
    schemaVersion: SEEKR_SCHEMA_VERSION,
    stateSeq: 0,
    updatedAt: createdAt,
    source: "simulator",
    missionId,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    phase: "idle",
    trustMode: "semi-auto",
    elapsedSec: 0,
    simulator: {
      seed: scenario.seed,
      tick: 0,
      appliedFaultIds: []
    },
    map: {
      width: scenario.width,
      height: scenario.height,
      cells
    },
    drones: scenario.drones.map((definition) => makeDrone(definition, createdAt)),
    zones: scenario.zones.map((definition) => ({
      id: definition.id,
      name: definition.name,
      bounds: { x: definition.x, y: definition.y, width: definition.width, height: definition.height },
      priority: definition.priority,
      assignedDroneIds: [],
      coverage: 0,
      status: "unassigned"
    })),
    noFlyZones: [],
    detections: [],
    evidenceAssets: [],
    spatialAssets: [],
    alerts: [],
    proposals: [],
    commandLifecycles: [],
    taskLedger: [],
    auditTail: [],
    metrics: {
      coveragePct: 0,
      activeDrones: scenario.drones.length,
      p1Open: 0,
      averageBatteryPct: 0,
      mapLatencyMs: 0,
      staleSources: 0,
      conflictCells: 0
    }
  };
  return deriveMissionState(state, createdAt);
}

export function deriveMissionState(state: MissionState, nowMs: number): MissionState {
  const next = cloneState(state);
  next.map.cells.forEach((cell) => {
    if (cell.occupied) {
      cell.frontier = false;
      cell.occupancy = cell.conflict ? "conflict" : "occupied";
      return;
    }
    const neighbors = neighborsOf(next.map.cells, cell.x, cell.y);
    cell.frontier = cell.known && neighbors.some((neighbor) => !neighbor.known && !neighbor.occupied);
    if (cell.conflict) cell.occupancy = "conflict";
    else if (!cell.known) cell.occupancy = "unknown";
    else cell.occupancy = "free";
    cell.stale = typeof cell.lastSeenAt === "number" && nowMs - cell.lastSeenAt > STALE_MAP_SOURCE_MS;
  });

  next.zones.forEach((zone) => {
    const zoneCells = next.map.cells.filter((cell) => inZone(cell, zone) && !cell.occupied);
    const known = zoneCells.filter((cell) => cell.known).length;
    zone.coverage = zoneCells.length ? Math.round((known / zoneCells.length) * 100) : 0;
    const assignedHealthy = zone.assignedDroneIds.some((id) => {
      const drone = next.drones.find((candidate) => candidate.id === id);
      return drone && drone.status !== "failed" && drone.status !== "offline";
    });
    if (zone.coverage >= 95) zone.status = "complete";
    else if (assignedHealthy) zone.status = "active";
    else zone.status = "unassigned";
  });

  const activeDrones = next.drones.filter((drone) => drone.status !== "failed" && drone.status !== "offline").length;
  const known = next.map.cells.filter((cell) => cell.known).length;
  const averageBatteryPct =
    next.drones.reduce((total, drone) => total + drone.batteryPct, 0) / Math.max(next.drones.length, 1);
  const staleSources = next.map.cells.filter((cell) => cell.stale).length;
  const conflictCells = next.map.cells.filter((cell) => cell.conflict).length;

  next.metrics = {
    coveragePct: Math.round((known / next.map.cells.length) * 1000) / 10,
    activeDrones,
    p1Open: next.alerts.filter((alert) => alert.severity === "P1" && !alert.acknowledged).length,
    averageBatteryPct: Math.round(averageBatteryPct),
    mapLatencyMs: 850 + next.detections.length * 35 + staleSources * 2,
    staleSources,
    conflictCells
  };

  next.auditTail = next.auditTail.slice(0, 25);
  return next;
}

export function auditFromEvent(event: MissionEvent): AuditEvent {
  return {
    id: `audit-${event.seq.toString().padStart(8, "0")}`,
    actor: event.actor,
    type: event.type,
    message: summarizeEvent(event),
    createdAt: event.createdAt,
    data: event.payload
  };
}

export function summarizeEvent(event: MissionEvent): string {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === "zone.assigned") return `${payload.droneId} assigned to ${payload.zoneId}`;
  if (event.type === "drone.action.applied") return `${payload.droneId}: ${payload.action}`;
  if (event.type === "mission.started") return "Mission started";
  if (event.type === "mission.paused") return "Mission paused";
  if (event.type === "scenario.loaded") return `Loaded scenario ${payload.scenarioId}`;
  if (event.type === "detection.created") return `Detection ${payload.detectionId ?? ""} created`;
  if (event.type === "command.lifecycle.updated") return `Command ${payload.commandId} ${payload.status}`;
  if (event.type === "ai.proposal.created") return String(payload.title ?? "AI proposal created");
  if (event.type === "no_fly_zone.added") return "No-fly zone added";
  if (event.type === "spatial.asset.ingested") return `Spatial asset ${payload.assetId ?? ""} ingested`;
  if (event.type === "import.completed") return `Import ${payload.importId ?? ""} completed`;
  return event.type;
}

export function distance2d(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function inZone(cell: { x: number; y: number }, zone: SearchZone) {
  return (
    cell.x >= zone.bounds.x &&
    cell.x < zone.bounds.x + zone.bounds.width &&
    cell.y >= zone.bounds.y &&
    cell.y < zone.bounds.y + zone.bounds.height
  );
}

export function inRect(cell: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  return cell.x >= rect.x && cell.x < rect.x + rect.width && cell.y >= rect.y && cell.y < rect.y + rect.height;
}

export function isInsideMap(point: Vec3, state: MissionState) {
  return point.x >= 0 && point.x < state.map.width && point.y >= 0 && point.y < state.map.height;
}

export function getCell(state: MissionState, x: number, y: number) {
  return state.map.cells.find((cell) => cell.x === x && cell.y === y);
}

function makeCells(scenario: ScenarioDefinition): MapCell[] {
  const cells: MapCell[] = [];
  for (let y = 0; y < scenario.height; y += 1) {
    for (let x = 0; x < scenario.width; x += 1) {
      const fixedObstacle = scenario.obstacles.some((rect) => inRect({ x, y }, rect));
      const initiallyKnown = scenario.initialKnown.some((rect) => inRect({ x, y }, rect));
      cells.push({
        x,
        y,
        known: initiallyKnown || fixedObstacle,
        occupied: fixedObstacle,
        frontier: false,
        confidence: fixedObstacle ? 0.78 : initiallyKnown ? 0.72 : 0.3,
        occupancy: fixedObstacle ? "occupied" : initiallyKnown ? "free" : "unknown",
        stale: false,
        conflict: false,
        conflictWith: []
      });
    }
  }
  return cells;
}

function makeDrone(definition: ScenarioDefinition["drones"][number], createdAt: number): Drone {
  return {
    id: definition.id,
    name: definition.name,
    status: "idle",
    position: { x: definition.x, y: definition.y, z: 2 },
    home: { x: definition.x, y: definition.y, z: 2 },
    batteryPct: definition.batteryPct ?? 96,
    dynamicReservePct: 22,
    linkQuality: 94,
    estimatorQuality: 91,
    currentTask: "Standby",
    speedMps: 3.2,
    lastHeartbeat: createdAt,
    sourceAdapter: "simulator",
    mode: "standby",
    payloads: {
      rgb: "online",
      thermal: "not-installed",
      lidar: "not-installed"
    }
  };
}

function neighborsOf(cells: MapCell[], x: number, y: number) {
  return cells.filter((cell) => Math.abs(cell.x - x) + Math.abs(cell.y - y) === 1);
}
