import type { FlightFailsafe, FlightSafetyPolicy, FlightVehicleState } from "./types";
import { pointInRect } from "./geometry";

export function evaluateFailsafe(
  state: FlightVehicleState,
  policy: FlightSafetyPolicy,
  nowMs = state.updatedAtMs
): FlightFailsafe | undefined {
  if (state.mode === "terminated") return undefined;

  if (state.batteryPct <= Math.max(8, policy.reserveBatteryPct - 8)) {
    return failsafe("critical-battery", "land", `Battery ${state.batteryPct}% is critical`, nowMs, "land");
  }

  if (state.batteryPct <= policy.reserveBatteryPct) {
    return failsafe("low-battery", "return-home", `Battery ${state.batteryPct}% reached reserve ${policy.reserveBatteryPct}%`, nowMs, "return-home");
  }

  if (nowMs - state.lastHeartbeatMs > policy.heartbeatTimeoutMs) {
    return failsafe("heartbeat-timeout", "return-home", `Heartbeat stale for ${nowMs - state.lastHeartbeatMs}ms`, nowMs, "return-home");
  }

  if (state.linkQuality < Math.max(10, policy.minLinkQuality - 18)) {
    return failsafe("link-loss", "return-home", `Link quality ${state.linkQuality}% is below failsafe threshold`, nowMs, "return-home");
  }

  if (state.estimatorQuality < Math.max(25, policy.minEstimatorQuality - 25)) {
    return failsafe("estimator-degraded", "land", `Estimator quality ${state.estimatorQuality}% is unsafe`, nowMs, "land");
  }

  if (!pointInRect(state.position, policy.geofence)) {
    return failsafe("geofence-breach", "return-home", "Vehicle position is outside geofence", nowMs, "return-home");
  }

  return undefined;
}

function failsafe(
  kind: FlightFailsafe["kind"],
  severity: FlightFailsafe["severity"],
  reason: string,
  triggeredAtMs: number,
  recommendedCommand: FlightFailsafe["recommendedCommand"]
): FlightFailsafe {
  return { kind, severity, reason, triggeredAtMs, recommendedCommand };
}
