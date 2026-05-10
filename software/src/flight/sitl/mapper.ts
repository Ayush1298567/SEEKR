import type { FlightMode } from "../types";
import type { SitlAutopilot, SitlTelemetryFrame } from "./types";

export function mapSitlMode(autopilot: SitlAutopilot, mode: string, armed: boolean): FlightMode {
  const normalized = mode.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!armed && ["DISARMED", "STANDBY", "MANUAL", "POSCTL", "ALTCTL", "STABILIZE"].includes(normalized)) return "disarmed";
  if (normalized.includes("TAKEOFF")) return "takeoff";
  if (normalized.includes("MISSION") || normalized.includes("AUTO_MISSION") || normalized === "AUTO") return "mission";
  if (normalized.includes("HOLD") || normalized.includes("LOITER")) return "hold";
  if (normalized.includes("RTL") || normalized.includes("RETURN")) return "return-home";
  if (normalized.includes("LAND")) return "landing";
  if (normalized.includes("FAILSAFE")) return "failsafe";
  if (armed) return "armed";
  return autopilot === "px4" ? "disarmed" : "disarmed";
}

export function externalCommandName(autopilot: SitlAutopilot, kind: string) {
  const px4: Record<string, string> = {
    arm: "MAV_CMD_COMPONENT_ARM_DISARM",
    disarm: "MAV_CMD_COMPONENT_ARM_DISARM",
    takeoff: "MAV_CMD_NAV_TAKEOFF",
    waypoint: "MAV_CMD_NAV_WAYPOINT",
    hold: "MAV_CMD_NAV_LOITER_UNLIM",
    "return-home": "MAV_CMD_NAV_RETURN_TO_LAUNCH",
    land: "MAV_CMD_NAV_LAND",
    terminate: "MAV_CMD_DO_FLIGHTTERMINATION"
  };
  const ardupilot: Record<string, string> = {
    arm: "MAV_CMD_COMPONENT_ARM_DISARM",
    disarm: "MAV_CMD_COMPONENT_ARM_DISARM",
    takeoff: "MAV_CMD_NAV_TAKEOFF",
    waypoint: "MISSION_ITEM_INT",
    hold: "MAV_CMD_NAV_LOITER_UNLIM",
    "return-home": "MAV_CMD_NAV_RETURN_TO_LAUNCH",
    land: "MAV_CMD_NAV_LAND",
    terminate: "MAV_CMD_DO_FLIGHTTERMINATION"
  };
  return (autopilot === "px4" ? px4 : ardupilot)[kind] ?? "UNKNOWN_SITL_COMMAND";
}

export function validSitlTelemetry(frame: SitlTelemetryFrame) {
  return Number.isFinite(frame.receivedAtMs) &&
    Number.isFinite(frame.position.x) &&
    Number.isFinite(frame.position.y) &&
    Number.isFinite(frame.position.z) &&
    Number.isFinite(frame.batteryPct) &&
    Number.isFinite(frame.linkQuality) &&
    Number.isFinite(frame.estimatorQuality);
}
