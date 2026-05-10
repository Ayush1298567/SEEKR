import type { FlightRect, FlightVec3 } from "./types";

export function distance2d(a: FlightVec3, b: FlightVec3) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInRect(point: FlightVec3, rect: FlightRect) {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function moveToward(current: FlightVec3, target: FlightVec3, maxDistance: number): FlightVec3 {
  const distance = Math.hypot(target.x - current.x, target.y - current.y, target.z - current.z);
  if (distance <= maxDistance || distance === 0) return { ...target };
  const ratio = maxDistance / distance;
  return {
    x: current.x + (target.x - current.x) * ratio,
    y: current.y + (target.y - current.y) * ratio,
    z: current.z + (target.z - current.z) * ratio
  };
}
