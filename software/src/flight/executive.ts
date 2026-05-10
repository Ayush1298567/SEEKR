import type { FlightCommand, FlightCommandResult, FlightEvent, FlightSafetyPolicy, FlightVec3, FlightVehicleState } from "./types";
import { clamp, moveToward } from "./geometry";
import { evaluateFailsafe } from "./failsafe";
import { defaultFlightSafetyPolicy, initialFlightVehicleState } from "./policy";
import { validateFlightCommand } from "./safety";

export interface FlightExecutiveOptions {
  state?: FlightVehicleState;
  policy?: FlightSafetyPolicy;
  clock?: () => number;
}

export class OnboardFlightExecutive {
  private state: FlightVehicleState;
  private readonly policy: FlightSafetyPolicy;
  private readonly clock: () => number;
  private readonly events: FlightEvent[] = [];

  constructor(options: FlightExecutiveOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.policy = options.policy ?? defaultFlightSafetyPolicy();
    this.state = options.state ?? initialFlightVehicleState({ updatedAtMs: this.clock(), lastHeartbeatMs: this.clock() });
  }

  snapshot() {
    return this.state;
  }

  allEvents() {
    return [...this.events];
  }

  hydrate(state: FlightVehicleState): FlightVehicleState {
    this.state = state;
    this.events.push(this.event("flight.state.hydrated", state.updatedAtMs, {
      mode: state.mode,
      armed: state.armed,
      position: state.position
    }));
    return this.state;
  }

  submit(command: FlightCommand): FlightCommandResult {
    const now = command.requestedAtMs;
    const validation = validateFlightCommand(this.state, command, this.policy, now);
    const resultEvents: FlightEvent[] = [this.event("flight.command.received", now, { command })];

    if (!validation.ok) {
      resultEvents.push(this.event("flight.command.rejected", now, { commandId: command.commandId, blockers: validation.blockers }));
      this.events.push(...resultEvents);
      return { ok: false, command, validation, state: this.state, events: resultEvents };
    }

    this.state = applyCommand(this.state, command, now);
    const failsafe = evaluateFailsafe(this.state, this.policy, now);
    this.state = {
      ...this.state,
      activeFailsafe: failsafe,
      mode: failsafe ? "failsafe" : this.state.mode,
      updatedAtMs: now
    };
    resultEvents.push(this.event("flight.command.accepted", now, { commandId: command.commandId, mode: this.state.mode, warnings: validation.warnings }));
    if (failsafe) resultEvents.push(this.event("flight.failsafe.triggered", now, { failsafe }));
    this.events.push(...resultEvents);
    return { ok: true, command, validation, state: this.state, events: resultEvents };
  }

  tick(deltaMs: number): FlightVehicleState {
    const now = this.state.updatedAtMs + deltaMs;
    const target = targetForMode(this.state);
    const nextPosition = target ? moveToward(this.state.position, target, Math.max(0.2, deltaMs / 1000 * 6)) : this.state.position;
    const landed = nextPosition.z <= 0.08 && ["landing", "return-home"].includes(this.state.mode);
    const mode = landed ? "landed" : this.state.mode;
    const armed = landed ? false : this.state.armed;
    const batteryBurn = this.state.armed ? deltaMs / 1000 * 0.018 : deltaMs / 1000 * 0.003;
    const candidate = {
      ...this.state,
      mode,
      armed,
      position: landed ? { ...nextPosition, z: 0 } : nextPosition,
      target: landed ? undefined : this.state.target,
      batteryPct: clamp(this.state.batteryPct - batteryBurn, 0, 100),
      lastHeartbeatMs: now,
      updatedAtMs: now
    };
    const failsafe = evaluateFailsafe(candidate, this.policy, now);
    this.state = {
      ...candidate,
      activeFailsafe: failsafe,
      mode: failsafe ? "failsafe" : candidate.mode
    };
    this.events.push(this.event("flight.tick", now, { mode: this.state.mode, position: this.state.position, batteryPct: this.state.batteryPct }));
    if (failsafe) this.events.push(this.event("flight.failsafe.triggered", now, { failsafe }));
    return this.state;
  }

  updateTelemetry(update: Partial<Pick<FlightVehicleState, "batteryPct" | "linkQuality" | "estimatorQuality" | "lastHeartbeatMs" | "position">>) {
    const now = this.clock();
    this.state = {
      ...this.state,
      ...update,
      updatedAtMs: now
    };
    const failsafe = evaluateFailsafe(this.state, this.policy, now);
    this.state = {
      ...this.state,
      activeFailsafe: failsafe,
      mode: failsafe ? "failsafe" : this.state.mode
    };
    this.events.push(this.event("flight.telemetry.updated", now, update as Record<string, unknown>));
    if (failsafe) this.events.push(this.event("flight.failsafe.triggered", now, { failsafe }));
    return this.state;
  }

  command(kind: FlightCommand["kind"], fields: Partial<FlightCommand> = {}): FlightCommand {
    const now = fields.requestedAtMs ?? this.clock();
    return {
      commandId: fields.commandId ?? `flight-cmd-${kind}-${this.events.length + 1}`,
      kind,
      vehicleId: fields.vehicleId ?? this.state.vehicleId,
      requestedAtMs: now,
      source: fields.source ?? "test",
      transport: fields.transport ?? this.policy.transport,
      target: fields.target,
      altitudeM: fields.altitudeM,
      reason: fields.reason ?? `${kind} command`
    };
  }

  private event(type: string, createdAtMs: number, data: Record<string, unknown>): FlightEvent {
    return {
      eventId: `flight-event-${this.events.length + 1}-${createdAtMs}`,
      vehicleId: this.state.vehicleId,
      type,
      createdAtMs,
      data
    };
  }
}

function applyCommand(state: FlightVehicleState, command: FlightCommand, now: number): FlightVehicleState {
  if (command.kind === "arm") return { ...state, armed: true, mode: "armed", updatedAtMs: now };
  if (command.kind === "disarm") return { ...state, armed: false, mode: "disarmed", target: undefined, updatedAtMs: now };
  if (command.kind === "takeoff") {
    const altitude = command.altitudeM ?? command.target?.z ?? 8;
    return {
      ...state,
      armed: true,
      mode: "takeoff",
      target: { ...state.position, z: altitude },
      updatedAtMs: now
    };
  }
  if (command.kind === "waypoint" && command.target) return { ...state, mode: "mission", target: command.target, updatedAtMs: now };
  if (command.kind === "hold") return { ...state, mode: "hold", target: state.position, updatedAtMs: now };
  if (command.kind === "return-home") return { ...state, mode: "return-home", target: { ...state.home, z: Math.min(Math.max(state.position.z, 6), 18) }, updatedAtMs: now };
  if (command.kind === "land") return { ...state, mode: "landing", target: { ...state.position, z: 0 }, updatedAtMs: now };
  if (command.kind === "terminate") return { ...state, armed: false, mode: "terminated", target: undefined, updatedAtMs: now };
  return state;
}

function targetForMode(state: FlightVehicleState): FlightVec3 | undefined {
  if (["disarmed", "landed", "terminated"].includes(state.mode)) return undefined;
  if (state.mode === "return-home") {
    if (Math.hypot(state.position.x - state.home.x, state.position.y - state.home.y) < 0.5) return { ...state.home, z: 0 };
    return state.target;
  }
  return state.target;
}
