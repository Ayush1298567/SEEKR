import { AI_PROPOSAL_TTL_MS } from "../../shared/constants";
import type { AiProposal, MissionPlan, MissionState } from "../../shared/types";
import { deterministicId } from "../domain/ids";
import { chooseReassignmentCandidate, isAssignableDrone, scoreDroneForZone } from "../domain/taskAllocator";
import { validateMissionPlan } from "../domain/validators";
import { chooseProposalWithLocalLlama, summarizeStateForAi } from "./llamaProvider";
import type { ProposalCandidate, ProposalDecision, ProposalDecisionProvider } from "./proposalTypes";

export function buildAiProposal(state: MissionState, nowMs = Date.now()): AiProposal {
  const candidates = buildProposalCandidates(state);
  return finalizeProposal(state, candidates[0], nowMs);
}

export async function buildAiProposalWithLocalAi(
  state: MissionState,
  nowMs = Date.now(),
  provider: ProposalDecisionProvider = chooseProposalWithLocalLlama
): Promise<AiProposal> {
  const candidates = buildProposalCandidates(state);
  const stateSummary = summarizeStateForAi(state);
  const providerDecision = await safeProviderDecision(provider, { stateSummary, candidates, nowMs });
  const decisionOutcome = sanitizeDecision(providerDecision.decision, candidates, state, providerDecision.fallbackReason);
  const selected = candidates[decisionOutcome.decision?.candidateIndex ?? 0];
  return finalizeProposal(state, selected, nowMs, decisionOutcome.decision, decisionOutcome.fallbackReason);
}

export function buildProposalCandidates(state: MissionState): ProposalCandidate[] {
  const candidates: ProposalCandidate[] = [];
  const reassignment = buildReassignmentPlan(state);
  if (reassignment) {
    candidates.push({
      plan: reassignment.plan,
      title: `Reassign ${reassignment.droneName} to ${reassignment.zoneName}`,
      rationale: "A zone lost its assigned drone and remains incomplete; the selected drone is the healthiest available option."
    });
  }

  const openP1Detection = state.detections.find((detection) => detection.severity === "P1" && detection.review === "new");
  const availableDrone = healthiestDrone(state);
  if (openP1Detection && availableDrone) {
    candidates.push({
      plan: {
        kind: "focused-search",
        droneId: availableDrone.id,
        coords: openP1Detection.position,
        radiusM: 18,
        reason: `P1 detection ${openP1Detection.id} needs close review`
      },
      title: `Inspect P1 detection with ${availableDrone.name}`,
      rationale: "A high-priority detection is still unreviewed and one drone has sufficient battery, link, and estimator quality."
    });
  }

  const spatialFocus = buildSpatialFocusedSearchPlan(state);
  if (spatialFocus) {
    candidates.push({
      plan: spatialFocus.plan,
      title: `Inspect ${spatialFocus.assetKind} with ${spatialFocus.droneName}`,
      rationale: "A high-confidence spatial asset sits in an incomplete area and can guide a local focused search."
    });
  }

  const conflictNoFlyPlan = buildConflictNoFlyPlan(state);
  if (conflictNoFlyPlan) {
    candidates.push({
      plan: conflictNoFlyPlan,
      title: "Quarantine map conflict area",
      rationale: "High-confidence map disagreement should be treated as a local planning hazard until an operator reviews the source conflict."
    });
  }

  const lowCoverageZone = [...state.zones]
    .filter((zone) => zone.status !== "complete")
    .sort((a, b) => a.coverage - b.coverage || severityRank(a.priority) - severityRank(b.priority))[0];
  const zoneDrone = lowCoverageZone ? bestDroneForZone(state, lowCoverageZone.id) : undefined;
  if (lowCoverageZone && zoneDrone) {
    candidates.push({
      plan: {
        kind: "assign-zone",
        droneId: zoneDrone.id,
        zoneId: lowCoverageZone.id,
        reason: `${lowCoverageZone.name} has only ${lowCoverageZone.coverage}% coverage`
      },
      title: `Assign ${zoneDrone.name} to ${lowCoverageZone.name}`,
      rationale: "The lowest-coverage active zone has remaining frontier cells and an available drone can search it."
    });
  }

  const drone = state.drones.find((candidate) => candidate.status !== "failed");
  candidates.push({
    plan: {
      kind: "hold-drone",
      droneId: drone?.id,
      reason: "No safe high-value action is available"
    },
    title: "Hold current plan",
    rationale: "No unreviewed P1 detections or under-covered zones are available with a healthy drone."
  });

  return candidates;
}

