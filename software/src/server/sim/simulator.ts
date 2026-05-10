import { SIM_EPOCH_MS } from "../../shared/constants";
import type { Alert, Detection, Drone, EvidenceAsset, MapDelta, MissionState, ScenarioDefinition, Vec3 } from "../../shared/types";
import { deterministicId, hashValue } from "../domain/ids";
import { cloneState, distance2d } from "../domain/selectors";
import { alertForFault, faultApplies, faultPoint } from "./faults";
import { chooseExplorationTarget, moveToward, reached } from "./planners";

export interface SimulatorTickPayload {
  elapsedSec: number;
  tick: number;
  droneUpdates: Array<Partial<Drone> & { id: string }>;
  revealedCells: Array<{ x: number; y: number; droneId: string; confidence: number; stale?: boolean }>;
  mapDeltas: MapDelta[];
  detections: Detection[];
  alerts: Alert[];
  evidenceAssets: EvidenceAsset[];
  appliedFaultIds: string[];
}

export class DeterministicSimulator {
  buildTick(state: MissionState, scenario: ScenarioDefinition, deltaSec: number): SimulatorTickPayload {
    const working = cloneState(state);
    const nextElapsedSec = Math.round((working.elapsedSec + deltaSec) * 1000) / 1000;
    const tick = working.simulator.tick + 1;
    const createdAt = SIM_EPOCH_MS + Math.round(nextElapsedSec * 1000);
    const rng = mulberry32(working.simulator.seed + tick * 1009);
    const droneUpdates: SimulatorTickPayload["droneUpdates"] = [];
    const revealedCells: SimulatorTickPayload["revealedCells"] = [];
    const mapDeltas: MapDelta[] = [];
    const detections: Detection[] = [];
    const alerts: Alert[] = [];
    const evidenceAssets: EvidenceAsset[] = [];
    const appliedFaultIds: string[] = [];

    working.drones.forEach((drone) => {
      const update = this.tickDrone(working, scenario, drone, deltaSec, rng, createdAt, revealedCells, detections, alerts, evidenceAssets);
      if (update) droneUpdates.push(update);
    });

    scenario.scriptedFaults
      .filter((fault) => faultApplies(fault, working.elapsedSec, nextElapsedSec, working.simulator.appliedFaultIds))
      .forEach((fault) => {
        appliedFaultIds.push(fault.id);
        const drone = working.drones.find((candidate) => candidate.id === fault.droneId);
        if (fault.kind === "link-loss" && drone) {
          droneUpdates.push({ id: drone.id, status: "offline", linkQuality: 0, offlineSince: createdAt, currentTask: "Offline failsafe timer" });
          alerts.push(alertForFault(fault, drone, createdAt));
        } else if (fault.kind === "drone-dropout" && drone) {
          droneUpdates.push({ id: drone.id, status: "failed", linkQuality: 0, offlineSince: createdAt, currentTask: "Failed / no telemetry" });
          alerts.push(alertForFault(fault, drone, createdAt));
        } else if (fault.kind === "estimator-degradation" && drone) {
          droneUpdates.push({
            id: drone.id,
            estimatorQuality: Number(fault.params.quality ?? 45),
            currentTask: "Estimator degraded"
          });
          alerts.push(alertForFault(fault, drone, createdAt));
        } else if (fault.kind === "low-battery" && drone) {
          droneUpdates.push({
            id: drone.id,
            batteryPct: Number(fault.params.batteryPct ?? drone.dynamicReservePct - 1),
            status: "returning",
            target: { ...drone.home },
            currentTask: "Dynamic reserve reached"
          });
          alerts.push(alertForFault(fault, drone, createdAt));
        } else if ((fault.kind === "false-positive-detection" || fault.kind === "duplicate-detection") && drone) {
          const detection = makeDetection(
            state.missionId,
            drone,
            faultPoint(fault, drone.position),
            fault.kind === "duplicate-detection" ? 79 : 63,
            fault.kind === "duplicate-detection" ? "motion-anomaly" : "thermal-hotspot",
            createdAt,
            fault.id
          );
          detections.push(detection.detection);
          evidenceAssets.push(detection.evidenceAsset);
          alerts.push({ ...alertForFault(fault, drone, createdAt), detectionId: detection.detection.id });
        } else if (fault.kind === "stale-map-source" && drone) {
          revealedCells.push({
            x: Math.round(drone.position.x),
            y: Math.round(drone.position.y),
            droneId: drone.id,
            confidence: 0.52,
            stale: true
          });
          alerts.push(alertForFault(fault, drone, createdAt));
        }
      });

    return {
      elapsedSec: nextElapsedSec,
      tick,
      droneUpdates,
      revealedCells,
      mapDeltas,
      detections,
      alerts,
      evidenceAssets,
      appliedFaultIds
    };
  }

