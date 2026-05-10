import type { Drone, MissionState, SearchZone, Vec3 } from "../../shared/types";
import { distance2d, inZone } from "./selectors";

export interface ReassignmentCandidate {
  zone: SearchZone;
  drone: Drone;
  incompleteTaskId: string;
  score: number;
}

export function chooseNearestFrontierInZone(state: MissionState, drone: Drone, zone: SearchZone): Vec3 | undefined {
  const frontier = state.map.cells
    .filter((cell) => inZone(cell, zone) && cell.frontier && !cell.occupied && !cell.conflict)
    .sort((a, b) => distance2d(drone.position, a) - distance2d(drone.position, b))[0];
  if (frontier) return { x: frontier.x, y: frontier.y, z: 2 };

  const unknown = state.map.cells
    .filter((cell) => inZone(cell, zone) && !cell.known && !cell.occupied && !cell.conflict)
    .sort((a, b) => distance2d(drone.position, a) - distance2d(drone.position, b))[0];
  return unknown ? { x: unknown.x, y: unknown.y, z: 2 } : undefined;
}

export function chooseReassignmentCandidate(state: MissionState): ReassignmentCandidate | undefined {
  const incomplete = state.taskLedger.find((task) => task.status === "incomplete");
  if (!incomplete) return undefined;

  const zone = state.zones.find((candidate) => candidate.id === incomplete.zoneId && candidate.status !== "complete");
  if (!zone) return undefined;

  return [...state.drones]
    .filter((drone) => drone.id !== incomplete.droneId && isAssignableDrone(drone))
    .map((drone) => ({
      zone,
      drone,
      incompleteTaskId: incomplete.taskId,
      score: scoreDroneForZone(drone, zone)
    }))
    .sort((a, b) => b.score - a.score || a.drone.id.localeCompare(b.drone.id))[0];
}

export function isAssignableDrone(drone: Drone) {
  return (
    drone.status !== "failed" &&
    drone.status !== "offline" &&
    drone.batteryPct > drone.dynamicReservePct + 12 &&
    drone.linkQuality >= 25 &&
    drone.estimatorQuality >= 62
  );
}

export function scoreDroneForZone(drone: Drone, zone: SearchZone) {
  const center = {
    x: zone.bounds.x + zone.bounds.width / 2,
    y: zone.bounds.y + zone.bounds.height / 2
  };
  const distancePenalty = Math.min(35, distance2d(drone.position, center));
  const taskPenalty = drone.assignedZoneId && drone.assignedZoneId !== zone.id ? 8 : 0;
  return drone.batteryPct * 0.38 + drone.linkQuality * 0.28 + drone.estimatorQuality * 0.28 - distancePenalty - taskPenalty;
}