function finalizeProposal(state: MissionState, candidate: ProposalCandidate, nowMs: number, decision?: ProposalDecision, fallbackReason?: string): AiProposal {
  const plan = candidate.plan;
  const validator = validateMissionPlan(state, plan);
  const id = deterministicId("proposal", state.missionId, state.stateSeq, plan.kind, plan.droneId, plan.zoneId, nowMs);
  const provider = decision?.provider ?? "local-rule-engine";
  const model = decision?.model ?? "deterministic-v1";
  const candidateCount = buildProposalCandidates(state).length;

  return {
    id,
    title: decision?.title ?? candidate.title,
    rationale: decision?.rationale ?? candidate.rationale,
    risk: validator.ok ? "P2" : "P1",
    status: validator.ok ? "validated" : "rejected",
    createdAt: nowMs,
    provider,
    model,
    inputRefs: [`state:${state.stateSeq}`],
    commandIds: [],
    toolCalls: [
      {
        tool: "query_map",
        args: {},
        result: `coverage=${state.metrics.coveragePct}%; conflicts=${state.metrics.conflictCells}; stale=${state.metrics.staleSources}`,
        createdAt: nowMs
      },
      {
        tool: "query_spatial_assets",
        args: {},
        result: `assets=${state.spatialAssets.length}; vps=${state.spatialAssets.filter((asset) => asset.kind === "vps-pose").length}; highConfidence=${state.spatialAssets.filter((asset) => asset.confidence >= 0.8 && asset.transformConfidence >= 0.75).length}`,
        createdAt: nowMs
      },
      {
        tool: "validate_mission_plan",
        args: { plan },
        result: validator.ok ? "ok" : validator.blockers.join("; "),
        createdAt: nowMs
      },
      {
        tool: "choose_candidate_plan",
        args: { provider, model, candidateCount, fallbackReason: decision ? undefined : fallbackReason ?? "local-rule-engine" },
        result: decision ? `candidate=${decision.candidateIndex}` : `deterministic-fallback:${fallbackReason ?? "local-rule-engine"}`,
        createdAt: nowMs
      }
    ],
    plan,
    validator,
    diff: buildProposalDiff(state, plan, validator),
    staleAfterSeq: state.stateSeq + 20,
    expiresAt: nowMs + AI_PROPOSAL_TTL_MS
  };
}

async function safeProviderDecision(
  provider: ProposalDecisionProvider,
  input: Parameters<ProposalDecisionProvider>[0]
): Promise<{ decision?: ProposalDecision; fallbackReason?: string }> {
  try {
    const decision = await provider(input);
    return decision ? { decision } : { fallbackReason: "provider-unavailable-or-empty-output" };
  } catch {
    return { fallbackReason: "provider-threw-error" };
  }
}

function sanitizeDecision(
  decision: ProposalDecision | undefined,
  candidates: ProposalCandidate[],
  state: MissionState,
  fallbackReason?: string
): { decision?: ProposalDecision; fallbackReason?: string } {
  if (!decision) return { fallbackReason };
  if (!Number.isInteger(decision.candidateIndex)) return { fallbackReason: "invalid-candidate-index" };
  if (decision.candidateIndex < 0 || decision.candidateIndex >= candidates.length) return { fallbackReason: "candidate-index-out-of-range" };
  const selected = candidates[decision.candidateIndex];
  if (!validateMissionPlan(state, selected.plan).ok) return { fallbackReason: "selected-plan-failed-validator" };
  const actionableCandidateExists = candidates.some((candidate) => candidate.plan.kind !== "hold-drone" && validateMissionPlan(state, candidate.plan).ok);
  if (selected.plan.kind === "hold-drone" && actionableCandidateExists) return { fallbackReason: "hold-plan-rejected-while-actionable-candidate-exists" };
  return {
    decision: {
      ...decision,
      title: sanitizeModelText(decision.title, candidates[decision.candidateIndex]?.title ?? "SEEKR proposal", 96),
      rationale: sanitizeModelText(decision.rationale, candidates[decision.candidateIndex]?.rationale ?? "Validated candidate plan.", 320)
    }
  };
}

function sanitizeModelText(value: string | undefined, fallback: string, maxLength: number) {
  const text = String(value ?? fallback)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  const lower = text.toLowerCase();
  if (
    lower.includes("/api/commands") ||
    lower.includes("curl ") ||
    lower.includes("ignore operator") ||
    lower.includes("bypass validator") ||
    lower.includes("upload mission")
  ) {
    return fallback;
  }
  return text || fallback;
}

function buildReassignmentPlan(state: MissionState) {
  const candidate = chooseReassignmentCandidate(state);
  if (!candidate) return undefined;
  const incomplete = state.taskLedger.find((task) => task.taskId === candidate.incompleteTaskId);
  return {
    plan: {
      kind: "assign-zone",
      droneId: candidate.drone.id,
      zoneId: candidate.zone.id,
      reason: `${candidate.zone.name} became incomplete after ${incomplete?.reason ?? "task interruption"}`
    } satisfies MissionPlan,
    droneName: candidate.drone.name,
    zoneName: candidate.zone.name
  };
}

