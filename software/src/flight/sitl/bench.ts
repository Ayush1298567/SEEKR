import { createArduPilotSitlAdapter, createPx4SitlAdapter } from "./adapter";
import type { SitlAdapter, SitlAutopilot, SitlBenchResult } from "./types";

export function runSitlBench(): SitlBenchResult {
  const adapters = [createPx4SitlAdapter(), createArduPilotSitlAdapter()];
  const rejectedHardwareCommands: Record<SitlAutopilot, boolean> = { px4: false, ardupilot: false };
  const finalStates = {} as SitlBenchResult["finalStates"];
  const commandCounts = {} as Record<SitlAutopilot, number>;

  for (const adapter of adapters) {
    runAutopilotSequence(adapter);
    const hardwareTrace = adapter.command({
      commandId: `${adapter.autopilot}-hardware-lock`,
      vehicleId: `${adapter.autopilot}-sitl-1`,
      kind: "takeoff",
      transport: "hardware",
      altitudeM: 6,
      reason: "hardware lock proof",
      requestedAtMs: 1_800_000_020_000
    });
    rejectedHardwareCommands[adapter.autopilot] = !hardwareTrace.result.ok &&
      hardwareTrace.result.validation.blockers.some((blocker) => blocker.includes("Hardware actuation"));
    finalStates[adapter.autopilot] = adapter.snapshot();
    commandCounts[adapter.autopilot] = adapter.traces().length;
  }

  return {
    ok: adapters.every((adapter) => adapter.traces().filter((trace) => trace.result.ok).length >= 6) &&
      Object.values(rejectedHardwareCommands).every(Boolean),
    autopilots: adapters.map((adapter) => adapter.autopilot),
    commandCounts,
    rejectedHardwareCommands,
    finalStates
  };
}

function runAutopilotSequence(adapter: SitlAdapter) {
  const vehicleId = `${adapter.autopilot}-sitl-1`;
  const nextCommandAt = () => adapter.snapshot().updatedAtMs + 250;
  adapter.ingestTelemetry({
    autopilot: adapter.autopilot,
    vehicleId,
    receivedAtMs: 1_800_000_000_000,
    armed: false,
    mode: "STANDBY",
    position: { x: 8, y: 8, z: 0 },
    home: { x: 8, y: 8, z: 0 },
    batteryPct: 90,
    linkQuality: 92,
    estimatorQuality: 88,
    preflightOk: true
  });
  adapter.command({ commandId: `${adapter.autopilot}-arm`, vehicleId, kind: "arm", transport: "sitl", reason: "sitl arm", requestedAtMs: nextCommandAt() });
  adapter.tick(750);
  adapter.command({ commandId: `${adapter.autopilot}-takeoff`, vehicleId, kind: "takeoff", transport: "sitl", altitudeM: 10, reason: "sitl takeoff", requestedAtMs: nextCommandAt() });
  adapter.tick(1_600);
  adapter.command({ commandId: `${adapter.autopilot}-wp1`, vehicleId, kind: "waypoint", transport: "sitl", target: { x: 18, y: 16, z: 10 }, reason: "sitl waypoint", requestedAtMs: nextCommandAt() });
  adapter.tick(2_000);
  adapter.command({ commandId: `${adapter.autopilot}-hold`, vehicleId, kind: "hold", transport: "sitl", reason: "sitl hold", requestedAtMs: nextCommandAt() });
  adapter.tick(500);
  adapter.command({ commandId: `${adapter.autopilot}-rth`, vehicleId, kind: "return-home", transport: "sitl", reason: "sitl return home", requestedAtMs: nextCommandAt() });
  adapter.tick(2_400);
  adapter.command({ commandId: `${adapter.autopilot}-land`, vehicleId, kind: "land", transport: "sitl", reason: "sitl land", requestedAtMs: nextCommandAt() });
  adapter.tick(1_200);
}
