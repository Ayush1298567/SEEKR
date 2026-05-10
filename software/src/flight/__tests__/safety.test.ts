import { describe, expect, it } from "vitest";
import { defaultFlightSafetyPolicy, initialFlightVehicleState, validateFlightCommand } from "..";

const now = 1_800_000_000_000;

describe("flight safety validation", () => {
  it("rejects hardware actuation unless the policy explicitly allows it", () => {
    const state = initialFlightVehicleState({ updatedAtMs: now, lastHeartbeatMs: now });
    const policy = defaultFlightSafetyPolicy();
    const validation = validateFlightCommand(state, {
      commandId: "hardware-arm",
      kind: "arm",
      vehicleId: state.vehicleId,
      requestedAtMs: now,
      source: "test",
      transport: "hardware",
      reason: "hardware probe"
    }, policy);

    expect(validation.ok).toBe(false);
    expect(validation.blockers).toContain("Hardware actuation is locked by flight safety policy");
  });

  it("blocks arming on failed preflight, weak link, low estimator, and low battery", () => {
    const state = initialFlightVehicleState({
      updatedAtMs: now,
      lastHeartbeatMs: now,
      batteryPct: 20,
      linkQuality: 12,
      estimatorQuality: 40,
      preflight: { imuOk: true, gpsOk: false, barometerOk: true, motorsOk: true, storageOk: true }
    });
    const validation = validateFlightCommand(state, {
      commandId: "unsafe-arm",
      kind: "arm",
      vehicleId: state.vehicleId,
      requestedAtMs: now,
      source: "test",
      transport: "simulator",
      reason: "unsafe arm"
    }, defaultFlightSafetyPolicy());

    expect(validation.ok).toBe(false);
    expect(validation.blockers).toEqual(expect.arrayContaining([
      "Preflight checks failed: gpsOk",
      "Battery 20% is below arm minimum 35%",
      "Link quality 12% is below command minimum 35%",
      "Estimator quality 40% is below minimum 65%"
    ]));
  });

  it("rejects waypoints outside geofence or inside no-fly zones", () => {
    const policy = defaultFlightSafetyPolicy({
      geofence: { x: 0, y: 0, width: 50, height: 50 },
      noFlyZones: [{ x: 10, y: 10, width: 5, height: 5 }]
    });
    const state = initialFlightVehicleState({ mode: "mission", armed: true, position: { x: 4, y: 4, z: 8 }, updatedAtMs: now, lastHeartbeatMs: now });
    const outside = validateFlightCommand(state, {
      commandId: "outside",
      kind: "waypoint",
      vehicleId: state.vehicleId,
      requestedAtMs: now,
      source: "test",
      transport: "simulator",
      target: { x: 70, y: 70, z: 8 },
      reason: "outside"
    }, policy);
    const noFly = validateFlightCommand(state, {
      commandId: "nofly",
      kind: "waypoint",
      vehicleId: state.vehicleId,
      requestedAtMs: now,
      source: "test",
      transport: "simulator",
      target: { x: 12, y: 12, z: 8 },
      reason: "no fly"
    }, policy);

    expect(outside.ok).toBe(false);
    expect(outside.blockers).toEqual(expect.arrayContaining(["Target is outside geofence"]));
    expect(noFly.ok).toBe(false);
    expect(noFly.blockers).toEqual(expect.arrayContaining(["Target is inside a no-fly zone"]));
  });
});