function buildConflictNoFlyPlan(state: MissionState): MissionPlan | undefined {
  const conflictCells = state.map.cells.filter((cell) => cell.conflict);
  if (!conflictCells.length) return undefined;

  const minX = Math.min(...conflictCells.map((cell) => cell.x));
  const minY = Math.min(...conflictCells.map((cell) => cell.y));
  const maxX = Math.max(...conflictCells.map((cell) => cell.x));
  const maxY = Math.max(...conflictCells.map((cell) => cell.y));
  const x = Math.max(0, minX - 1);
  const y = Math.max(0, minY - 1);
  const width = Math.min(state.map.width - x, maxX - minX + 3);
  const height = Math.min(state.map.height - y, maxY - minY + 3);
  const bounds = { x, y, width, height };

  if (state.noFlyZones.some((zone) => rectContains(zone, bounds))) return undefined;

  const plan: MissionPlan = {
    kind: "set-no-fly-zone",
    bounds,
    coords: { x: x + width / 2, y: y + height / 2, z: 0 },
    radiusM: Math.max(width, height),
    reason: "Temporary local no-fly zone around high-confidence map conflict"
  };

  return validateMissionPlan(state, plan).ok ? plan : undefined;
}

function buildSpatialFocusedSearchPlan(state: MissionState) {
  const asset = state.spatialAssets
    .filter((candidate) => candidate.kind !== "vps-pose" && candidate.status === "aligned" && candidate.confidence >= 0.78 && candidate.transformConfidence >= 0.72)
    .sort((a, b) => b.confidence + b.transformConfidence - (a.confidence + a.transformConfidence))[0];
  const drone = asset ? healthiestDrone(state) : undefined;
  if (!asset || !drone) return undefined;
  const plan: MissionPlan = {
    kind: "focused-search",
    droneId: drone.id,
    coords: asset.position,
    radiusM: Math.max(14, Math.min(28, Number(asset.bounds?.width ?? 8) + Number(asset.bounds?.height ?? 8))),
    reason: `High-confidence ${asset.kind} ${asset.assetId} needs spatial follow-up`
  };
  return validateMissionPlan(state, plan).ok
    ? { plan, droneName: drone.name, assetKind: asset.kind }
    : undefined;
}

function rectContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number }
) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function healthiestDrone(state: MissionState, excludeDroneId?: string) {
  return [...state.drones]
    .filter((drone) => drone.id !== excludeDroneId && isAssignableDrone(drone))
    .sort((a, b) => b.batteryPct + b.linkQuality + b.estimatorQuality - (a.batteryPct + a.linkQuality + a.estimatorQuality))[0];
}

function bestDroneForZone(state: MissionState, zoneId: string) {
  const zone = state.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) return undefined;
  return [...state.drones]
    .filter(isAssignableDrone)
    .sort((a, b) => scoreDroneForZone(b, zone) - scoreDroneForZone(a, zone) || a.id.localeCompare(b.id))[0];
}

function buildProposalDiff(state: MissionState, plan: MissionPlan, validator: AiProposal["validator"]): AiProposal["diff"] {
  if (plan.kind === "assign-zone") {
    const drone = state.drones.find((candidate) => candidate.id === plan.droneId);
    const zone = state.zones.find((candidate) => candidate.id === plan.zoneId);
    return [
      {
        field: "drone.assignedZoneId",
        affectedDroneId: plan.droneId,
        affectedZoneId: plan.zoneId,
        currentValue: drone?.assignedZoneId ?? "unassigned",
        proposedValue: plan.zoneId ?? "unassigned",
        blockers: validator.blockers,
        warnings: validator.warnings
      },
      {
        field: "zone.assignedDroneIds",
        affectedDroneId: plan.droneId,
        affectedZoneId: plan.zoneId,
        currentValue: zone?.assignedDroneIds ?? [],
        proposedValue: plan.droneId ? [...new Set([...(zone?.assignedDroneIds ?? []), plan.droneId])] : zone?.assignedDroneIds ?? [],
        blockers: validator.blockers,
        warnings: validator.warnings
      }
    ];
  }

  if (plan.kind === "focused-search") {
    const drone = state.drones.find((candidate) => candidate.id === plan.droneId);
    return [
      {
        field: "drone.target",
        affectedDroneId: plan.droneId,
        currentValue: drone?.target ?? "none",
        proposedValue: plan.coords ?? "none",
        blockers: validator.blockers,
        warnings: validator.warnings
      }
    ];
  }

  if ((plan.kind === "return-drone" || plan.kind === "hold-drone") && plan.droneId) {
    const drone = state.drones.find((candidate) => candidate.id === plan.droneId);
    return [
      {
        field: "drone.status",
        affectedDroneId: plan.droneId,
        currentValue: drone?.status ?? "unknown",
        proposedValue: plan.kind === "return-drone" ? "returning" : "holding",
        blockers: validator.blockers,
        warnings: validator.warnings
      }
    ];
  }

  if (plan.kind === "set-no-fly-zone") {
    return [
      {
        field: "mission.noFlyZones",
        currentValue: state.noFlyZones.length,
        proposedValue: plan.bounds ?? plan.coords ?? "none",
        blockers: validator.blockers,
        warnings: validator.warnings
      }
    ];
  }

  return [];
}

function severityRank(severity: "P1" | "P2" | "P3") {
  return severity === "P1" ? 0 : severity === "P2" ? 1 : 2;
}
