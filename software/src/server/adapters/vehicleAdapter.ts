import type { Detection, MapDelta, MissionPlan, TelemetrySample } from "../../shared/types";

export interface VehicleAdapter {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readTelemetry(): Promise<TelemetrySample[]>;
  readMapDeltas(): Promise<MapDelta[]>;
  readDetections(): Promise<Detection[]>;
  uploadMission(plan: MissionPlan): Promise<AdapterCommandResult>;
  hold(droneId: string): Promise<AdapterCommandResult>;
  returnHome(droneId: string): Promise<AdapterCommandResult>;
}

export interface AdapterCommandResult {
  accepted: boolean;
  commandId: string;
  message: string;
}

export function commandAccepted(message: string): AdapterCommandResult {
  return {
    accepted: true,
    commandId: `adapter-cmd-${Date.now()}`,
    message
  };
}

export function commandRejected(message: string): AdapterCommandResult {
  return {
    accepted: false,
    commandId: `adapter-cmd-${Date.now()}`,
    message
  };
}
