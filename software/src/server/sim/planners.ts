import type { Drone, MissionState, Vec3 } from "../../shared/types";
import { chooseNearestUnknownInZone } from "../domain/missionReducer";
import { distance2d } from "../domain/selectors";

export function chooseExplorationTarget(state: MissionState, drone: Drone) {
  return chooseNearestUnknownInZone(state, drone);
}

export function moveToward(position: Vec3, target: Vec3, speedMps: number, deltaSec: number): Vec3 {
  const maxStep = Math.max(0.3, speedMps * deltaSec * 0.35);
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxStep) return { ...target };
  return {
    x: position.x + (dx / dist) * maxStep,
    y: position.y + (dy / dist) * maxStep,
    z: target.z
  };
}

export function reached(a: Vec3, b: Vec3, threshold = 0.8) {
  return distance2d(a, b) < threshold;
}
