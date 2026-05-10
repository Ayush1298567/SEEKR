import type { FlightSafetyPolicy, FlightVehicleState } from "./types";

export function defaultFlightSafetyPolicy(overrides: Partial<FlightSafetyPolicy> = {}): FlightSafetyPolicy {
  return {
    policyId: "seekr-flight-sim-alpha",
    transport: "simulator",
    allowHardwareActuation: false,
    minArmBatteryPct: 35,
    minCommandBatteryPct: 22,
    reserveBatteryPct: 18,
    minLinkQuality: 35,
    minEstimatorQuality: 65,
    heartbeatTimeoutMs: 3_000,
    maxAltitudeM: 60,
    maxTakeoffAltitudeM: 25,
    maxLegDistanceM: 80,
    geofence: { x: 0, y: 0, width: 120, height: 90 },
    noFlyZones: [],
    ...overrides
  };
}

export function initialFlightVehicleState(overrides: Partial<FlightVehicleState> = {}): FlightVehicleState {
  const now = overrides.updatedAtMs ?? 1_800_000_000_000;
  return {
    vehicleId: "seekr-flight-1",
    mode: "disarmed",
    armed: false,
    position: { x: 8, y: 8, z: 0 },
    home: { x: 8, y: 8, z: 0 },
    batteryPct: 92,
    linkQuality: 92,
    estimatorQuality: 88,
    lastHeartbeatMs: now,
    updatedAtMs: now,
    preflight: {
      imuOk: true,
      gpsOk: true,
      barometerOk: true,
      motorsOk: true,
      storageOk: true
    },
    ...overrides
  };
}
