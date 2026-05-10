import type { Alert, Drone, ScenarioFault, Vec3 } from "../../shared/types";

export function faultApplies(fault: ScenarioFault, previousElapsedSec: number, nextElapsedSec: number, appliedFaultIds: string[]) {
  return !appliedFaultIds.includes(fault.id) && fault.atElapsedSec > previousElapsedSec && fault.atElapsedSec <= nextElapsedSec;
}

export function alertForFault(fault: ScenarioFault, drone: Drone | undefined, createdAt: number): Alert {
  if (fault.kind === "link-loss") {
    return makeAlert(fault, "P2", "Link lost", `${drone?.name ?? fault.droneId} lost GCS link`, createdAt);
  }
  if (fault.kind === "estimator-degradation") {
    return makeAlert(fault, "P2", "Estimator degraded", `${drone?.name ?? fault.droneId} localization quality degraded`, createdAt);
  }
  if (fault.kind === "low-battery") {
    return makeAlert(fault, "P2", "Battery reserve", `${drone?.name ?? fault.droneId} returning on reserve`, createdAt);
  }
  if (fault.kind === "drone-dropout") {
    return makeAlert(fault, "P1", "Drone failed", `${drone?.name ?? fault.droneId} stopped reporting`, createdAt);
  }
  if (fault.kind === "false-positive-detection") {
    return makeAlert(fault, "P2", "Possible false positive", `${drone?.name ?? fault.droneId} produced a low-confidence detection`, createdAt);
  }
  if (fault.kind === "duplicate-detection") {
    return makeAlert(fault, "P3", "Duplicate detection", `${drone?.name ?? fault.droneId} reported a repeated detection`, createdAt);
  }
  return makeAlert(fault, "P3", "Stale map source", `${drone?.name ?? fault.droneId} map updates are stale`, createdAt);
}

export function faultPoint(fault: ScenarioFault, fallback: Vec3): Vec3 {
  const x = Number(fault.params.x ?? fallback.x);
  const y = Number(fault.params.y ?? fallback.y);
  const z = Number(fault.params.z ?? fallback.z);
  return { x, y, z };
}

function makeAlert(fault: ScenarioFault, severity: Alert["severity"], title: string, message: string, createdAt: number): Alert {
  return {
    id: `alert-${fault.id}`,
    severity,
    title,
    message,
    droneId: fault.droneId,
    acknowledged: false,
    createdAt
  };
}
