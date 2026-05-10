import type { CommandLifecycle, CommandRequest, DroneAction, MissionPlan, MissionState, ScenarioDefinition } from "../../shared/types";
import { validateMissionPlan, validateProposalApproval } from "./validators";
import type { MissionEventDraft } from "../persistence/eventStore";

export interface CommandPlanResult {
  ok: boolean;
  status: CommandLifecycle["status"];
  validation: CommandLifecycle["validation"];
  drafts: MissionEventDraft[];
  error?: string;
}

export function planCommandEvents(
  state: MissionState,
  request: CommandRequest,
  scenarios: ScenarioDefinition[],
  nowMs: number
): CommandPlanResult {
  const drafts: MissionEventDraft[] = [];
  const validation = validateCommand(state, request, scenarios, nowMs);
  const baseLifecycle: CommandLifecycle = {
    commandId: request.commandId,
    kind: request.kind,
    status: "requested",
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt ?? nowMs,
    updatedAt: nowMs,
    validation
  };

  drafts.push(lifecycleDraft(state.missionId, request.requestedBy, nowMs, baseLifecycle));

  if (!validation.ok) {
    const rejected: CommandLifecycle = {
      ...baseLifecycle,
      status: "rejected",
      updatedAt: nowMs,
      failureReason: validation.blockers.join("; ")
    };
    drafts.push(lifecycleDraft(state.missionId, request.requestedBy, nowMs, rejected));
    return { ok: false, status: "rejected", validation, drafts, error: rejected.failureReason };
  }

  const validated: CommandLifecycle = { ...baseLifecycle, status: "validated", updatedAt: nowMs };
  const approved: CommandLifecycle = { ...validated, status: "approved", approvedBy: request.requestedBy, updatedAt: nowMs };
  const dispatched: CommandLifecycle = { ...approved, status: "dispatched", dispatchedAt: nowMs, updatedAt: nowMs };
  drafts.push(lifecycleDraft(state.missionId, request.requestedBy, nowMs, validated));
  drafts.push(lifecycleDraft(state.missionId, request.requestedBy, nowMs, approved));
  drafts.push(lifecycleDraft(state.missionId, request.requestedBy, nowMs, dispatched));
  drafts.push(...domainDraftsForCommand(state, request, scenarios, nowMs));
  const accepted: CommandLifecycle = { ...dispatched, status: "accepted", acceptedAt: nowMs, updatedAt: nowMs };
  drafts.push(lifecycleDraft(state.missionId, request.requestedBy, nowMs, accepted));

  return {
    ok: true,
    status: "accepted",
    validation,
    drafts
  };
}

export function validateCommand(state: MissionState, request: CommandRequest, scenarios: ScenarioDefinition[], nowMs: number) {
  if (request.kind === "zone.assign") {
    return validateMissionPlan(state, {
      kind: "assign-zone",
      droneId: String(request.params.droneId ?? request.target.droneId ?? ""),
      zoneId: String(request.params.zoneId ?? request.target.zoneId ?? ""),
      reason: String(request.params.reason ?? "Operator zone assignment")
    });
  }

  if (request.kind === "drone.action") {
    const action = String(request.params.action);
    const droneId = String(request.target.droneId ?? request.params.droneId ?? "");
    if (action === "return-home") return validateMissionPlan(state, { kind: "return-drone", droneId, reason: "Return-home command" });
    if (action === "hold" || action === "resume") return validateMissionPlan(state, { kind: "hold-drone", droneId, reason: "Drone action command" });
    if (action === "simulate-link-loss" || action === "simulate-failure") return { ok: true, blockers: [], warnings: ["Simulator fault command"] };
    return { ok: false, blockers: [`Unsupported drone action ${action}`], warnings: [] };
  }

  if (request.kind === "trust.set") {
    const mode = String(request.params.mode);
    const ok = ["advisory", "semi-auto", "full-auto-training"].includes(mode);
    return ok ? { ok: true, blockers: [], warnings: [] } : { ok: false, blockers: [`Unsupported trust mode ${mode}`], warnings: [] };
  }

  if (request.kind === "scenario.load") {
    const scenarioId = String(request.params.scenarioId ?? request.target.scenarioId ?? "");
    const exists = scenarios.some((scenario) => scenario.id === scenarioId);
    const blockers = [];
    if (!exists) blockers.push(`Unknown scenario ${scenarioId}`);
    if (state.phase === "running") blockers.push("Cannot load scenario while mission is running");
    return { ok: blockers.length === 0, blockers, warnings: [] };
  }

  if (request.kind === "ai.proposal.approve") {
    const proposalId = String(request.target.proposalId ?? request.params.proposalId ?? "");
    const proposal = state.proposals.find((candidate) => candidate.id === proposalId);
    return validateProposalApproval(state, proposal, nowMs);
  }

  if (request.kind === "detection.review") {
    const detectionId = String(request.target.detectionId ?? request.params.detectionId ?? "");
    const exists = state.detections.some((detection) => detection.id === detectionId);
    return exists ? { ok: true, blockers: [], warnings: [] } : { ok: false, blockers: [`Unknown detection ${detectionId}`], warnings: [] };
  }

  if (request.kind === "alert.ack") {
    const alertId = String(request.target.alertId ?? request.params.alertId ?? "");
    const exists = state.alerts.some((alert) => alert.id === alertId);
    return exists ? { ok: true, blockers: [], warnings: [] } : { ok: false, blockers: [`Unknown alert ${alertId}`], warnings: [] };
  }

  if (request.kind === "no_fly_zone.add") {
    return validateMissionPlan(state, {
      kind: "set-no-fly-zone",
      bounds: rectFromValue(request.params.bounds ?? request.target.bounds),
      coords: vectorFromValue(request.params.coords ?? request.target.coords),
      radiusM: typeof request.params.radiusM === "number" ? request.params.radiusM : undefined,
      reason: String(request.params.reason ?? "Operator no-fly zone")
    });
  }

  return { ok: true, blockers: [], warnings: [] };
}

