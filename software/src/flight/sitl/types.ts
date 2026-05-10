import type { FlightCommand, FlightCommandKind, FlightCommandResult, FlightTransport, FlightVec3, FlightVehicleState } from "../types";

export type SitlAutopilot = "px4" | "ardupilot";

export interface SitlTelemetryFrame {
  autopilot: SitlAutopilot;
  vehicleId: string;
  receivedAtMs: number;
  armed: boolean;
  mode: string;
  position: FlightVec3;
  home?: FlightVec3;
  batteryPct: number;
  linkQuality: number;
  estimatorQuality: number;
  preflightOk: boolean;
}

export interface SitlCommandEnvelope {
  autopilot: SitlAutopilot;
  commandId: string;
  vehicleId: string;
  kind: FlightCommandKind;
  transport: FlightTransport;
  target?: FlightVec3;
  altitudeM?: number;
  reason: string;
  requestedAtMs: number;
}

export interface SitlCommandTrace {
  adapter: SitlAutopilot;
  externalCommand: string;
  command: FlightCommand;
  result: FlightCommandResult;
}

export interface SitlAdapter {
  readonly autopilot: SitlAutopilot;
  ingestTelemetry(frame: SitlTelemetryFrame): FlightVehicleState;
  command(envelope: Omit<SitlCommandEnvelope, "autopilot">): SitlCommandTrace;
  tick(deltaMs: number): FlightVehicleState;
  snapshot(): FlightVehicleState;
  traces(): SitlCommandTrace[];
}

export interface SitlBenchResult {
  ok: boolean;
  autopilots: SitlAutopilot[];
  commandCounts: Record<SitlAutopilot, number>;
  rejectedHardwareCommands: Record<SitlAutopilot, boolean>;
  finalStates: Record<SitlAutopilot, FlightVehicleState>;
}

export interface SitlProcessIoInput {
  autopilot: SitlAutopilot;
  stdout: string;
  stderr?: string;
  exitCode?: number;
  receivedAtMs?: number;
}

export interface SitlProcessIoResult {
  ok: boolean;
  autopilot: SitlAutopilot;
  telemetryFrames: SitlTelemetryFrame[];
  commandTraces: SitlCommandTrace[];
  rejectedHardwareCommand: boolean;
  parseErrors: string[];
  stderrTail: string;
  exitCode?: number;
  commandUploadEnabled: false;
}
