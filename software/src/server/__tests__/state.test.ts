import { describe, expect, it } from "vitest";
import { MissionStore } from "../state";

describe("mission store", () => {
  it("starts with the default training scenario", () => {
    const store = new MissionStore();
    const state = store.snapshot();

    expect(state.scenarioId).toBe("rubble-training");
    expect(state.drones).toHaveLength(3);
    expect(state.zones).toHaveLength(4);
    expect(state.map.cells).toHaveLength(state.map.width * state.map.height);
  });

  it("loads another scenario and resets mission data", () => {
    const store = new MissionStore();
    expect(store.loadScenario("wilderness-ravine")).toBe(true);

    const state = store.snapshot();
    expect(state.scenarioId).toBe("wilderness-ravine");
    expect(state.map.width).toBe(54);
    expect(state.map.height).toBe(34);
    expect(state.phase).toBe("idle");
  });

  it("assigns default zones when the mission starts", () => {
    const store = new MissionStore();
    store.start();
    const state = store.snapshot();

    expect(state.phase).toBe("running");
    expect(state.drones[0].assignedZoneId).toBe("zone-a");
    expect(state.drones[1].assignedZoneId).toBe("zone-b");
    expect(state.drones[2].assignedZoneId).toBe("zone-c");
  });
});
