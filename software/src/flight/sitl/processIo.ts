import type { FlightCommandKind, FlightTransport, FlightVec3 } from "../types";
import { SimulatedSitlAdapter } from "./adapter";
import type { SitlAutopilot, SitlCommandEnvelope, SitlProcessIoInput, SitlProcessIoResult, SitlTelemetryFrame } from "./types";

const COMMAND_KINDS: FlightCommandKind[] = ["arm", "disarm", "takeoff", "waypoint", "hold", "return-home", "land", "terminate"];
const TRANSPORTS: FlightTransport[] = ["simulator", "sitl", "hardware"];

export function runSitlProcessIo(input: SitlProcessIoInput): SitlProcessIoResult {
  const adapter = new SimulatedSitlAdapter({
    autopilot: input.autopilot,
    clock: () => input.receivedAtMs ?? Date.now()
  });
  const telemetryFrames: SitlTelemetryFrame[] = [];
  const parseErrors: string[] = [];

  parseProcessRecords(input.stdout).forEach((record, index) => {
    if (!record.ok) {
      parseErrors.push(`record ${index}: ${record.error}`);
      return;
    }
    try {
      const type = recordType(record.value);
      if (type === "telemetry") {
        const frame = normalizeTelemetryFrame(input.autopilot, record.value, input.receivedAtMs);
        telemetryFrames.push(frame);
        adapter.ingestTelemetry(frame);
        return;
      }
      if (type === "command") {
        adapter.command(normalizeCommandEnvelope(input.autopilot, record.value, input.receivedAtMs));
        return;
      }
      parseErrors.push(`record ${index}: unsupported SITL process record type ${type || "unknown"}`);
    } catch (error) {
      parseErrors.push(`record ${index}: ${formatError(error)}`);
    }
  });

  const commandTraces = adapter.traces();
  const hardwareTraces = commandTraces.filter((trace) => trace.command.transport === "hardware");
  const rejectedHardwareCommand = hardwareTraces.some((trace) => !trace.result.ok);
  const acceptedHardwareCommand = hardwareTraces.some((trace) => trace.result.ok);

  return {
    ok: parseErrors.length === 0 && !acceptedHardwareCommand && input.exitCode !== 127,
    autopilot: input.autopilot,
    telemetryFrames,
    commandTraces,
    rejectedHardwareCommand,
    parseErrors,
    stderrTail: tail(input.stderr ?? ""),
    exitCode: input.exitCode,
    commandUploadEnabled: false
  };
}

function parseProcessRecords(stdout: string): Array<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map((value) => ({ ok: true, value }));
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown[] }).records)) {
      return (parsed as { records: unknown[] }).records.map((value) => ({ ok: true, value }));
    }
    return [{ ok: true, value: parsed }];
  } catch {
    return trimmed.split(/\r?\n/).filter(Boolean).map((line, lineIndex) => {
      try {
        return { ok: true, value: JSON.parse(line) as unknown };
      } catch (error) {
        return { ok: false, error: `line ${lineIndex + 1}: ${formatError(error)}` };
      }
    });
  }
}

function normalizeTelemetryFrame(autopilot: SitlAutopilot, record: unknown, fallbackReceivedAtMs?: number): SitlTelemetryFrame {
  const candidate = objectRecord(record);
  const source = objectRecord(candidate.sample ?? candidate.frame ?? candidate);
  return {
    autopilot: normalizeAutopilot(source.autopilot ?? candidate.autopilot ?? autopilot),
    vehicleId: stringValue(source.vehicleId ?? candidate.vehicleId, `${autopilot}-sitl-1`),
    receivedAtMs: numberValue(source.receivedAtMs ?? source.receivedAt ?? candidate.receivedAtMs ?? fallbackReceivedAtMs, "receivedAtMs"),
    armed: booleanValue(source.armed ?? candidate.armed, false),
    mode: stringValue(source.mode ?? candidate.mode, "STANDBY"),
    position: vec3Value(source.position ?? candidate.position, "position"),
    home: optionalVec3Value(source.home ?? candidate.home, "home"),
    batteryPct: numberValue(source.batteryPct ?? candidate.batteryPct, "batteryPct"),
    linkQuality: numberValue(source.linkQuality ?? candidate.linkQuality, "linkQuality"),
    estimatorQuality: numberValue(source.estimatorQuality ?? candidate.estimatorQuality, "estimatorQuality"),
    preflightOk: booleanValue(source.preflightOk ?? candidate.preflightOk, true)
  };
}

function normalizeCommandEnvelope(autopilot: SitlAutopilot, record: unknown, fallbackRequestedAtMs?: number): Omit<SitlCommandEnvelope, "autopilot"> {
  const candidate = objectRecord(record);
  const source = objectRecord(candidate.command ?? candidate.envelope ?? candidate);
  const kind = commandKindValue(source.kind ?? candidate.kind);
  return {
    commandId: stringValue(source.commandId ?? candidate.commandId, `${autopilot}-${kind}-${fallbackRequestedAtMs ?? Date.now()}`),
    vehicleId: stringValue(source.vehicleId ?? candidate.vehicleId, `${autopilot}-sitl-1`),
    kind,
    transport: transportValue(source.transport ?? candidate.transport ?? "sitl"),
    target: optionalVec3Value(source.target ?? candidate.target, "target"),
    altitudeM: optionalNumberValue(source.altitudeM ?? candidate.altitudeM, "altitudeM"),
    reason: stringValue(source.reason ?? candidate.reason, "SITL process IO command"),
    requestedAtMs: numberValue(source.requestedAtMs ?? source.requestedAt ?? candidate.requestedAtMs ?? fallbackRequestedAtMs, "requestedAtMs")
  };
}

function recordType(record: unknown) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "";
  return String((record as Record<string, unknown>).type ?? "");
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("record must be an object");
  return value as Record<string, unknown>;
}

function normalizeAutopilot(value: unknown): SitlAutopilot {
  if (value === "px4" || value === "ardupilot") return value;
  throw new Error("autopilot must be px4 or ardupilot");
}

function commandKindValue(value: unknown): FlightCommandKind {
  if (typeof value === "string" && COMMAND_KINDS.includes(value as FlightCommandKind)) return value as FlightCommandKind;
  throw new Error(`command kind must be one of ${COMMAND_KINDS.join(", ")}`);
}

function transportValue(value: unknown): FlightTransport {
  if (typeof value === "string" && TRANSPORTS.includes(value as FlightTransport)) return value as FlightTransport;
  throw new Error(`transport must be one of ${TRANSPORTS.join(", ")}`);
}

function vec3Value(value: unknown, label: string): FlightVec3 {
  const candidate = objectRecord(value);
  return {
    x: numberValue(candidate.x, `${label}.x`),
    y: numberValue(candidate.y, `${label}.y`),
    z: numberValue(candidate.z, `${label}.z`)
  };
}

function optionalVec3Value(value: unknown, label: string): FlightVec3 | undefined {
  return typeof value === "undefined" ? undefined : vec3Value(value, label);
}

function numberValue(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`);
  return parsed;
}

function optionalNumberValue(value: unknown, label: string): number | undefined {
  if (typeof value === "undefined") return undefined;
  return numberValue(value, label);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "undefined") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("boolean field must be true or false");
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === "undefined") return fallback;
  if (typeof value === "string" && value.length) return value;
  throw new Error("string field must be a nonempty string");
}

function tail(value: string, maxLines = 20) {
  return value.trim().split(/\r?\n/).slice(-maxLines).join("\n");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