function domainDraftsForCommand(
  state: MissionState,
  request: CommandRequest,
  scenarios: ScenarioDefinition[],
  nowMs: number
): MissionEventDraft[] {
  const actor = request.requestedBy;
  const missionId = state.missionId;
  const drafts: MissionEventDraft[] = [];

  if (request.kind === "mission.start") {
    drafts.push(draft(missionId, "mission.started", actor, nowMs, { commandId: request.commandId }));
    defaultAssignments(state).forEach(([droneId, zoneId]) => {
      drafts.push(draft(missionId, "zone.assigned", "system", nowMs, { commandId: request.commandId, droneId, zoneId, reason: "Default launch assignment" }));
    });
  } else if (request.kind === "mission.pause") {
    drafts.push(draft(missionId, "mission.paused", actor, nowMs, { commandId: request.commandId }));
  } else if (request.kind === "mission.reset") {
    const scenario = scenarios.find((candidate) => candidate.id === state.scenarioId) ?? scenarios[0];
    drafts.push(draft(missionId, "mission.reset", actor, nowMs, { commandId: request.commandId, missionId, scenario }));
  } else if (request.kind === "trust.set") {
    drafts.push(draft(missionId, "trust.set", actor, nowMs, { commandId: request.commandId, mode: request.params.mode }));
  } else if (request.kind === "scenario.load") {
    const scenarioId = String(request.params.scenarioId ?? request.target.scenarioId);
    const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
    if (scenario) drafts.push(draft(missionId, "scenario.loaded", actor, nowMs, { commandId: request.commandId, missionId, scenarioId, scenario }));
  } else if (request.kind === "zone.assign") {
    drafts.push(
      draft(missionId, "zone.assigned", actor, nowMs, {
        commandId: request.commandId,
        droneId: request.params.droneId ?? request.target.droneId,
        zoneId: request.params.zoneId ?? request.target.zoneId,
        reason: request.params.reason ?? "Operator zone assignment"
      })
    );
  } else if (request.kind === "drone.action") {
    const droneId = String(request.target.droneId ?? request.params.droneId);
    const action = String(request.params.action) as DroneAction;
    drafts.push(
      draft(missionId, "drone.action.applied", actor, nowMs, {
        commandId: request.commandId,
        droneId,
        action,
        alert: alertForDroneAction(state, droneId, action, nowMs)
      })
    );
  } else if (request.kind === "detection.review") {
    drafts.push(
      draft(missionId, "detection.reviewed", actor, nowMs, {
        commandId: request.commandId,
        detectionId: request.target.detectionId ?? request.params.detectionId,
        review: request.params.review
      })
    );
  } else if (request.kind === "alert.ack") {
    drafts.push(draft(missionId, "alert.acknowledged", actor, nowMs, { commandId: request.commandId, alertId: request.target.alertId ?? request.params.alertId }));
  } else if (request.kind === "no_fly_zone.add") {
    const bounds = rectFromValue(request.params.bounds ?? request.target.bounds);
    if (bounds) drafts.push(draft(missionId, "no_fly_zone.added", actor, nowMs, { commandId: request.commandId, bounds, reason: request.params.reason ?? "Operator no-fly zone" }));
  } else if (request.kind === "ai.proposal.approve") {
    const proposalId = String(request.target.proposalId ?? request.params.proposalId);
    const proposal = state.proposals.find((candidate) => candidate.id === proposalId);
    if (proposal) {
      drafts.push(draft(missionId, "ai.proposal.approved", actor, nowMs, { commandId: request.commandId, proposalId }));
      drafts.push(...draftsForMissionPlan(state, proposal.plan, request.commandId, nowMs, "operator"));
      drafts.push(draft(missionId, "ai.proposal.executed", actor, nowMs, { commandId: request.commandId, proposalId }));
    }
  }

  return drafts;
}

