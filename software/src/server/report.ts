import type { MissionEvent, MissionState, ReplayManifest } from "../shared/types";
import { buildIncidentLog } from "./domain/incidentLog";
import { buildPassivePlan } from "./domain/passivePlan";
import { hashValue } from "./domain/ids";

export interface MissionReportData {
  missionId: string;
  scenarioId: string;
  scenarioName: string;
  seed: number;
  phase: MissionState["phase"];
  stateSeq: number;
  finalStateHash: string;
  eventCount: number;
  tamperCheck: { ok: boolean; errors: string[] };
  generatedAt: number;
  timeline: Array<{ seq: number; createdAt: number; type: string }>;
  droneHealth: Array<{ id: string; name: string; status: string; batteryPct: number; linkQuality: number; estimatorQuality: number; currentTask: string }>;
  zoneCoverage: Array<{ id: string; name: string; coverage: number; status: string; assignedDroneIds: string[] }>;
  detections: Array<{ id: string; kind: string; confidence: number; review: string; droneId: string; evidenceAssetIds: string[] }>;
  evidenceAssets: Array<{ assetId: string; kind: string; uri: string; hash: string }>;
  spatialAssets: Array<{
    assetId: string;
    kind: string;
    status: string;
    sourceAdapter: string;
    frameId: string;
    confidence: number;
    transformConfidence: number;
    assetFormat?: string;
    coordinateSystem?: string;
    droneId?: string;
    uri?: string;
  }>;
  spatialSceneSummary: {
    total: number;
    highConfidence: number;
    vpsPoseFixes: number;
    timeRangedAssets: number;
    weakTransforms: number;
  };
  imports: Array<{ seq: number; importId: string; kind: string; counts: Record<string, unknown>; rejected: number }>;
  incidentLog: ReturnType<typeof buildIncidentLog>;
  passivePlan: ReturnType<typeof buildPassivePlan>;
  commandLifecycles: Array<{ commandId: string; kind: string; status: string }>;
  aiProposals: Array<{ id: string; status: string; provider: string; model: string; planKind: string; validatorOk: boolean }>;
  taskLedger: Array<{ taskId: string; zoneId: string; droneId: string; status: string; reason: string; reassignedFromTaskId?: string }>;
  limitations: string[];
}

export function buildMissionReportData(
  state: MissionState,
  events: MissionEvent[],
  tamperCheck: { ok: boolean; errors: string[] },
  generatedAt = Date.now()
): MissionReportData {
  return {
    missionId: state.missionId,
    scenarioId: state.scenarioId,
    scenarioName: state.scenarioName,
    seed: state.simulator.seed,
    phase: state.phase,
    stateSeq: state.stateSeq,
    finalStateHash: hashValue(state),
    eventCount: events.length,
    tamperCheck,
    generatedAt,
    timeline: majorEvents(events).slice(-30).map((event) => ({ seq: event.seq, createdAt: event.createdAt, type: event.type })),
    droneHealth: state.drones.map((drone) => ({
      id: drone.id,
      name: drone.name,
      status: drone.status,
      batteryPct: Math.round(drone.batteryPct),
      linkQuality: Math.round(drone.linkQuality),
      estimatorQuality: Math.round(drone.estimatorQuality),
      currentTask: drone.currentTask
    })),
    zoneCoverage: state.zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      coverage: zone.coverage,
      status: zone.status,
      assignedDroneIds: zone.assignedDroneIds
    })),
    detections: state.detections.map((detection) => ({
      id: detection.id,
      kind: detection.kind,
      confidence: detection.confidence,
      review: detection.review,
      droneId: detection.droneId,
      evidenceAssetIds: detection.evidenceAssetIds
    })),
    evidenceAssets: state.evidenceAssets.map((asset) => ({
      assetId: asset.assetId,
      kind: asset.kind,
      uri: asset.uri,
      hash: asset.hash
    })),
    spatialAssets: state.spatialAssets.map((asset) => ({
      assetId: asset.assetId,
      kind: asset.kind,
      status: asset.status,
      sourceAdapter: asset.sourceAdapter,
      frameId: asset.frameId,
      confidence: asset.confidence,
      transformConfidence: asset.transformConfidence,
      assetFormat: asset.assetFormat,
      coordinateSystem: asset.coordinateSystem,
      droneId: asset.droneId,
      uri: asset.uri
    })),
    spatialSceneSummary: {
      total: state.spatialAssets.length,
      highConfidence: state.spatialAssets.filter((asset) => asset.confidence >= 0.8 && asset.transformConfidence >= 0.75).length,
      vpsPoseFixes: state.spatialAssets.filter((asset) => asset.kind === "vps-pose").length,
      timeRangedAssets: state.spatialAssets.filter((asset) => asset.timeRange).length,
      weakTransforms: state.spatialAssets.filter((asset) => asset.transformConfidence < 0.65).length
    },
    imports: importEvents(events),
    incidentLog: buildIncidentLog(state, events, tamperCheck, generatedAt),
    passivePlan: buildPassivePlan(state, events, generatedAt),
    commandLifecycles: state.commandLifecycles
      .slice()
      .reverse()
      .map((command) => ({ commandId: command.commandId, kind: command.kind, status: command.status })),
    aiProposals: state.proposals.map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      provider: proposal.provider,
      model: proposal.model,
      planKind: proposal.plan.kind,
      validatorOk: proposal.validator.ok
    })),
    taskLedger: state.taskLedger.slice(0, 25).map((task) => ({
      taskId: task.taskId,
      zoneId: task.zoneId,
      droneId: task.droneId,
      status: task.status,
      reason: task.reason,
      reassignedFromTaskId: task.reassignedFromTaskId
    })),
    limitations: [
      "SEEKR V1 is simulator, replay, evidence, and read-only fixture integration software.",
      "Real MAVLink, ROS 2, or aircraft command upload is blocked in V1.",
      "Evidence and spatial assets are referenced by URI/hash or local metadata; binary blobs are not embedded in this report.",
      "Gaussian splats, point clouds, meshes, 4D reconstructions, spatial video, and VPS/VSP pose fixes are local-first metadata ingest surfaces in V1."
    ]
  };
}

