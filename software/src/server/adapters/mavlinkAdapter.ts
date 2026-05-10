import type { Detection, MapDelta, MissionPlan, TelemetrySample, Vec3 } from "../../shared/types";
import { commandRejected, type AdapterCommandResult, type VehicleAdapter } from "./vehicleAdapter";

type MavlinkFixture = Record<string, unknown> & {
  type?: string;
  msgid?: string | number;
  sysid?: string | number;
  droneId?: string;
};

export class MavlinkAdapter implements VehicleAdapter {
  readonly name = "mavlink";

  async connect() {
    throw new Error("MAVLink adapter is read-only fixture-only until endpoint configuration and safety case are complete.");
  }

  async disconnect() {
    return;
  }

  async readTelemetry(): Promise<TelemetrySample[]> {
    return [];
  }

  async readMapDeltas(): Promise<MapDelta[]> {
    return [];
  }

  async readDetections(): Promise<Detection[]> {
    return [];
  }

  async uploadMission(_plan: MissionPlan): Promise<AdapterCommandResult> {
    return commandRejected("Real MAVLink command upload is disabled until guarded hold/RTH safety gates pass.");
  }

  async hold(droneId: string): Promise<AdapterCommandResult> {
    return commandRejected(`Real MAVLink hold is disabled for ${droneId}; read-only ingest only.`);
  }

  async returnHome(droneId: string): Promise<AdapterCommandResult> {
    return commandRejected(`Real MAVLink return-home is disabled for ${droneId}; read-only ingest only.`);
  }
}

export function normalizeMavlinkMessage(message: MavlinkFixture, receivedAt = Date.now()): TelemetrySample | undefined {
  const type = String(message.type ?? message.msgid ?? "").toUpperCase();
  const droneId = String(message.droneId ?? message.sysid ?? "mavlink-1");
  const base: TelemetrySample = {
    sampleId: `mav-${droneId}-${type}-${receivedAt}`,
    droneId,
    receivedAt,
    heartbeat: type === "HEARTBEAT",
    sourceAdapter: "mavlink"
  };

  if (type === "HEARTBEAT" || type === "0") {
    return {
      ...base,
      heartbeat: true,
      mode: String(message.custom_mode ?? message.base_mode ?? "unknown"),
      status: mavStateToStatus(message.system_status)
    };
  }

  if (type === "BATTERY_STATUS" || type === "SYS_STATUS" || type === "147" || type === "1") {
    const pct = Number(message.battery_remaining ?? message.batteryPct ?? message.battery_remaining_pct);
    return {
      ...base,
      heartbeat: false,
      batteryPct: Number.isFinite(pct) ? clamp(pct, 0, 100) : undefined
    };
  }

  if (type === "LOCAL_POSITION_NED" || type === "32") {
    return {
      ...base,
      heartbeat: false,
      position: nedToEnu({
        x: Number(message.x ?? 0),
        y: Number(message.y ?? 0),
        z: Number(message.z ?? 0)
      }),
      velocity: nedToEnu({
        x: Number(message.vx ?? 0),
        y: Number(message.vy ?? 0),
        z: Number(message.vz ?? 0)
      })
    };
  }

  if (type === "ODOMETRY" || type === "331") {
    const position = (message.position ?? message.pose ?? {}) as Record<string, unknown>;
    const velocity = (message.velocity ?? message.twist ?? {}) as Record<string, unknown>;
    return {
      ...base,
      heartbeat: false,
      position: {
        x: Number(message.x ?? position.x ?? 0),
        y: Number(message.y ?? position.y ?? 0),
        z: Number(message.z ?? position.z ?? 0)
      },
      velocity: {
        x: Number(message.vx ?? velocity.x ?? 0),
        y: Number(message.vy ?? velocity.y ?? 0),
        z: Number(message.vz ?? velocity.z ?? 0)
      }
    };
  }

  if (type === "ESTIMATOR_STATUS" || type === "230") {
    const innovation = Math.max(
      Number(message.pos_horiz_ratio ?? 0),
      Number(message.pos_vert_ratio ?? 0),
      Number(message.vel_ratio ?? 0)
    );
    return {
      ...base,
      heartbeat: false,
      estimatorQuality: clamp(Math.round(100 - innovation * 25), 0, 100)
    };
  }

  if (type === "RADIO_STATUS" || type === "109") {
    const rssi = Number(message.rssi ?? message.remrssi ?? 0);
    return {
      ...base,
      heartbeat: false,
      linkQuality: clamp(rssi, 0, 100)
    };
  }

  return undefined;
}

function mavStateToStatus(value: unknown): TelemetrySample["status"] {
  const state = String(value ?? "").toUpperCase();
  if (state.includes("CRITICAL") || state === "5") return "returning";
  if (state.includes("EMERGENCY") || state === "6") return "failed";
  if (state.includes("ACTIVE") || state === "4") return "exploring";
  if (state.includes("STANDBY") || state === "3") return "idle";
  return undefined;
}

function nedToEnu(value: Vec3): Vec3 {
  return {
    x: value.y,
    y: value.x,
    z: -value.z
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
