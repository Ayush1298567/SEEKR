export type FlightTransport = "simulator" | "sitl" | "hardware";

export type FlightMode =
  | "disarmed"
  | "armed"
  | "takeoff"
  | "mission"
  | "hold"
  | "return-home"
  | "landing"
  | "landed"
  | "failsafe"
  | "terminated";

export type FlightCommandKind = "arm" | "disarm" | "takeoff" | "waypoint" | "hold" | "return-home" | "land" | "terminate";

export interface FlightVec3 {
  x: number;
  y: number;
  z: number;
}

export interface FlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlightVehicleState {
  vehicleId: string;
  mode: FlightMode;
  armed: boolean;
  position: FlightVec3;
  home: FlightVec3;
  target?: FlightVec3;
  batteryPct: number;
  linkQuality: number;
  estimatorQuality: number;
  lastHeartbeatMs: number;
  updatedAtMs: number;
  activeFailsafe?: FlightFailsafe;
  preflight: {
    imuOk: boolean;
    gpsOk: boolean;
    barometerOk: boolean;
    motorsOk: boolean;
    storageOk: boolean;
  };
}

export interface FlightSafetyPolicy {
  policyId: string;
  transport: FlightTransport;
  allowHardwareActuation: boolean;
  minArmBatteryPct: number;
  minCommandBatteryPct: number;
  reserveBatteryPct: number;
  minLinkQuality: number;
  minEstimatorQuality: number;
  heartbeatTimeoutMs: number;
  maxAltitudeM: number;
  maxTakeoffAltitudeM: number;
  maxLegDistanceM: number;
  geofence: FlightRect;
  noFlyZones: FlightRect[];
}

export interface FlightCommand {
  commandId: string;
  kind: FlightCommandKind;
  vehicleId: string;
  requestedAtMs: number;
  source: "operator" | "gcs" | "autonomy" | "failsafe" | "test";
  transport: FlightTransport;
  target?: FlightVec3;
  altitudeM?: number;
  reason: string;
}

export interface FlightValidation {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export type FlightFailsafeKind = "none" | "low-battery" | "critical-battery" | "link-loss" | "estimator-degraded" | "geofence-breach" | "heartbeat-timeout";

export interface FlightFailsafe {
  kind: Exclude<FlightFailsafeKind, "none">;
  severity: "warn" | "land" | "return-home" | "terminate";
  reason: string;
  triggeredAtMs: number;
  recommendedCommand: FlightCommandKind;
}

export interface FlightEvent {
  eventId: string;
  vehicleId: string;
  type: string;
  createdAtMs: number;
  data: Record<string, unknown>;
}

export interface FlightCommandResult {
  ok: boolean;
  command: FlightCommand;
  validation: FlightValidation;
  state: FlightVehicleState;
  events: FlightEvent[];
}

export interface FlightBenchResult {
  ok: boolean;
  finalState: FlightVehicleState;
  eventCount: number;
  rejectedCommands: Array<{ commandId: string; blockers: string[] }>;
  safety: {
    hardwareCommandRejected: boolean;
    geofenceRejected: boolean;
    lowBatteryRejected: boolean;
  };
}
