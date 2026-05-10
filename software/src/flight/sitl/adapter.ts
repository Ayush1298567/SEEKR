import { OnboardFlightExecutive } from "../executive";
import { defaultFlightSafetyPolicy, initialFlightVehicleState } from "../policy";
import type { FlightSafetyPolicy, FlightVehicleState } from "../types";
import { externalCommandName, mapSitlMode, validSitlTelemetry } from "./mapper";
import type { SitlAdapter, SitlAutopilot, SitlCommandEnvelope, SitlCommandTrace, SitlTelemetryFrame } from "./types";

export interface SimulatedSitlAdapterOptions {
  autopilot: SitlAutopilot;
  policy?: FlightSafetyPolicy;
  state?: FlightVehicleState;
  clock?: () => number;
}

export class SimulatedSitlAdapter implements SitlAdapter {
  readonly autopilot: SitlAutopilot;
  private readonly executive: OnboardFlightExecutive;
  private readonly commandTraces: SitlCommandTrace[] = [];

  constructor(options: SimulatedSitlAdapterOptions) {
    this.autopilot = options.autopilot;
    const policy = options.policy ?? defaultFlightSafetyPolicy({ transport: "sitl", allowHardwareActuation: false });
    this.executive = new OnboardFlightExecutive({
      clock: options.clock,
      policy,
      state: options.state ?? initialFlightVehicleState({ vehicleId: `${options.autopilot}-sitl-1` })
    });
  }

  ingestTelemetry(frame: SitlTelemetryFrame): FlightVehicleState {
    if (frame.autopilot !== this.autopilot) throw new Error(`Telemetry autopilot ${frame.autopilot} does not match ${this.autopilot}`);
    if (!validSitlTelemetry(frame)) throw new Error("Malformed SITL telemetry frame");
    const current = this.executive.snapshot();
    this.executive.updateTelemetry({
      position: frame.position,
      batteryPct: frame.batteryPct,
      linkQuality: frame.linkQuality,
      estimatorQuality: frame.estimatorQuality,
      lastHeartbeatMs: frame.receivedAtMs
    });
    const updated = this.executive.snapshot();
    return this.executive.hydrate({
      ...updated,
      vehicleId: frame.vehicleId,
      armed: frame.armed,
      home: frame.home ?? current.home,
      lastHeartbeatMs: frame.receivedAtMs,
      updatedAtMs: frame.receivedAtMs,
      mode: mapSitlMode(frame.autopilot, frame.mode, frame.armed),
      preflight: {
        imuOk: frame.preflightOk,
        gpsOk: frame.preflightOk,
        barometerOk: frame.preflightOk,
        motorsOk: frame.preflightOk,
        storageOk: frame.preflightOk
      }
    });
  }

  command(envelope: Omit<SitlCommandEnvelope, "autopilot">): SitlCommandTrace {
    const command = this.executive.command(envelope.kind, {
      commandId: envelope.commandId,
      vehicleId: envelope.vehicleId,
      requestedAtMs: envelope.requestedAtMs,
      source: "gcs",
      transport: envelope.transport,
      target: envelope.target,
      altitudeM: envelope.altitudeM,
      reason: envelope.reason
    });
    const result = this.executive.submit(command);
    const trace = {
      adapter: this.autopilot,
      externalCommand: externalCommandName(this.autopilot, envelope.kind),
      command,
      result
    };
    this.commandTraces.push(trace);
    return trace;
  }

  snapshot(): FlightVehicleState {
    return this.executive.snapshot();
  }

  tick(deltaMs: number): FlightVehicleState {
    return this.executive.tick(deltaMs);
  }

  traces(): SitlCommandTrace[] {
    return [...this.commandTraces];
  }
}

export function createPx4SitlAdapter(options: Omit<SimulatedSitlAdapterOptions, "autopilot"> = {}) {
  return new SimulatedSitlAdapter({ ...options, autopilot: "px4" });
}

export function createArduPilotSitlAdapter(options: Omit<SimulatedSitlAdapterOptions, "autopilot"> = {}) {
  return new SimulatedSitlAdapter({ ...options, autopilot: "ardupilot" });
}
