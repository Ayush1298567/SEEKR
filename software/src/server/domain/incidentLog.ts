import type { IncidentLog, IncidentLogEntry, MissionEvent, MissionState } from "../../shared/types";
import { deterministicId, hashValue } from "./ids";

export function buildIncidentLog(
  state: MissionState,
  events: MissionEvent[],
  hashChain: { ok: boolean; errors: string[] } = { ok: true, errors: [] },
  generatedAt = Date.now()
): IncidentLog {
  const timeline = events
    .filter(isIncidentEvent)
    .slice(-80)
    .map((event) => entryFromEvent(state, event));
  const openAlerts = state.alerts.filter((alert) => !alert.acknowledged).length;
  const unreviewedDetections = state.detections.filter((detection) => detection.review === "new").length;

  return {
    logId: deterministicId("incident-log", state.missionId, state.stateSeq, generatedAt, events.length),
    missionId: state.missionId,
    stateSeq: state.stateSeq,
    generatedAt,
    mode: "read-only-incident-log",
    summary: `${events.length} events, ${openAlerts} open alerts, ${unreviewedDetections} unreviewed detections, ${state.evidenceAssets.length} evidence assets.`,
    counts: {
      events: events.length,
      alerts: state.alerts.length,
      openAlerts,
      detections: state.detections.length,
      unreviewedDetections,
      evidenceAssets: state.evidenceAssets.length,
      spatialAssets: state.spatialAssets.length,
      commands: state.commandLifecycles.length,
      proposals: state.proposals.length
    },
    timeline,
    evidenceIndex: state.evidenceAssets.map((asset) => ({
      assetId: asset.assetId,
      kind: asset.kind,
      uri: asset.uri,
      hash: asset.hash,
      detectionId: asset.detectionId,
      retentionPolicy: asset.retentionPolicy
    })),
    commandSummary: state.commandLifecycles
      .slice()
      .reverse()
      .map((command) => ({
        commandId: command.commandId,
        kind: command.kind,
        status: command.status,
        requestedBy: command.requestedBy
      })),
    hashChain: {
      ok: hashChain.ok,
      eventCount: events.length,
      finalStateHash: hashValue(state),
      errors: hashChain.errors
    },
    safetyNotes: [
      "Incident log export is read-only and does not create command lifecycle events.",
      "Evidence assets are referenced by URI and hash; binary evidence is not embedded.",
      "Real aircraft command upload remains blocked."
    ]
  };
}

