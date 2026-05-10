import {
  MAP_CONFLICT_ALERT_THRESHOLD,
  MAP_DELTA_STALE_REJECT_MS,
  MAP_TRANSFORM_HARD_MIN,
  MAX_MAP_DELTA_CELLS
} from "../../shared/constants";
import type { Alert, MapCell, MapDelta, MissionState, ValidationResult } from "../../shared/types";

export interface MapFusionResult {
  updatedCells: number;
  conflictCells: number;
  alert?: Alert;
}

export function validateMapDeltaForState(state: MissionState, mapDelta: MapDelta, nowMs: number): ValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (mapDelta.cells.length > MAX_MAP_DELTA_CELLS) {
    blockers.push(`Map delta has ${mapDelta.cells.length} cells; max is ${MAX_MAP_DELTA_CELLS}`);
  }

  if (mapDelta.transformConfidence < MAP_TRANSFORM_HARD_MIN) {
    blockers.push(`Transform confidence ${mapDelta.transformConfidence} is below ${MAP_TRANSFORM_HARD_MIN}`);
  } else if (mapDelta.transformConfidence < 0.55) {
    warnings.push("Transform confidence is degraded");
  }

  if (!Number.isFinite(mapDelta.createdAt) || nowMs - mapDelta.createdAt > MAP_DELTA_STALE_REJECT_MS) {
    blockers.push("Map delta is stale and must not enter mission state");
  }

  const outOfBounds = mapDelta.cells.find(
    (cell) => cell.x < 0 || cell.y < 0 || cell.x >= state.map.width || cell.y >= state.map.height
  );
  if (outOfBounds) {
    blockers.push(`Cell ${outOfBounds.x},${outOfBounds.y} is outside map bounds ${state.map.width}x${state.map.height}`);
  }

  const malformed = mapDelta.cells.find(
    (cell) =>
      !Number.isFinite(cell.probability) ||
      !Number.isFinite(cell.confidence) ||
      cell.probability < 0 ||
      cell.probability > 1 ||
      cell.confidence < 0 ||
      cell.confidence > 1
  );
  if (malformed) blockers.push("Map delta has malformed probability or confidence values");

  return { ok: blockers.length === 0, blockers, warnings };
}

export function applyMapDeltaToCells(
  cells: MapCell[],
  width: number,
  height: number,
  mapDelta: MapDelta
): MapFusionResult {
  let updatedCells = 0;
  let conflictCells = 0;

  mapDelta.cells.forEach((deltaCell) => {
    if (deltaCell.x < 0 || deltaCell.y < 0 || deltaCell.x >= width || deltaCell.y >= height) return;
    const index = deltaCell.y * width + deltaCell.x;
    const cell = cells[index] ?? cells.find((candidate) => candidate.x === deltaCell.x && candidate.y === deltaCell.y);
    if (!cell) return;

    const priorSource = sourceKey(cell);
    const nextSource = sourceKey({
      sourceDroneId: mapDelta.sourceDroneId,
      sourceAdapter: mapDelta.sourceAdapter,
      frameId: mapDelta.frameId
    });
    const nextKnown = deltaCell.occupancy !== "unknown";
    const nextOccupied = deltaCell.occupancy === "occupied";
    const priorOccupancy = cell.known ? (cell.occupied ? "occupied" : "free") : "unknown";
    const incomingConfidence = fusedConfidence(deltaCell.probability, deltaCell.confidence, mapDelta.transformConfidence);
    const contradicts =
      priorOccupancy !== "unknown" &&
      deltaCell.occupancy !== "unknown" &&
      priorOccupancy !== deltaCell.occupancy &&
      incomingConfidence >= 0.62 &&
      cell.confidence >= 0.55;

    if (contradicts) {
      cell.conflict = true;
      cell.occupancy = "conflict";
      cell.confidence = Math.max(cell.confidence, incomingConfidence);
      cell.conflictWith = [...new Set([...cell.conflictWith, priorSource, nextSource].filter(Boolean))];
      conflictCells += 1;
    } else if (nextKnown) {
      cell.known = true;
      cell.occupied = nextOccupied;
      cell.occupancy = nextOccupied ? "occupied" : "free";
      cell.confidence = mergeConfidence(cell.confidence, incomingConfidence);
    } else if (!cell.known) {
      cell.occupancy = "unknown";
      cell.confidence = mergeConfidence(cell.confidence, incomingConfidence * 0.5);
    }

    cell.sourceDroneId = mapDelta.sourceDroneId;
    cell.sourceAdapter = mapDelta.sourceAdapter;
    cell.frameId = mapDelta.frameId;
    cell.transformConfidence = mapDelta.transformConfidence;
    cell.lastSeenBy = mapDelta.sourceDroneId;
    cell.lastSeenAt = mapDelta.createdAt;
    cell.stale = false;
    updatedCells += 1;
  });

  return {
    updatedCells,
    conflictCells,
    alert: conflictCells >= MAP_CONFLICT_ALERT_THRESHOLD ? conflictAlert(mapDelta, conflictCells) : undefined
  };
}

function fusedConfidence(probability: number, confidence: number, transformConfidence: number) {
  const logOddsStrength = Math.min(1, Math.abs(logit(clamp(probability, 0.01, 0.99))) / 4);
  return round(clamp(confidence * 0.72 + logOddsStrength * 0.18 + transformConfidence * 0.1, 0, 1), 4);
}

function mergeConfidence(previous: number, incoming: number) {
  return round(clamp(previous + incoming * (1 - previous), 0, 0.995), 4);
}

function conflictAlert(mapDelta: MapDelta, conflictCells: number): Alert {
  return {
    id: `alert-map-conflict-${mapDelta.deltaId}`,
    severity: "P2",
    title: "Map source conflict",
    message: `${conflictCells} high-confidence cells conflict with existing map state`,
    droneId: mapDelta.sourceDroneId,
    acknowledged: false,
    createdAt: mapDelta.createdAt
  };
}

function sourceKey(value: Pick<MapCell, "sourceDroneId" | "sourceAdapter" | "frameId">) {
  return [value.sourceAdapter, value.sourceDroneId, value.frameId].filter(Boolean).join(":");
}

function logit(value: number) {
  return Math.log(value / (1 - value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
