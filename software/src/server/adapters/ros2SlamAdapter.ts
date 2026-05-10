import type { Detection, MapDelta, MissionPlan, TelemetrySample } from "../../shared/types";
import { commandRejected, type AdapterCommandResult, type VehicleAdapter } from "./vehicleAdapter";

export interface OccupancyGridFixture {
  droneId?: string;
  sourceDroneId?: string;
  sourceAdapter?: string;
  frame_id?: string;
  frameId?: string;
  stamp?: number;
  info: {
    width: number;
    height: number;
    resolution?: number;
    origin?: { position?: { x?: number; y?: number; z?: number } };
  };
  data: number[];
  transformConfidence?: number;
  metadata?: Record<string, unknown>;
}

export class Ros2SlamAdapter implements VehicleAdapter {
  readonly name = "ros2-slam";

  async connect() {
    throw new Error("ROS 2 SLAM adapter is read-only fixture-only until DDS/topic configuration and safety case are complete.");
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
    return commandRejected("ROS 2 command handoff is disabled; read-only SLAM ingest only.");
  }

  async hold(droneId: string): Promise<AdapterCommandResult> {
    return commandRejected(`ROS 2 hold intent disabled for ${droneId}; read-only ingest only.`);
  }

  async returnHome(droneId: string): Promise<AdapterCommandResult> {
    return commandRejected(`ROS 2 return-home intent disabled for ${droneId}; read-only ingest only.`);
  }
}

export function occupancyGridToMapDelta(grid: OccupancyGridFixture, missionId: string, createdAt = Date.now()): MapDelta {
  const sourceDroneId = String(grid.sourceDroneId ?? grid.droneId ?? "ros2-map");
  const width = grid.info.width;
  const cellCount = grid.info.width * grid.info.height;
  const cells = Array.from({ length: cellCount }, (_unused, index) => {
    const value = Number(grid.data[index] ?? -1);
    const x = index % width;
    const y = Math.floor(index / width);
    const probability = value < 0 ? 0.5 : clamp(value / 100, 0, 1);
    return {
      x,
      y,
      occupancy: value < 0 ? "unknown" : value >= 65 ? "occupied" : "free",
      probability,
      confidence: value < 0 ? 0.25 : Math.max(0.35, Math.abs(probability - 0.5) * 2)
    } as const;
  });

  return {
    deltaId: `ros2-map-${sourceDroneId}-${createdAt}`,
    missionId,
    sourceDroneId,
    sourceAdapter: String(grid.sourceAdapter ?? "ros2-slam"),
    frameId: String(grid.frame_id ?? grid.frameId ?? "map"),
    transformConfidence: clamp(Number(grid.transformConfidence ?? 0.8), 0, 1),
    createdAt: Number(grid.stamp ?? createdAt),
    cells,
    metadata: grid.metadata ?? {}
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