  private tickDrone(
    state: MissionState,
    scenario: ScenarioDefinition,
    drone: Drone,
    deltaSec: number,
    rng: () => number,
    createdAt: number,
    revealedCells: SimulatorTickPayload["revealedCells"],
    detections: Detection[],
    alerts: Alert[],
    evidenceAssets: EvidenceAsset[]
  ): (Partial<Drone> & { id: string }) | undefined {
    if (drone.status === "failed") return undefined;

    const update: Partial<Drone> & { id: string } = { id: drone.id };
    const nextBattery = Math.max(0, drone.batteryPct - 0.035 * deltaSec - (drone.status === "returning" ? 0.01 : 0));
    update.batteryPct = round(nextBattery, 2);

    if (drone.status === "offline") {
      return update;
    }

    update.linkQuality = clamp(round(drone.linkQuality + (rng() * 3 - 1.8), 2), 30, 100);
    update.estimatorQuality = clamp(round(drone.estimatorQuality + (rng() * 2.3 - 1.2), 2), 45, 100);

    if (nextBattery <= drone.dynamicReservePct && drone.status !== "returning") {
      update.status = "returning";
      update.target = { ...drone.home };
      update.currentTask = "Dynamic reserve reached";
      alerts.push({
        id: `alert-battery-${drone.id}-${state.simulator.tick + 1}`,
        severity: "P2",
        title: "Battery reserve",
        message: `${drone.name} returning on reserve`,
        droneId: drone.id,
        acknowledged: false,
        createdAt
      });
      return update;
    }

    if (drone.status === "exploring") {
      const target = drone.target ?? chooseExplorationTarget(state, drone);
      if (!target) {
        update.status = "holding";
        update.currentTask = "Zone coverage complete";
        update.target = undefined;
        return update;
      }

      const position = moveToward(drone.position, target, drone.speedMps, deltaSec);
      update.position = position;
      update.target = reached(position, target) ? undefined : target;
      revealAround(position, drone.id, revealedCells, 1);

      if (reached(position, target)) {
        const seeded = scenario.detectionSeeds.find(
          (seed) =>
            distance2d(position, seed) < 1.4 &&
            !state.detections.some((detection) => distance2d(detection.position, seed) < 1.4) &&
            !detections.some((detection) => distance2d(detection.position, seed) < 1.4)
        );
        if (seeded) {
          const detection = makeDetection(state.missionId, drone, position, seeded.confidence, seeded.kind, createdAt, `${seeded.x}-${seeded.y}`);
          detections.push(detection.detection);
          evidenceAssets.push(detection.evidenceAsset);
          alerts.push({
            id: `alert-${detection.detection.id}`,
            severity: detection.detection.severity,
            title: "Possible survivor",
            message: `${drone.name} reported ${seeded.confidence}% confidence`,
            droneId: drone.id,
            detectionId: detection.detection.id,
            acknowledged: false,
            createdAt
          });
          update.status = "investigating";
          update.target = detection.detection.position;
          update.currentTask = "Investigating detection";
        }
      }
    } else if (drone.status === "investigating" && drone.target) {
      const position = moveToward(drone.position, drone.target, drone.speedMps, deltaSec);
      update.position = position;
      revealAround(position, drone.id, revealedCells, 2);
      if (reached(position, drone.target)) {
        update.status = "holding";
        update.currentTask = "Investigation hold";
        update.target = undefined;
      }
    } else if (drone.status === "returning" && drone.target) {
      const position = moveToward(drone.position, drone.target, drone.speedMps, deltaSec);
      update.position = position;
      if (reached(position, drone.home)) {
        update.status = "holding";
        update.currentTask = "At home / recovery";
        update.target = undefined;
      }
    }

    return update;
  }
}

function revealAround(position: { x: number; y: number }, droneId: string, cells: SimulatorTickPayload["revealedCells"], radius = 1) {
  const minX = Math.floor(position.x - radius - 1);
  const maxX = Math.ceil(position.x + radius + 1);
  const minY = Math.floor(position.y - radius - 1);
  const maxY = Math.ceil(position.y + radius + 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (x >= 0 && y >= 0 && distance2d(position, { x, y }) <= radius + 0.65) {
        cells.push({ x, y, droneId, confidence: 0.82 });
      }
    }
  }
}

function makeDetection(
  missionId: string,
  drone: Drone,
  position: Vec3,
  confidence: number,
  kind: Detection["kind"],
  createdAt: number,
  salt: string
) {
  const severity: Detection["severity"] = confidence >= 85 ? "P1" : "P2";
  const id = deterministicId("det", missionId, drone.id, Math.round(position.x), Math.round(position.y), confidence, salt);
  const assetId = deterministicId("asset", id, "thumbnail");
  const detection: Detection = {
    id,
    droneId: drone.id,
    kind,
    position: { x: round(position.x, 2), y: round(position.y, 2), z: round(position.z, 2) },
    confidence,
    severity,
    review: "new",
    createdAt,
    updatedAt: createdAt,
    sourceAdapter: "simulator",
    immutable: true,
    evidenceAssetIds: [assetId],
    evidence: {
      frameId: `frame-${createdAt}-${drone.id}`,
      thumbnailTone: severity === "P1" ? "red" : "amber",
      notes: "Simulated onboard detector event"
    }
  };
  const evidenceAsset: EvidenceAsset = {
    assetId,
    missionId,
    detectionId: id,
    kind: "thumbnail",
    uri: `sim://evidence/${assetId}`,
    mimeType: "image/png",
    hash: hashValue(detection),
    createdAt,
    retentionPolicy: "evidence",
    redactionState: "none",
    metadata: {
      frameId: detection.evidence.frameId,
      tone: detection.evidence.thumbnailTone
    }
  };
  return { detection, evidenceAsset };
}

function mulberry32(seed: number) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
