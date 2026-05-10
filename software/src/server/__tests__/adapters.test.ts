import { describe, expect, it } from "vitest";
import { normalizeMavlinkMessage } from "../adapters/mavlinkAdapter";
import { occupancyGridToMapDelta } from "../adapters/ros2SlamAdapter";

describe("adapter fixture mapping", () => {
  it("normalizes MAVLink heartbeat, battery, position, estimator, and radio messages", () => {
    expect(normalizeMavlinkMessage({ type: "HEARTBEAT", sysid: 7, system_status: "ACTIVE" }, 1000)).toMatchObject({
      droneId: "7",
      status: "exploring",
      sourceAdapter: "mavlink"
    });

    expect(normalizeMavlinkMessage({ type: "BATTERY_STATUS", sysid: 7, battery_remaining: 73 }, 1001)).toMatchObject({
      batteryPct: 73
    });

    expect(normalizeMavlinkMessage({ type: "LOCAL_POSITION_NED", sysid: 7, x: 2, y: 3, z: -4 }, 1002)).toMatchObject({
      position: { x: 3, y: 2, z: 4 }
    });

    expect(normalizeMavlinkMessage({ type: "ESTIMATOR_STATUS", sysid: 7, pos_horiz_ratio: 1.2 }, 1003)).toMatchObject({
      estimatorQuality: 70
    });

    expect(normalizeMavlinkMessage({ type: "RADIO_STATUS", sysid: 7, rssi: 62 }, 1004)).toMatchObject({
      linkQuality: 62
    });
  });

  it("converts ROS 2 occupancy-grid style fixtures to map deltas", () => {
    const delta = occupancyGridToMapDelta(
      {
        droneId: "drone-1",
        frame_id: "map",
        info: { width: 2, height: 2 },
        data: [-1, 0, 80, 35],
        transformConfidence: 0.9
      },
      "mission-1",
      1000
    );

    expect(delta.cells).toHaveLength(4);
    expect(delta.cells[0].occupancy).toBe("unknown");
    expect(delta.cells[2]).toMatchObject({ x: 0, y: 1, occupancy: "occupied" });
    expect(delta.transformConfidence).toBe(0.9);
  });
});
