import { describe, expect, it } from "vitest";
import { MissionStore } from "../state";

const fixedClock = () => 1_800_000_000_000;

describe("task ledger reassignment lifecycle", () => {
  it("marks dropout tasks incomplete, drafts reassignment, and records approved reassignment", () => {
    const store = new MissionStore({ clock: fixedClock });
    expect(store.loadScenario("wilderness-ravine")).toBe(true);
    store.start();

    for (let index = 0; index < 26; index += 1) store.tick(1);

    const dropoutState = store.snapshot();
    const incomplete = dropoutState.taskLedger.find((task) => task.droneId === "drone-1" && task.status === "incomplete");
    expect(incomplete).toBeDefined();
    expect(dropoutState.zones.find((zone) => zone.id === incomplete?.zoneId)?.assignedDroneIds).not.toContain("drone-1");

    const proposal = dropoutState.proposals.find((candidate) => candidate.plan.kind === "assign-zone" && candidate.plan.zoneId === incomplete?.zoneId);
    expect(proposal).toBeDefined();
    expect(proposal?.validator.ok).toBe(true);

    expect(store.approveProposal(proposal!.id)).toBe(true);
    expect(store.snapshot().taskLedger[0]).toMatchObject({
      zoneId: incomplete?.zoneId,
      status: "reassigned",
      reassignedFromTaskId: incomplete?.taskId
    });
  });
});
