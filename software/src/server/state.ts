import { DEFAULT_MISSION_ID, SIM_EPOCH_MS } from "../shared/constants";
import type {
  Actor,
  CommandRequest,
  Detection,
  DetectionReview,
  DroneAction,
  EvidenceAsset,
  MapDelta,
  MissionEvent,
  MissionState,
  SpatialAsset,
  TelemetrySample,
  TrustMode
} from "../shared/types";
import { CommandRequestSchema, DetectionSchema, EvidenceAssetSchema, MapDeltaSchema, SpatialAssetSchema, TelemetrySampleSchema } from "../shared/schemas";
import { commandId } from "./domain/ids";
import { planCommandEvents, type CommandPlanResult } from "./domain/commandHandler";
import { makeInitialMissionState } from "./domain/selectors";
import { reduceMissionEvent } from "./domain/missionReducer";
import { validateMapDeltaForState } from "./domain/mapFusion";
import { validateSpatialAssetForState } from "./domain/spatialAssets";
import { AppendOnlyEventStore, type MissionEventDraft } from "./persistence/eventStore";
import { defaultScenario, getScenario, scenarios } from "./sim/scenarios";
import { DeterministicSimulator } from "./sim/simulator";

export interface MissionStoreOptions {
  missionId?: string;
  clock?: () => number;
  eventStore?: AppendOnlyEventStore;
}

export class MissionStore {
  readonly events: AppendOnlyEventStore;
  private state: MissionState;
  private scenario = defaultScenario;
  private readonly simulator = new DeterministicSimulator();
  private readonly clock: () => number;
  private readonly listeners: Array<(event: MissionEvent) => void> = [];

  constructor(options: MissionStoreOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.events = options.eventStore ?? new AppendOnlyEventStore();
    this.state = makeInitialMissionState(this.scenario, options.missionId ?? DEFAULT_MISSION_ID, this.clock());
  }

  snapshot(): MissionState {
    return this.state;
  }

  allEvents() {
    return this.events.all();
  }

  eventsSince(seq = 0) {
    return this.events.since(seq);
  }

  onEvent(listener: (event: MissionEvent) => void) {
    this.listeners.push(listener);
  }

  submitCommand(input: Partial<CommandRequest> & Pick<CommandRequest, "kind">): CommandPlanResult {
    const request = this.normalizeCommand(input);
    const result = planCommandEvents(this.state, request, scenarios, this.clock());
    this.appendDrafts(result.drafts);
    return result;
  }

  start() {
    this.submitCommand({ kind: "mission.start" });
  }

  pause() {
    this.submitCommand({ kind: "mission.pause" });
  }

  reset() {
    this.submitCommand({ kind: "mission.reset" });
  }

  loadScenario(id: string) {
    const result = this.submitCommand({ kind: "scenario.load", target: { scenarioId: id }, params: { scenarioId: id } });
    if (result.ok) {
      const scenario = getScenario(id);
      if (scenario) this.scenario = scenario;
    }
    return result.ok;
  }

  setTrustMode(mode: TrustMode) {
    this.submitCommand({ kind: "trust.set", params: { mode } });
  }

  assignDroneToZone(droneId: string, zoneId: string, requestedBy: Actor = "operator") {
    return this.submitCommand({
      kind: "zone.assign",
      target: { droneId, zoneId },
      params: { droneId, zoneId },
      requestedBy
    }).ok;
  }

  applyDroneAction(droneId: string, action: DroneAction) {
    return this.submitCommand({
      kind: "drone.action",
      target: { droneId },
      params: { droneId, action }
    }).ok;
  }

  reviewDetection(detectionId: string, review: DetectionReview) {
    return this.submitCommand({
      kind: "detection.review",
      target: { detectionId },
      params: { detectionId, review }
    }).ok;
  }

  acknowledgeAlert(alertId: string) {
    return this.submitCommand({
      kind: "alert.ack",
      target: { alertId },
      params: { alertId }
    }).ok;
  }

  addProposal(proposal: MissionState["proposals"][number]) {
    this.appendDraft({
      missionId: this.state.missionId,
      type: "ai.proposal.created",
      actor: "ai",
      createdAt: this.clock(),
      payload: { proposal, title: proposal.title }
    });
  }

  approveProposal(proposalId: string) {
    return this.submitCommand({
      kind: "ai.proposal.approve",
      target: { proposalId },
      params: { proposalId }
    }).ok;
  }

  tick(deltaSec: number) {
    if (this.state.phase !== "running") return;
    const payload = this.simulator.buildTick(this.state, this.scenario, deltaSec);
    this.appendDraft({
      missionId: this.state.missionId,
      type: "simulator.tick",
      actor: "simulator",
      createdAt: SIM_EPOCH_MS + Math.round(payload.elapsedSec * 1000),
      payload: payload as unknown as Record<string, unknown>
    });
  }

