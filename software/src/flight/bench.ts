import type { FlightBenchResult, FlightCommandResult } from "./types";
import { OnboardFlightExecutive } from "./executive";
import { defaultFlightSafetyPolicy } from "./policy";

export function runFlightBench(): FlightBenchResult {
  const clockBase = 1_800_000_000_000;
  let tick = 0;
  const executive = new OnboardFlightExecutive({
    clock: () => clockBase + tick++ * 1_000,
    policy: defaultFlightSafetyPolicy({
      geofence: { x: 0, y: 0, width: 80, height: 60 },
      noFlyZones: [{ x: 30, y: 20, width: 8, height: 8 }]
    })
  });
  const rejectedCommands: FlightBenchResult["rejectedCommands"] = [];
  const results: FlightCommandResult[] = [];

  function submit(result: FlightCommandResult) {
    results.push(result);
    if (!result.ok) rejectedCommands.push({ commandId: result.command.commandId, blockers: result.validation.blockers });
    return result;
  }

  submit(executive.submit(executive.command("arm")));
  submit(executive.submit(executive.command("takeoff", { altitudeM: 10 })));
  for (let index = 0; index < 2; index += 1) executive.tick(1_000);
  submit(executive.submit(executive.command("waypoint", { target: { x: 18, y: 16, z: 10 } })));
  for (let index = 0; index < 4; index += 1) executive.tick(1_000);
  submit(executive.submit(executive.command("hold")));
  submit(executive.submit(executive.command("return-home")));
  for (let index = 0; index < 8; index += 1) executive.tick(1_000);
  submit(executive.submit(executive.command("land")));
  for (let index = 0; index < 4; index += 1) executive.tick(1_000);

  const hardware = submit(executive.submit(executive.command("arm", { transport: "hardware", commandId: "flight-cmd-hardware-lock" })));
  const geofence = submit(executive.submit(executive.command("waypoint", { target: { x: 200, y: 200, z: 10 }, commandId: "flight-cmd-geofence-lock" })));
  executive.updateTelemetry({ batteryPct: 7 });
  const lowBattery = submit(executive.submit(executive.command("takeoff", { altitudeM: 8, commandId: "flight-cmd-low-battery-lock" })));

  const finalState = executive.snapshot();
  return {
    ok:
      results.filter((result) => result.ok).length >= 6 &&
      !hardware.ok &&
      !geofence.ok &&
      !lowBattery.ok &&
      finalState.mode === "failsafe" &&
      finalState.activeFailsafe?.kind === "critical-battery",
    finalState,
    eventCount: executive.allEvents().length,
    rejectedCommands,
    safety: {
      hardwareCommandRejected: !hardware.ok && hardware.validation.blockers.some((blocker) => blocker.includes("Hardware actuation")),
      geofenceRejected: !geofence.ok && geofence.validation.blockers.some((blocker) => blocker.includes("geofence") || blocker.includes("armed")),
      lowBatteryRejected: !lowBattery.ok && lowBattery.validation.blockers.some((blocker) => blocker.includes("Battery") || blocker.includes("failsafe"))
    }
  };
}
