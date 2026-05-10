import { describe, expect, it } from "vitest";
import { MissionStore } from "../state";
import { validateMissionPlan } from "../validators";

describe("mission validators", () => {
  it("accepts a healthy drone zone assignment", () => {
    const store = new MissionStore();
    const state = store.snapshot();

    const result = validateMissionPlan(state, {
      kind: "assign-zone",
      droneId: "drone-1",
      zoneId: "zone-a",
      reason: "test"
    });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("blocks commands to offline drones", () => {
    const store = new MissionStore();
    store.applyDroneAction("drone-1", "simulate-link-loss");
    const state = store.snapshot();

    const result = validateMissionPlan(state, {
      kind: "assign-zone",
      droneId: "drone-1",
      zoneId: "zone-a",
      reason: "test"
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("SEEKR 1 is offline");
  });

  it("blocks focused search when too many drones are already clustered", () => {
    const store = new MissionStore();
    const state = store.snapshot();
    state.drones.forEach((drone) => {
      drone.position = { x: 10, y: 10, z: 2 };
    });

    const result = validateMissionPlan(state, {
      kind: "focused-search",
      droneId: "drone-1",
      coords: { x: 10, y: 10, z: 2 },
      radiusM: 15,
      reason: "test"
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("Too many drones already near requested focus point");
  });
});
