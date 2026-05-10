import { AI_PROPOSAL_TTL_MS } from "../../shared/constants";
import type { AiProposal, MissionPlan, MissionState, ValidationResult, Vec3 } from "../../shared/types";
import { distance2d, inRect, isInsideMap } from "./selectors";

export function validateMissionPlan(state: MissionState, plan: MissionPlan): ValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const drone = plan.droneId ? state.drones.find((candidate) => candidate.id === plan.droneId) : undefined;

  if (plan.droneId && !drone) {
    blockers.push(`Unknown drone ${plan.droneId}`);
  }

  if (drone) {
    if (drone.status === "failed") blockers.push(`${drone.name} is failed`);
    if (drone.status === "offline") blockers.push(`${drone.name} is offline`);
    if (drone.batteryPct <= drone.dynamicReservePct + 5) {
      blockers.push(`${drone.name} is too close to dynamic battery reserve`);
    } else if (drone.batteryPct <= drone.dynamicReservePct + 12) {
      warnings.push(`${drone.name} has limited battery margin`);
    }
    if (drone.estimatorQuality < 62) {
      blockers.push(`${drone.name} localization confidence is below threshold`);
    }
    if (drone.linkQuality < 25) {
      blockers.push(`${drone.name} link is below command threshold`);
    } else if (drone.linkQuality < 45) {
      warnings.push(`${drone.name} link is degraded`);
    }
  }

  if (plan.kind === "assign-zone") {
    if (!plan.droneId) blockers.push("Missing drone id");
    if (!plan.zoneId) blockers.push("Missing zone id");
    const zone = state.zones.find((candidate) => candidate.id === plan.zoneId);
    if (!zone) blockers.push(`Unknown zone ${plan.zoneId}`);
    if (zone?.status === "complete") warnings.push(`${zone.name} is already nearly complete`);
    if (zone) {
      const blockedCells = state.map.cells.filter((cell) => inRect(cell, zone.bounds) && cell.occupied).length;
      if (blockedCells > zone.bounds.width * zone.bounds.height * 0.75) blockers.push(`${zone.name} is mostly blocked`);
    }
  }

  if (plan.kind === "focused-search") {
    if (!plan.droneId) blockers.push("Missing drone id");
    if (!plan.coords) {
      blockers.push("Missing focused-search coordinates");
    } else {
      validatePoint(state, plan.coords, blockers, warnings);
    }
    if ((plan.radiusM ?? 0) > 50) warnings.push("Focused-search radius is broad for a single drone");
    const nearbyDrones = state.drones.filter(
      (candidate) =>
        plan.coords &&
        candidate.status !== "failed" &&
        candidate.status !== "offline" &&
        distance2d(candidate.position, plan.coords) <= 4
    );
    if (nearbyDrones.length >= 3) blockers.push("Too many drones already near requested focus point");
  }

  if (plan.kind === "return-drone" && !plan.droneId) {
    blockers.push("Missing drone id for return command");
  }

  if (plan.kind === "hold-drone" && !plan.droneId) {
    blockers.push("Missing drone id for hold command");
  }

  if (plan.kind === "set-no-fly-zone") {
    if (!plan.bounds && !plan.coords) {
      blockers.push("Missing no-fly zone anchor");
    }
    if (plan.bounds) {
      if (plan.bounds.x < 0 || plan.bounds.y < 0) blockers.push("No-fly zone starts outside mission map bounds");
      if (plan.bounds.x + plan.bounds.width > state.map.width || plan.bounds.y + plan.bounds.height > state.map.height) {
        blockers.push("No-fly zone extends outside mission map bounds");
      }
      const overlapsHome = state.drones.some((candidate) => inRect(candidate.home, plan.bounds!));
      if (overlapsHome) blockers.push("No-fly zone overlaps a drone home position");
    } else if (plan.coords) {
      validatePoint(state, plan.coords, blockers, warnings);
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings
  };
}

export function validateProposalApproval(state: MissionState, proposal: AiProposal | undefined, nowMs: number): ValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!proposal) {
    blockers.push("Proposal not found");
    return { ok: false, blockers, warnings };
  }

  if (!proposal.validator.ok) blockers.push("Rejected proposal cannot be approved");
  if (proposal.status === "executed") blockers.push("Proposal already executed");
  if (proposal.status === "rejected") blockers.push("Rejected proposal cannot be approved");
  const logicalNow = Math.abs(nowMs - state.updatedAt) > AI_PROPOSAL_TTL_MS * 10 ? state.updatedAt : nowMs;
  if (logicalNow - proposal.createdAt > AI_PROPOSAL_TTL_MS) blockers.push("Proposal is stale and must be regenerated");
  if (proposal.expiresAt && logicalNow > proposal.expiresAt) blockers.push("Proposal TTL expired");
  if (proposal.staleAfterSeq && state.stateSeq > proposal.staleAfterSeq) blockers.push("Mission state has advanced beyond proposal stale-after sequence");

  const planValidation = validateMissionPlan(state, proposal.plan);
  blockers.push(...planValidation.blockers);
  warnings.push(...planValidation.warnings);

  return {
    ok: blockers.length === 0,
    blockers,
    warnings
  };
}

function validatePoint(state: MissionState, point: Vec3, blockers: string[], warnings: string[]) {
  if (!isInsideMap(point, state)) {
    blockers.push("Focused-search target is outside mission map bounds");
    return;
  }

  if (state.noFlyZones.some((zone) => inRect(point, zone))) {
    blockers.push("Focused-search target is inside a no-fly zone");
  }

  const cell = state.map.cells.find((candidate) => Math.round(point.x) === candidate.x && Math.round(point.y) === candidate.y);
  if (cell?.occupied) blockers.push("Focused-search target is inside an occupied cell");
  if (cell?.conflict) warnings.push("Focused-search target is in a map conflict area");
}
