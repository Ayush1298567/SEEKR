import { describe, expect, it } from "vitest";
import { OnboardFlightExecutive, defaultFlightSafetyPolicy, initialFlightVehicleState, runFlightBench } from "..";

const now = 1_800_000_000_000;

describe("onboard flight executive", () => {
  it("runs a simulator-only arm, takeoff, waypoint, hold, return-home, and land sequence", () => {
    let clock = now;
    const executive = new OnboardFlightExecutive({ clock: () => clock += 1_000 });

    expect(executive.submit(executive.command("arm")).ok).toBe(true);
    expect(executive.snapshot()).toMatchObject({ armed: true, mode: "armed" });
    expect(executive.submit(executive.command("takeoff", { altitudeM: 10 })).ok).toBe(true);
    for (let index = 0; index < 4; index += 1) executive.tick(1_000);
    expect(executive.snapshot().position.z).toBeGreaterThan(0);

    expect(executive.submit(executive.command("waypoint", { target: { x: 16, y: 14, z: 10 } })).ok).toBe(true);
    for (let index = 0; index < 4; index += 1) executive.tick(1_000);
    expect(executive.snapshot().position.x).toBeGreaterThan(8);

    expect(executive.submit(executive.command("hold")).ok).toBe(true);
    expect(executive.snapshot().mode).toBe("hold");
    expect(executive.submit(executive.command("return-home")).ok).toBe(true);
    for (let index = 0; index < 10; index += 1) executive.tick(1_000);
    expect(executive.submit(executive.command("land")).ok).toBe(true);
    for (let index = 0; index < 4; index += 1) executive.tick(1_000);
    expect(["landing", "landed"]).toContain(executive.snapshot().mode);
    expect(executive.allEvents().map((event) => event.type)).toEqual(expect.arrayContaining(["flight.command.accepted", "flight.tick"]));
  });

  it("enters failsafe on critical battery and blocks non-recovery commands", () => {
    const executive = new OnboardFlightExecutive();
    expect(executive.submit(executive.command("arm")).ok).toBe(true);
    expect(executive.submit(executive.command("takeoff", { altitudeM: 8 })).ok).toBe(true);
    executive.updateTelemetry({ batteryPct: 7 });

    expect(executive.snapshot()).toMatchObject({ mode: "failsafe", activeFailsafe: { kind: "critical-battery", recommendedCommand: "land" } });
    const waypoint = executive.submit(executive.command("waypoint", { target: { x: 14, y: 14, z: 8 } }));
    expect(waypoint.ok).toBe(false);
    expect(waypoint.validation.blockers).toEqual(expect.arrayContaining(["Active failsafe critical-battery blocks non-recovery command"]));
    expect(executive.submit(executive.command("land", { source: "failsafe" })).ok).toBe(true);
  });

  it("allows SITL transport but keeps hardware transport locked", () => {
    const sitl = new OnboardFlightExecutive({
      policy: defaultFlightSafetyPolicy({ transport: "sitl" }),
      state: initialFlightVehicleState({ updatedAtMs: now, lastHeartbeatMs: now })
    });
    expect(sitl.submit(sitl.command("arm", { transport: "sitl" })).ok).toBe(true);

    const hardware = sitl.submit(sitl.command("takeoff", { transport: "hardware", altitudeM: 5, commandId: "hardware-takeoff" }));
    expect(hardware.ok).toBe(false);
    expect(hardware.validation.blockers).toContain("Hardware actuation is locked by flight safety policy");
  });

  it("flight bench rejects hardware, geofence, and low-battery unsafe commands", () => {
    const result = runFlightBench();
    expect(result.ok).toBe(true);
    expect(result.safety).toEqual({ hardwareCommandRejected: true, geofenceRejected: true, lowBatteryRejected: true });
    expect(result.finalState.activeFailsafe?.kind).toBe("critical-battery");
  });
});
