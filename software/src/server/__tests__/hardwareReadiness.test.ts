import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MavlinkAdapter } from "../adapters/mavlinkAdapter";
import { Ros2SlamAdapter } from "../adapters/ros2SlamAdapter";
import { buildHardwareReadinessReport } from "../hardwareReadiness";
import { MissionPersistence } from "../persistence";
import { MissionStore } from "../state";

describe("hardware readiness", () => {
  it("builds Jetson and Raspberry Pi bench reports without mutating mission events", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-hardware-readiness-"));
    try {
      const persistence = new MissionPersistence(root);
      await persistence.init();
      const store = new MissionStore({ clock: () => 1_800_000_000_000, eventStore: persistence.events });
      const beforeEvents = store.allEvents().length;

      const jetson = await buildHardwareReadinessReport("jetson-orin-nano", store, persistence, 1_800_000_000_000);
      const pi = await buildHardwareReadinessReport("raspberry-pi-5", store, persistence, 1_800_000_000_000);

      expect(jetson).toMatchObject({
        ok: true,
        target: { id: "jetson-orin-nano", isaacSupport: "recommended" },
        summary: { commandUploadEnabled: false },
        safetyNotes: expect.arrayContaining([expect.stringContaining("Real MAVLink/ROS 2 command upload")])
      });
      expect(pi).toMatchObject({
        ok: true,
        target: { id: "raspberry-pi-5", isaacSupport: "bridge-only" },
        summary: { commandUploadEnabled: false }
      });
      expect(jetson.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
        "host-platform",
        "node-runtime",
        "tool-ros2-cli",
        "isaac-fit",
        "bench-fixtures",
        "safety-boundary"
      ]));
      expect(jetson.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "safety-boundary", status: "pass", blocking: true })
      ]));
      expect(store.allEvents()).toHaveLength(beforeEvents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps real adapter command methods rejected for bench targets", async () => {
    const adapters = [new MavlinkAdapter(), new Ros2SlamAdapter()];
    for (const adapter of adapters) {
      await expect(adapter.uploadMission({ kind: "hold-drone", droneId: "drone-1", reason: "test" })).resolves.toMatchObject({ accepted: false });
      await expect(adapter.hold("drone-1")).resolves.toMatchObject({ accepted: false });
      await expect(adapter.returnHome("drone-1")).resolves.toMatchObject({ accepted: false });
    }
  });
});