export function buildMissionReportMarkdown(
  state: MissionState,
  events: MissionEvent[],
  tamperCheck: { ok: boolean; errors: string[] },
  manifest?: ReplayManifest,
  generatedAt = Date.now()
) {
  const data = buildMissionReportData(state, events, tamperCheck, generatedAt);

  return [
    `# SEEKR Mission Report`,
    "",
    "## Mission Summary",
    `- Mission: ${data.missionId}`,
    `- Scenario: ${data.scenarioName} (${data.scenarioId})`,
    `- Seed: ${data.seed}`,
    `- Phase: ${data.phase}`,
    `- State sequence: ${data.stateSeq}`,
    `- Event count: ${data.eventCount}`,
    `- Generated: ${new Date(generatedAt).toISOString()}`,
    "",
    "## Timeline Of Major Events",
    ...linesOrNone(
      data.timeline.map((event) => `- #${event.seq} ${new Date(event.createdAt).toISOString()} ${event.type}`)
    ),
    "",
    "## Drone Health Summary",
    ...state.drones.map(
      (drone) =>
        `- ${drone.name}: ${drone.status}, battery ${Math.round(drone.batteryPct)}%, link ${Math.round(drone.linkQuality)}%, estimator ${Math.round(drone.estimatorQuality)}%, task "${drone.currentTask}"`
    ),
    "",
    "## Zone Coverage Summary",
    ...state.zones.map(
      (zone) =>
        `- ${zone.name}: ${zone.coverage}% coverage, ${zone.status}, assigned ${zone.assignedDroneIds.join(", ") || "none"}`
    ),
    "",
    "## Detections And Review Status",
    ...linesOrNone(
      state.detections.map(
        (detection) =>
          `- ${detection.id}: ${detection.kind}, ${detection.confidence}%, ${detection.review}, drone ${detection.droneId}, evidence ${detection.evidenceAssetIds.join(", ") || "none"}`
      )
    ),
    "",
    "## Evidence Asset Index",
    ...linesOrNone(
      state.evidenceAssets.map((asset) => `- ${asset.assetId}: ${asset.kind}, ${asset.uri}, hash ${asset.hash}`)
    ),
    "",
    "## Spatial Asset Summary",
    `- Total: ${data.spatialSceneSummary.total}`,
    `- High-confidence assets: ${data.spatialSceneSummary.highConfidence}`,
    `- VPS/VSP pose fixes: ${data.spatialSceneSummary.vpsPoseFixes}`,
    `- Time-ranged assets: ${data.spatialSceneSummary.timeRangedAssets}`,
    `- Weak transforms: ${data.spatialSceneSummary.weakTransforms}`,
    ...linesOrNone(
      data.spatialAssets.map(
        (asset) =>
          `- ${asset.assetId}: ${asset.kind}, ${asset.status}, format ${asset.assetFormat ?? "metadata"}, confidence ${Math.round(asset.confidence * 100)}%, transform ${Math.round(asset.transformConfidence * 100)}%, frame ${asset.frameId}, source ${asset.sourceAdapter}${asset.droneId ? `, drone ${asset.droneId}` : ""}${asset.uri ? `, uri ${asset.uri}` : ""}`
      )
    ),
    "",
    "## Imported Sensor Stream Summary",
    ...linesOrNone(
      data.imports.map((item) => `- #${item.seq} ${item.kind} ${item.importId}: ${JSON.stringify(item.counts)}, rejected ${item.rejected}`)
    ),
    "",
    "## Incident Log Summary",
    `- ${data.incidentLog.summary}`,
    `- Timeline entries: ${data.incidentLog.timeline.length}`,
    `- Evidence assets: ${data.incidentLog.counts.evidenceAssets}`,
    `- Final state hash: ${data.incidentLog.hashChain.finalStateHash}`,
    "",
    "## Passive Read-Only Plan",
    `- Summary: ${data.passivePlan.summary}`,
    ...data.passivePlan.nextActions.map((action) => `- ${action.priority} ${action.category}: ${action.title} (${action.targetRef ?? "mission"})`),
    "",
    "## VPS/VSP Correction History",
    ...linesOrNone(
      state.spatialAssets
        .filter((asset) => asset.kind === "vps-pose")
        .map((asset) => `- ${asset.assetId}: drone ${asset.droneId ?? "unknown"}, confidence ${Math.round(asset.confidence * 100)}%, transform ${Math.round(asset.transformConfidence * 100)}%, frame ${asset.frameId}`)
    ),
    "",
    "## Command Lifecycle Summary",
    ...linesOrNone(
      state.commandLifecycles
        .slice()
        .reverse()
        .map((command) => `- ${command.commandId}: ${command.kind} -> ${command.status}`)
    ),
    "",
    "## AI Proposal Summary",
    ...linesOrNone(
      state.proposals.map(
        (proposal) =>
          `- ${proposal.id}: ${proposal.status}, ${proposal.provider}/${proposal.model}, ${proposal.plan.kind}, validator ${proposal.validator.ok ? "ok" : proposal.validator.blockers.join("; ")}`
      )
    ),
    "",
    "## Task Ledger Summary",
    ...linesOrNone(
      state.taskLedger
        .slice(0, 25)
        .map(
          (task) =>
            `- ${task.taskId}: zone ${task.zoneId}, drone ${task.droneId}, ${task.status}, ${task.reason}${task.reassignedFromTaskId ? `, from ${task.reassignedFromTaskId}` : ""}`
        )
    ),
    "",
    "## Replay Hash And Tamper Check",
    `- Final state hash: ${data.finalStateHash}`,
    `- Manifest hash: ${manifest?.finalStateHash ?? "not exported for this request"}`,
    `- Hash chain: ${tamperCheck.ok ? "ok" : "failed"}`,
    ...tamperCheck.errors.map((error) => `- Tamper error: ${error}`),
    "",
    "## Known Limitations And Safety Notes",
    ...data.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].join("\n");
}

function linesOrNone(lines: string[]) {
  return lines.length ? lines : ["- None"];
}

function majorEvents(events: MissionEvent[]) {
  return events.filter((event) =>
    [
      "mission.started",
      "scenario.loaded",
      "drone.action.applied",
      "detection.created",
      "detection.reviewed",
      "alert.created",
      "ai.proposal.created",
      "ai.proposal.approved",
      "ai.proposal.executed",
      "map.delta.ingested",
      "spatial.asset.ingested",
      "import.completed",
      "no_fly_zone.added"
    ].includes(event.type)
  );
}

function importEvents(events: MissionEvent[]): MissionReportData["imports"] {
  return events
    .filter((event) => event.type === "import.completed")
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      const summary = payload.summary as Record<string, unknown> | undefined;
      return {
        seq: event.seq,
        importId: String(payload.importId ?? summary?.importId ?? "unknown"),
        kind: String(payload.kind ?? summary?.kind ?? "unknown"),
        counts: (summary?.counts as Record<string, unknown> | undefined) ?? {},
        rejected: Array.isArray(summary?.rejected) ? summary.rejected.length : 0
      };
    });
}
