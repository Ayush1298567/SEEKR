import { describe, expect, it } from "vitest";
import { createArduPilotSitlAdapter, createPx4SitlAdapter, mapSitlMode, runSitlBench, runSitlProcessIo } from "..";

describe("SITL adapters", () => {
  it("maps PX4 and ArduPilot modes into flight-core modes", () => {
    expect(mapSitlMode("px4", "AUTO.MISSION", true)).toBe("mission");
    expect(mapSitlMode("px4", "AUTO.RTL", true)).toBe("return-home");
    expect(mapSitlMode("ardupilot", "LOITER", true)).toBe("hold");
    expect(mapSitlMode("ardupilot", "LAND", true)).toBe("landing");
    expect(mapSitlMode("ardupilot", "STABILIZE", false)).toBe("disarmed");
  });

  it("ingests telemetry and executes a PX4 SITL command trace", () => {
    const adapter = createPx4SitlAdapter();
    const state = adapter.ingestTelemetry({
      autopilot: "px4",
      vehicleId: "px4-sitl-1",
      receivedAtMs: 1_800_000_000_000,
      armed: false,
      mode: "STANDBY",
      position: { x: 8, y: 8, z: 0 },
      batteryPct: 91,
      linkQuality: 93,
      estimatorQuality: 89,
      preflightOk: true
    });
    expect(state).toMatchObject({ mode: "disarmed", armed: false, batteryPct: 91 });
    expect(adapter.snapshot()).toMatchObject({ mode: "disarmed", armed: false, batteryPct: 91 });

    const arm = adapter.command({
      commandId: "px4-arm",
      vehicleId: "px4-sitl-1",
      kind: "arm",
      transport: "sitl",
      reason: "test arm",
      requestedAtMs: 1_800_000_001_000
    });
    expect(arm).toMatchObject({ adapter: "px4", externalCommand: "MAV_CMD_COMPONENT_ARM_DISARM", result: { ok: true } });
    expect(adapter.traces()).toHaveLength(1);
  });

  it("persists SITL telemetry mapping before command validation", () => {
    const adapter = createArduPilotSitlAdapter();
    adapter.ingestTelemetry({
      autopilot: "ardupilot",
      vehicleId: "ardupilot-sitl-1",
      receivedAtMs: 1_800_000_000_000,
      armed: true,
      mode: "LOITER",
      position: { x: 14, y: 15, z: 7 },
      home: { x: 8, y: 8, z: 0 },
      batteryPct: 84,
      linkQuality: 86,
      estimatorQuality: 82,
      preflightOk: true
    });

    expect(adapter.snapshot()).toMatchObject({
      mode: "hold",
      armed: true,
      position: { x: 14, y: 15, z: 7 },
      lastHeartbeatMs: 1_800_000_000_000
    });
    const hold = adapter.command({
      commandId: "ardupilot-hold",
      vehicleId: "ardupilot-sitl-1",
      kind: "hold",
      transport: "sitl",
      reason: "hold from hydrated SITL state",
      requestedAtMs: 1_800_000_000_500
    });
    expect(hold.result).toMatchObject({ ok: true });
  });

  it("rejects hardware transport through both SITL adapters", () => {
    for (const adapter of [createPx4SitlAdapter(), createArduPilotSitlAdapter()]) {
      adapter.ingestTelemetry({
        autopilot: adapter.autopilot,
        vehicleId: `${adapter.autopilot}-sitl-1`,
        receivedAtMs: 1_800_000_000_000,
        armed: false,
        mode: "STANDBY",
        position: { x: 8, y: 8, z: 0 },
        batteryPct: 91,
        linkQuality: 93,
        estimatorQuality: 89,
        preflightOk: true
      });
      const trace = adapter.command({
        commandId: `${adapter.autopilot}-hardware`,
        vehicleId: `${adapter.autopilot}-sitl-1`,
        kind: "arm",
        transport: "hardware",
        reason: "hardware should reject",
        requestedAtMs: 1_800_000_001_000
      });
      expect(trace.result.ok).toBe(false);
      expect(trace.result.validation.blockers).toContain("Hardware actuation is locked by flight safety policy");
    }
  });

  it("runs the combined PX4 and ArduPilot SITL bench", () => {
    const result = runSitlBench();
    expect(result.ok).toBe(true);
    expect(result.autopilots).toEqual(["px4", "ardupilot"]);
    expect(result.rejectedHardwareCommands).toEqual({ px4: true, ardupilot: true });
    expect(result.commandCounts.px4).toBeGreaterThanOrEqual(7);
    expect(result.commandCounts.ardupilot).toBeGreaterThanOrEqual(7);
  });

  it("parses PX4 process IO while keeping hardware command upload disabled", () => {
    const result = runSitlProcessIo({
      autopilot: "px4",
      stdout: [
        JSON.stringify({
          type: "telemetry",
          vehicleId: "px4-sitl-1",
          receivedAtMs: 1_800_000_000_000,
          armed: false,
          mode: "STANDBY",
          position: { x: 8, y: 8, z: 0 },
          batteryPct: 91,
          linkQuality: 93,
          estimatorQuality: 89,
          preflightOk: true
        }),
        JSON.stringify({
          type: "command",
          commandId: "px4-process-arm",
          vehicleId: "px4-sitl-1",
          kind: "arm",
          transport: "sitl",
          reason: "process IO arm trace",
          requestedAtMs: 1_800_000_001_000
        }),
        JSON.stringify({
          type: "command",
          commandId: "px4-process-hardware-takeoff",
          vehicleId: "px4-sitl-1",
          kind: "takeoff",
          transport: "hardware",
          altitudeM: 12,
          reason: "hardware command must stay locked",
          requestedAtMs: 1_800_000_002_000
        })
      ].join("\n")
    });

    expect(result.ok).toBe(true);
    expect(result.commandUploadEnabled).toBe(false);
    expect(result.telemetryFrames).toHaveLength(1);
    expect(result.commandTraces).toHaveLength(2);
    expect(result.rejectedHardwareCommand).toBe(true);
    expect(result.parseErrors).toEqual([]);
    expect(result.commandTraces.at(-1)?.result.validation.blockers).toContain("Hardware actuation is locked by flight safety policy");
  });

  it("reports malformed ArduPilot process IO without throwing", () => {
    const result = runSitlProcessIo({
      autopilot: "ardupilot",
      stdout: "{\"type\":\"telemetry\",\"vehicleId\":\"ardupilot-sitl-1\"}\nnot-json",
      stderr: "sim exited after malformed frame",
      exitCode: 1
    });

    expect(result.ok).toBe(false);
    expect(result.commandUploadEnabled).toBe(false);
    expect(result.telemetryFrames).toEqual([]);
    expect(result.commandTraces).toEqual([]);
    expect(result.parseErrors.length).toBeGreaterThanOrEqual(2);
    expect(result.stderrTail).toContain("malformed frame");
  });
});