export function buildIncidentLogMarkdown(log: IncidentLog) {
  return [
    "# SEEKR Incident Log",
    "",
    "## Summary",
    `- Mission: ${log.missionId}`,
    `- State sequence: ${log.stateSeq}`,
    `- Mode: ${log.mode}`,
    `- Generated: ${new Date(log.generatedAt).toISOString()}`,
    `- ${log.summary}`,
    "",
    "## Counts",
    ...Object.entries(log.counts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Incident Timeline",
    ...linesOrNone(
      log.timeline.map(
        (entry) =>
          `- #${entry.seq} ${new Date(entry.createdAt).toISOString()} ${entry.priority ? `${entry.priority} ` : ""}${entry.type}: ${entry.title} (${entry.refs.join(", ") || "mission"})`
      )
    ),
    "",
    "## Evidence Index",
    ...linesOrNone(log.evidenceIndex.map((asset) => `- ${asset.assetId}: ${asset.kind}, ${asset.uri}, hash ${asset.hash}`)),
    "",
    "## Command Summary",
    ...linesOrNone(log.commandSummary.map((command) => `- ${command.commandId}: ${command.kind} -> ${command.status}`)),
    "",
    "## Hash Chain",
    `- Status: ${log.hashChain.ok ? "ok" : "failed"}`,
    `- Event count: ${log.hashChain.eventCount}`,
    `- Final state hash: ${log.hashChain.finalStateHash}`,
    ...log.hashChain.errors.map((error) => `- Error: ${error}`),
    "",
    "## Safety Notes",
    ...log.safetyNotes.map((note) => `- ${note}`),
    ""
  ].join("\n");
}

function entryFromEvent(state: MissionState, event: MissionEvent): IncidentLogEntry {
  const payload = event.payload as Record<string, unknown>;
  const detection = payload.detection && typeof payload.detection === "object" ? payload.detection as Record<string, unknown> : undefined;
  const alert = payload.alert && typeof payload.alert === "object" ? payload.alert as Record<string, unknown> : undefined;
  const plan = payload.plan && typeof payload.plan === "object" ? payload.plan as Record<string, unknown> : undefined;
  const asset = payload.asset && typeof payload.asset === "object" ? payload.asset as Record<string, unknown> : undefined;
  const refs = refsForPayload(payload, detection, alert, plan, asset);

  return {
    id: deterministicId("incident-entry", event.eventId, event.type, event.hash).slice(0, 24),
    seq: event.seq,
    createdAt: event.createdAt,
    type: event.type,
    actor: event.actor,
    priority: priorityForEvent(state, event, detection, alert),
    title: titleForEvent(event.type, detection, alert, plan, asset),
    summary: summaryForEvent(event.type, payload, detection, alert, plan, asset),
    refs
  };
}

function refsForPayload(
  payload: Record<string, unknown>,
  detection?: Record<string, unknown>,
  alert?: Record<string, unknown>,
  plan?: Record<string, unknown>,
  asset?: Record<string, unknown>
) {
  return [
    ref("drone", payload.droneId ?? detection?.droneId ?? plan?.droneId ?? asset?.droneId),
    ref("zone", payload.zoneId ?? plan?.zoneId),
    ref("detection", payload.detectionId ?? detection?.id),
    ref("alert", payload.alertId ?? alert?.id),
    ref("asset", payload.assetId ?? asset?.assetId),
    ref("proposal", payload.proposalId),
    ref("command", payload.commandId)
  ].filter((item): item is string => Boolean(item));
}

function ref(prefix: string, value: unknown) {
  return typeof value === "string" && value.length ? `${prefix}:${value}` : undefined;
}

function priorityForEvent(
  state: MissionState,
  event: MissionEvent,
  detection?: Record<string, unknown>,
  alert?: Record<string, unknown>
): IncidentLogEntry["priority"] {
  const fromPayload = alert?.severity ?? detection?.severity;
  if (fromPayload === "P1" || fromPayload === "P2" || fromPayload === "P3") return fromPayload;
  if (event.type.includes("failed") || event.type.includes("dropout")) return "P1";
  if (event.type === "map.delta.ingested" && state.metrics.conflictCells > 0) return "P2";
  if (event.type === "ai.proposal.created") return "P2";
  return undefined;
}

function titleForEvent(
  type: string,
  detection?: Record<string, unknown>,
  alert?: Record<string, unknown>,
  plan?: Record<string, unknown>,
  asset?: Record<string, unknown>
) {
  if (type === "detection.created") return `Detection ${String(detection?.kind ?? "created")}`;
  if (type === "detection.reviewed") return `Detection reviewed`;
  if (type === "alert.created") return String(alert?.title ?? "Alert created");
  if (type === "ai.proposal.created") return `AI proposal ${String(plan?.kind ?? "created")}`;
  if (type === "spatial.asset.ingested") return `Spatial asset ${String(asset?.kind ?? "ingested")}`;
  if (type === "import.completed") return "Sensor import completed";
  return type.replaceAll(".", " ");
}

function summaryForEvent(
  type: string,
  payload: Record<string, unknown>,
  detection?: Record<string, unknown>,
  alert?: Record<string, unknown>,
  plan?: Record<string, unknown>,
  asset?: Record<string, unknown>
) {
  if (type === "detection.created") return `${String(detection?.id ?? "unknown")} at ${Math.round(Number(detection?.confidence ?? 0))}% confidence.`;
  if (type === "detection.reviewed") return `Review set to ${String(payload.review ?? "unknown")}.`;
  if (type === "alert.created") return String(alert?.message ?? alert?.title ?? "Alert created.");
  if (type === "ai.proposal.created") return `Draft ${String(plan?.kind ?? "proposal")} for operator review.`;
  if (type === "spatial.asset.ingested") return `${String(asset?.assetId ?? "asset")} from ${String(asset?.sourceAdapter ?? "unknown")} frame ${String(asset?.frameId ?? "unknown")}.`;
  if (type === "import.completed") return `${String(payload.kind ?? "import")} ${String(payload.importId ?? "unknown")} completed.`;
  return JSON.stringify(payload).slice(0, 220);
}

function isIncidentEvent(event: MissionEvent) {
  return [
    "mission.started",
    "mission.paused",
    "scenario.loaded",
    "drone.action.applied",
    "detection.created",
    "detection.reviewed",
    "alert.created",
    "alert.acknowledged",
    "ai.proposal.created",
    "ai.proposal.approved",
    "ai.proposal.executed",
    "map.delta.ingested",
    "spatial.asset.ingested",
    "import.completed",
    "no_fly_zone.added"
  ].includes(event.type);
}

function linesOrNone(lines: string[]) {
  return lines.length ? lines : ["- None"];
}
