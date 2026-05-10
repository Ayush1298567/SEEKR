import type { FlightCommand, FlightSafetyPolicy, FlightValidation, FlightVehicleState } from "./types";
import { distance2d, pointInRect } from "./geometry";

export function validateFlightCommand(
  state: FlightVehicleState,
  command: FlightCommand,
  policy: FlightSafetyPolicy,
  nowMs = command.requestedAtMs
): FlightValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (command.vehicleId !== state.vehicleId) blockers.push(`Command vehicle ${command.vehicleId} does not match onboard vehicle ${state.vehicleId}`);

  if (command.transport === "hardware" || policy.transport === "hardware") {
    if (!policy.allowHardwareActuation) blockers.push("Hardware actuation is locked by flight safety policy");
  }

  if (state.mode === "terminated") blockers.push("Vehicle flight executive is terminated");
  if (state.activeFailsafe && command.source !== "failsafe" && command.kind !== "land" && command.kind !== "return-home") {
    blockers.push(`Active failsafe ${state.activeFailsafe.kind} blocks non-recovery command`);
  }
  if (nowMs - state.lastHeartbeatMs > policy.heartbeatTimeoutMs) blockers.push("Heartbeat timeout blocks command execution");

  if (command.kind === "arm") validateArm(state, policy, blockers, warnings);
  if (command.kind === "disarm") validateDisarm(state, blockers);
  if (command.kind === "takeoff") validateTakeoff(state, command, policy, blockers);
  if (command.kind === "waypoint") validateWaypoint(state, command, policy, blockers, warnings);
  if (command.kind === "hold") validateRecoveryCapable(state, "hold", blockers);
  if (command.kind === "return-home") validateRecoveryCapable(state, "return-home", blockers);
  if (command.kind === "land") validateRecoveryCapable(state, "land", blockers);
  if (command.kind === "terminate") warnings.push("Terminate is simulation-only and must map to manual bench shutdown, not motor kill, until hardware safety review.");

  return { ok: blockers.length === 0, blockers, warnings };
}

function validateArm(state: FlightVehicleState, policy: FlightSafetyPolicy, blockers: string[], warnings: string[]) {
  if (state.armed) blockers.push("Vehicle is already armed");
  if (!["disarmed", "landed"].includes(state.mode)) blockers.push(`Cannot arm from mode ${state.mode}`);
  const failedPreflight = Object.entries(state.preflight).filter(([, ok]) => !ok).map(([key]) => key);
  if (failedPreflight.length) blockers.push(`Preflight checks failed: ${failedPreflight.join(", ")}`);
  if (state.batteryPct < policy.minArmBatteryPct) blockers.push(`Battery ${state.batteryPct}% is below arm minimum ${policy.minArmBatteryPct}%`);
  if (state.linkQuality < policy.minLinkQuality) blockers.push(`Link quality ${state.linkQuality}% is below command minimum ${policy.minLinkQuality}%`);
  if (state.estimatorQuality < policy.minEstimatorQuality) blockers.push(`Estimator quality ${state.estimatorQuality}% is below minimum ${policy.minEstimatorQuality}%`);
  if (state.batteryPct < policy.minArmBatteryPct + 10) warnings.push("Battery is close to arm minimum");
}

function validateDisarm(state: FlightVehicleState, blockers: string[]) {
  if (!state.armed) blockers.push("Vehicle is already disarmed");
  if (state.position.z > 0.4) blockers.push("Cannot disarm while airborne");
}

function validateTakeoff(state: FlightVehicleState, command: FlightCommand, policy: FlightSafetyPolicy, blockers: string[]) {
  if (!state.armed) blockers.push("Takeoff requires armed vehicle");
  if (!["armed", "landed"].includes(state.mode)) blockers.push(`Cannot take off from mode ${state.mode}`);
  const altitude = command.altitudeM ?? command.target?.z;
  if (!Number.isFinite(altitude) || !altitude || altitude <= 0) blockers.push("Takeoff requires a positive altitude");
  if ((altitude ?? 0) > policy.maxTakeoffAltitudeM) blockers.push(`Takeoff altitude exceeds ${policy.maxTakeoffAltitudeM}m`);
  if ((altitude ?? 0) > policy.maxAltitudeM) blockers.push(`Altitude exceeds global max ${policy.maxAltitudeM}m`);
  validateCommandEnergy(state, policy, blockers);
}

function validateWaypoint(
  state: FlightVehicleState,
  command: FlightCommand,
  policy: FlightSafetyPolicy,
  blockers: string[],
  warnings: string[]
) {
  if (!state.armed) blockers.push("Waypoint requires armed vehicle");
  if (!["takeoff", "mission", "hold", "return-home"].includes(state.mode)) blockers.push(`Cannot accept waypoint from mode ${state.mode}`);
  if (!command.target) {
    blockers.push("Waypoint command requires target");
    return;
  }
  validateTarget(command.target, state, policy, blockers, warnings);
  validateCommandEnergy(state, policy, blockers);
}

function validateTarget(
  target: FlightCommand["target"],
  state: FlightVehicleState,
  policy: FlightSafetyPolicy,
  blockers: string[],
  warnings: string[]
) {
  if (!target) return;
  if (!pointInRect(target, policy.geofence)) blockers.push("Target is outside geofence");
  if (policy.noFlyZones.some((zone) => pointInRect(target, zone))) blockers.push("Target is inside a no-fly zone");
  if (target.z < 0) blockers.push("Target altitude cannot be below ground");
  if (target.z > policy.maxAltitudeM) blockers.push(`Target altitude exceeds ${policy.maxAltitudeM}m`);
  const legDistance = distance2d(state.position, target);
  if (legDistance > policy.maxLegDistanceM) blockers.push(`Waypoint leg ${Math.round(legDistance)}m exceeds max ${policy.maxLegDistanceM}m`);
  if (target.z > policy.maxAltitudeM * 0.8) warnings.push("Target altitude is close to global ceiling");
}

function validateRecoveryCapable(state: FlightVehicleState, kind: string, blockers: string[]) {
  if (!state.armed && state.position.z > 0.4) blockers.push(`${kind} requires armed vehicle while airborne`);
  if (!state.armed && state.position.z <= 0.4 && kind !== "land") blockers.push(`${kind} requires armed vehicle`);
}

function validateCommandEnergy(state: FlightVehicleState, policy: FlightSafetyPolicy, blockers: string[]) {
  if (state.batteryPct < policy.minCommandBatteryPct) blockers.push(`Battery ${state.batteryPct}% is below command minimum ${policy.minCommandBatteryPct}%`);
  if (state.batteryPct < policy.reserveBatteryPct) blockers.push(`Battery ${state.batteryPct}% is below reserve ${policy.reserveBatteryPct}%`);
}
