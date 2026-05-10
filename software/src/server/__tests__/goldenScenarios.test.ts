import { describe, expect, it } from "vitest";
import rubble from "../../../fixtures/golden/rubble-training.json";
import wilderness from "../../../fixtures/golden/wilderness-ravine.json";
import { hashValue } from "../domain/ids";
import { MissionStore } from "../state";

const fixedClock = () => 1_800_000_000_000;

describe("golden scenario fixtures", () => {
  it.each([
    ["rubble-training", rubble],
    ["wilderness-ravine", wilderness]
  ])("%s event log and final state hash remain byte-stable", (scenarioId, fixture) => {
    const store = new MissionStore({ clock: fixedClock });
    if (scenarioId !== "rubble-training") expect(store.loadScenario(scenarioId)).toBe(true);
    store.start();
    for (let index = 0; index < fixture.ticks; index += 1) store.tick(1);

    expect(JSON.stringify(store.allEvents())).toBe(JSON.stringify(fixture.eventLog));
    expect(hashValue(store.snapshot())).toBe(fixture.finalStateHash);
    expect(hashValue(store.buildReplayState(store.allEvents(), store.allEvents().at(-1)?.seq))).toBe(fixture.finalStateHash);
  }, 15_000);
});
