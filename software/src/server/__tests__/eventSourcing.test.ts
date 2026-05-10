import { describe, expect, it } from "vitest";
import { MissionStore } from "../state";
import { hashValue } from "../domain/ids";

const fixedClock = () => 1_800_000_000_000;

describe("event sourced mission engine", () => {
  it("records command lifecycle events for operator actions", () => {
    const store = new MissionStore({ clock: fixedClock });
    const result = store.submitCommand({ kind: "mission.start" });

    expect(result.ok).toBe(true);
    expect(store.snapshot().phase).toBe("running");

    const lifecycleStatuses = store
      .allEvents()
      .filter((event) => event.type === "command.lifecycle.updated")
      .map((event) => event.payload.status);

    expect(lifecycleStatuses).toEqual(["requested", "validated", "approved", "dispatched", "accepted"]);
  });

  it("rejects unsafe commands without producing a domain mutation", () => {
    const store = new MissionStore({ clock: fixedClock });
    store.applyDroneAction("drone-1", "simulate-link-loss");
    const beforeZone = store.snapshot().drones.find((drone) => drone.id === "drone-1")?.assignedZoneId;

    const result = store.submitCommand({
      kind: "zone.assign",
      target: { droneId: "drone-1", zoneId: "zone-a" },
      params: { droneId: "drone-1", zoneId: "zone-a" }
    });

    expect(result.ok).toBe(false);
    expect(result.validation?.blockers).toContain("SEEKR 1 is offline");
    expect(store.snapshot().drones.find((drone) => drone.id === "drone-1")?.assignedZoneId).toBe(beforeZone);
  });

  it("detects hash-chain tampering", () => {
    const store = new MissionStore({ clock: fixedClock });
    store.start();

    const events = store.allEvents();
    expect(store.validateHashChain(events).ok).toBe(true);

    const tampered = events.map((event) => ({ ...event, payload: { ...event.payload } }));
    tampered[0] = { ...tampered[0], payload: { ...tampered[0].payload, tampered: true } };

    expect(store.validateHashChain(tampered).ok).toBe(false);
  });

  it("replays an event log to the same final state hash", () => {
    const store = new MissionStore({ clock: fixedClock });
    store.start();
    for (let index = 0; index < 12; index += 1) store.tick(1);

    const originalHash = hashValue(store.snapshot());
    const replay = new MissionStore({ clock: fixedClock });
    replay.replay(store.allEvents());

    expect(hashValue(replay.snapshot())).toBe(originalHash);
  });
});