  ingestTelemetry(sampleInput: unknown) {
    const sample: TelemetrySample = TelemetrySampleSchema.parse(sampleInput);
    this.appendDraft({
      missionId: this.state.missionId,
      type: "telemetry.ingested",
      actor: "adapter",
      createdAt: sample.receivedAt,
      payload: { sample }
    });
  }

  ingestMapDelta(mapDeltaInput: unknown) {
    const mapDelta: MapDelta = MapDeltaSchema.parse(mapDeltaInput);
    const validation = validateMapDeltaForState(this.state, mapDelta, this.clock());
    if (!validation.ok) throw new Error(validation.blockers.join("; "));
    this.appendDraft({
      missionId: this.state.missionId,
      type: "map.delta.ingested",
      actor: "adapter",
      createdAt: mapDelta.createdAt,
      payload: { mapDelta }
    });
  }

  ingestDetection(detectionInput: unknown, evidenceAssetInput?: unknown) {
    const detection: Detection = DetectionSchema.parse(detectionInput);
    const evidenceAsset: EvidenceAsset | undefined = evidenceAssetInput ? EvidenceAssetSchema.parse(evidenceAssetInput) : undefined;
    this.appendDraft({
      missionId: this.state.missionId,
      type: "detection.created",
      actor: "adapter",
      createdAt: detection.createdAt,
      payload: { detection, evidenceAsset }
    });
  }

  ingestSpatialAsset(assetInput: unknown) {
    const asset: SpatialAsset = SpatialAssetSchema.parse(assetInput);
    const validation = validateSpatialAssetForState(this.state, asset, this.clock());
    if (!validation.ok) throw new Error(validation.blockers.join("; "));
    this.appendDraft({
      missionId: this.state.missionId,
      type: "spatial.asset.ingested",
      actor: "adapter",
      createdAt: asset.createdAt,
      payload: { asset, assetId: asset.assetId, validation }
    });
  }

  recordImportSummary(importId: string, kind: string, summary: Record<string, unknown>) {
    this.appendDraft({
      missionId: this.state.missionId,
      type: "import.completed",
      actor: "adapter",
      createdAt: this.clock(),
      payload: { importId, kind, summary }
    });
  }

  replay(events: MissionEvent[]) {
    this.events.clearForReplay([]);
    this.scenario = defaultScenario;
    this.state = makeInitialMissionState(this.scenario, this.state.missionId, this.clock());
    events.forEach((event) => {
      this.events.clearForReplay([...this.events.all(), event]);
      this.state = reduceMissionEvent(this.state, event);
    });
    return this.state;
  }

  buildReplayState(events: MissionEvent[], seq = Number.MAX_SAFE_INTEGER) {
    return rebuildStateFromEvents(events.filter((event) => event.seq <= seq), this.state.missionId, this.clock());
  }

  restoreFromEvents(events: MissionEvent[]) {
    const validation = this.events.validateHashChain(events);
    if (!validation.ok) return validation;
    this.events.clearForReplay(events);
    this.state = rebuildStateFromEvents(events, this.state.missionId, this.clock());
    this.scenario = getScenario(this.state.scenarioId) ?? defaultScenario;
    return validation;
  }

  validateHashChain(events = this.events.all()) {
    return this.events.validateHashChain(events);
  }

  private appendDrafts(drafts: MissionEventDraft[]) {
    drafts.forEach((draft) => this.appendDraft(draft));
  }

  private appendDraft(draft: MissionEventDraft) {
    const event = this.events.append(draft);
    this.state = reduceMissionEvent(this.state, event);
    if (event.type === "scenario.loaded" || event.type === "mission.reset") {
      const scenario = getScenario(this.state.scenarioId);
      if (scenario) this.scenario = scenario;
    }
    this.listeners.forEach((listener) => listener(event));
    return event;
  }

  private normalizeCommand(input: Partial<CommandRequest> & Pick<CommandRequest, "kind">): CommandRequest {
    const seq = this.events.nextCommandSequence();
    const now = this.clock();
    return CommandRequestSchema.parse({
      commandId: input.commandId ?? commandId(input.kind, seq),
      kind: input.kind,
      target: input.target ?? {},
      params: input.params ?? {},
      requestedBy: input.requestedBy ?? "operator",
      idempotencyKey: input.idempotencyKey ?? `${input.kind}-${seq}`,
      requestedAt: input.requestedAt ?? now
    });
  }
}

export { distance2d } from "./domain/selectors";

export function rebuildStateFromEvents(events: MissionEvent[], missionId = DEFAULT_MISSION_ID, createdAt = Date.now()) {
  let state = makeInitialMissionState(defaultScenario, missionId, createdAt);
  events.forEach((event) => {
    state = reduceMissionEvent(state, event);
  });
  return state;
}