function draftsForMissionPlan(state: MissionState, plan: MissionPlan, commandId: string, nowMs: number, actor: MissionEventDraft["actor"]) {
  if (plan.kind === "assign-zone" && plan.droneId && plan.zoneId) {
    return [
      draft(state.missionId, "zone.assigned", actor, nowMs, {
        commandId,
        droneId: plan.droneId,
        zoneId: plan.zoneId,
        reason: plan.reason
      })
    ];
  }

  if (plan.kind === "focused-search" && plan.droneId && plan.coords) {
    return [
      draft(state.missionId, "drone.focused_search.applied", actor, nowMs, {
        commandId,
        droneId: plan.droneId,
        coords: plan.coords,
        radiusM: plan.radiusM,
        reason: plan.reason
      })
    ];
  }

  if (plan.kind === "return-drone" && plan.droneId) {
    return [draft(state.missionId, "drone.action.applied", actor, nowMs, { commandId, droneId: plan.droneId, action: "return-home" })];
  }

  if (plan.kind === "hold-drone" && plan.droneId) {
    return [draft(state.missionId, "drone.action.applied", actor, nowMs, { commandId, droneId: plan.droneId, action: "hold" })];
  }

  if (plan.kind === "set-no-fly-zone") {
    const bounds = plan.bounds ?? boundsFromAnchor(plan.coords, plan.radiusM);
    if (bounds) {
      return [
        draft(state.missionId, "no_fly_zone.added", actor, nowMs, {
          commandId,
          bounds,
          reason: plan.reason
        })
      ];
    }
  }

  return [];
}

function lifecycleDraft(missionId: string, actor: CommandRequest["requestedBy"], createdAt: number, lifecycle: CommandLifecycle): MissionEventDraft {
  return draft(missionId, "command.lifecycle.updated", actor, createdAt, {
    commandId: lifecycle.commandId,
    status: lifecycle.status,
    lifecycle
  });
}

function draft(
  missionId: string,
  type: string,
  actor: MissionEventDraft["actor"],
  createdAt: number,
  payload: Record<string, unknown>
): MissionEventDraft {
  return { missionId, type, actor, createdAt, payload };
}

function defaultAssignments(state: MissionState) {
  const preferred = [
    ["drone-1", "zone-a"],
    ["drone-2", "zone-b"],
    ["drone-3", "zone-c"]
  ];
  return preferred.filter(([droneId, zoneId]) => state.drones.some((drone) => drone.id === droneId) && state.zones.some((zone) => zone.id === zoneId));
}

function alertForDroneAction(state: MissionState, droneId: string, action: DroneAction, createdAt: number) {
  const drone = state.drones.find((candidate) => candidate.id === droneId);
  if (action === "simulate-link-loss") {
    return {
      id: `alert-link-${droneId}-${createdAt}`,
      severity: "P2",
      title: "Link lost",
      message: `${drone?.name ?? droneId} lost GCS link`,
      droneId,
      acknowledged: false,
      createdAt
    };
  }
  if (action === "simulate-failure") {
    return {
      id: `alert-failed-${droneId}-${createdAt}`,
      severity: "P1",
      title: "Drone failed",
      message: `${drone?.name ?? droneId} stopped reporting`,
      droneId,
      acknowledged: false,
      createdAt
    };
  }
  return undefined;
}

function rectFromValue(value: unknown) {
  const candidate = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | undefined;
  if (!candidate || typeof candidate !== "object") return undefined;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function vectorFromValue(value: unknown) {
  const candidate = value as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  if (!candidate || typeof candidate !== "object") return undefined;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const z = Number(candidate.z ?? 0);
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return { x, y, z };
}

function boundsFromAnchor(coords: MissionPlan["coords"], radiusM: MissionPlan["radiusM"]) {
  if (!coords || !radiusM) return undefined;
  const size = Math.max(1, Math.round(radiusM));
  return {
    x: Math.max(0, Math.round(coords.x - size / 2)),
    y: Math.max(0, Math.round(coords.y - size / 2)),
    width: size,
    height: size
  };
}
