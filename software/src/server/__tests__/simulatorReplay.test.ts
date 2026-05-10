import { describe, expect, it } from "vitest";
import { MissionStore } from "../state";

const fixedClock = () => 1_800_000_000_000;

describe("deterministic simulator", () => {
  it("produces byte-stable event sequences for the same scenario and seed", () => {
    const a = runScenario();
    const b = runScenario();

    expect(JSON.stringify(a.allEvents())).toBe(JSON.stringify(b.allEvents()));
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  });

  it("marks a dropped drone zone incomplete and eligible for reassignment", () => {
    const store = new MissionStore({ clock: fixedClock });
    expect(store.loadScenario("wilderness-ravine")).toBe(true);
    store.start();

    for (let index = 0; index < 26; index += 1) store.tick(1);

    const state = store.snapshot();
    expect(state.drones.find((drone) => drone.id === "drone-1")?.status).toBe("failed");
    expect(state.taskLedger.some((task) => task.droneId === "drone-1" && task.status === "incomplete")).toBe(true);
    expect(state.zones.find((zone) => zone.id === "zone-a")?.status).not.toBe("complete");
  });
});

function runScenario() {
  const store = new MissionStore({ clock: fixedClock });
  store.start();
  for (let index = 0; index < 20; index += 1) store.tick(1);
  return store;
}
