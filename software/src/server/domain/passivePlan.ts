import type { MissionEvent, MissionState, PassivePlan, PassivePlanStep, SpatialAsset } from "../../shared/types";
import { deterministicId } from "./ids";

export function buildPassivePlan(state: MissionState, events: MissionEvent[] = [], generatedAt = Date.now()): PassivePlan {
  const watchItems = buildWatchItems(state);
  const nextActions = buildNextActions(state, events);
  const planId = deterministicId("passive-plan", state.missionId, state.stateSeq, generatedAt, watchItems.length, nextActions.length);

  return {
    planId,
    missionId: state.missionId,
    stateSeq: state.stateSeq,
    generatedAt,
    mode: "passive-read-only",
    summary: `Passive read-only plan for ${state.scenarioName}: ${state.metrics.coveragePct}% coverage, ${state.metrics.p1Open} open P1 alerts, ${state.spatialAssets.length} spatial assets, ${state.drones.filter((drone) => drone.status === "offline" || drone.status === "failed").length} degraded drones.`,
    objectives: [
      "Maintain operator awareness without issuing aircraft commands.",
      "Prioritize evidence review, spatial inspection, replay readiness, and hash-chain verification.",
      "Use AI and spatial tools only as advisory read paths unless the operator explicitly approves a separate command proposal."
    ],
    constraints: [
      "No real MAVLink, ROS 2, or aircraft command upload.",
      "No automatic zone reassignment, no automatic no-fly upload, and no autonomous dispatch.",
      "Spatial assets and VPS/VSP pose fixes affect only the local read model."
    ],
    watchItems,
    nextActions,
    safetyNotes: [
      "This plan is passive and does not create command lifecycle events.",
      "Any active mission change must go through the existing validator-backed command/proposal path.",
      "Evidence and spatial blobs remain URI-backed references; reports should include hashes/metadata, not embedded binaries."
    ]
  };
}

function buildWatchItems(state: MissionState): PassivePlanStep[] {
  const items: PassivePlanStep[] = [];

  state.alerts
    .filter((alert) => !alert.acknowledged)
    .slice(0, 4)
    .forEach((alert) => items.push(step("monitor", alert.severity, `Monitor alert ${alert.title}`, alert.message, `alert:${alert.id}`, "active")));

  state.detections
    .filter((detection) => detection.review === "new")
    .slice(0, 4)
    .forEach((detection) => items.push(step("review", detection.severity, `Review ${detection.kind} detection`, `Detection ${detection.id} is unreviewed at ${Math.round(detection.confidence)}% confidence.`, `detection:${detection.id}`)));

  state.spatialAssets
    .filter((asset) => asset.transformConfidence < 0.65 || asset.confidence < 0.7)
    .slice(0, 4)
    .forEach((asset) => items.push(step("inspect", "P2", `Inspect weak spatial transform`, `${asset.assetId} has confidence ${pct(asset.confidence)} and transform ${pct(asset.transformConfidence)}.`, `spatial:${asset.assetId}`)));

  state.drones
    .filter((drone) => drone.status === "offline" || drone.status === "failed" || drone.linkQuality < 45 || drone.estimatorQuality < 70)
    .slice(0, 4)
    .forEach((drone) => items.push(step("monitor", drone.status === "offline" || drone.status === "failed" ? "P1" : "P2", `Monitor ${drone.name}`, `${drone.status}, link ${Math.round(drone.linkQuality)}%, estimator ${Math.round(drone.estimatorQuality)}%.`, `drone:${drone.id}`, "active")));

  if (state.metrics.conflictCells > 0) {
    items.push(step("monitor", "P2", "Monitor map conflicts", `${state.metrics.conflictCells} conflict cells require operator review before active planning.`, "map:conflicts", "active"));
  }

  if (state.metrics.staleSources > 0) {
    items.push(step("monitor", "P2", "Monitor stale map sources", `${state.metrics.staleSources} stale source groups need replay/import refresh.`, "map:stale", "active"));
  }

  return items.slice(0, 12);
}

function buildNextActions(state: MissionState, events: MissionEvent[]): PassivePlanStep[] {
  const actions: PassivePlanStep[] = [];
  const topSpatial = rankSpatialAssets(state)[0];
  const newDetection = state.detections.find((detection) => detection.review === "new");
  const lowCoverage = [...state.zones].filter((zone) => zone.status !== "complete").sort((a, b) => a.coverage - b.coverage)[0];

  if (newDetection) {
    actions.push(step("review", newDetection.severity, "Review highest-priority detection", `Open evidence for ${newDetection.id}, confirm or mark false-positive, and keep raw evidence immutable.`, `detection:${newDetection.id}`));
  }

  if (topSpatial) {
    actions.push(step("inspect", "P2", "Inspect best spatial asset in 3D", `Open ${topSpatial.assetId} (${topSpatial.kind}) in the spatial viewer and compare it with detections/zones.`, `spatial:${topSpatial.assetId}`));
  } else {
    actions.push(step("import", "P3", "Import passive spatial context", "Use the spatial manifest or bag-lite importer to add read-only scene context before active planning.", "import:spatial-manifest"));
  }

  if (lowCoverage) {
    actions.push(step("monitor", lowCoverage.priority, "Track lowest-coverage zone", `${lowCoverage.name} is at ${lowCoverage.coverage}% coverage; observe before drafting any reassignment.`, `zone:${lowCoverage.id}`));
  }

  actions.push(step("export", "P3", "Export passive evidence package", "Export mission bundle so replay, reports, spatial assets, and hash-chain status are captured.", `mission:${state.missionId}`));
  actions.push(step("verify", "P3", "Verify hash chain", `Verify ${events.length} mission events before using reports as evidence.`, `mission:${state.missionId}`));

  if (events.some((event) => event.type === "import.completed")) {
    actions.push(step("replay", "P3", "Replay imported context", "Start replay and seek across imported spatial/sensor events to confirm reducer-stable state.", "replay:latest"));
  }

  return actions.slice(0, 8);
}

function rankSpatialAssets(state: MissionState): SpatialAsset[] {
  return [...state.spatialAssets].sort(
    (a, b) =>
      b.confidence + b.transformConfidence + linkedScore(state, b) -
      (a.confidence + a.transformConfidence + linkedScore(state, a)) ||
      a.assetId.localeCompare(b.assetId)
  );
}

function linkedScore(state: MissionState, asset: SpatialAsset) {
  return Math.min(0.3, asset.linkedDetectionIds.length * 0.08 + state.detections.filter((detection) => distance(asset.position, detection.position) <= 10).length * 0.04);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function step(
  category: PassivePlanStep["category"],
  priority: PassivePlanStep["priority"],
  title: string,
  rationale: string,
  targetRef?: string,
  status: PassivePlanStep["status"] = "pending"
): PassivePlanStep {
  return {
    id: deterministicId("passive-step", category, priority, title, targetRef ?? "none").slice(0, 24),
    priority,
    category,
    title,
    rationale,
    targetRef,
    status
  };
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}
