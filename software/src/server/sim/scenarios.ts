import type { AlertSeverity, ScenarioDefinition } from "../../shared/types";
import { DEFAULT_SCENARIO_SEED } from "../../shared/constants";

export interface ScenarioRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScenarioZone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: AlertSeverity;
}

export interface ScenarioDrone {
  id: string;
  name: string;
  x: number;
  y: number;
  batteryPct?: number;
}

export interface ScenarioDetectionSeed {
  x: number;
  y: number;
  kind: "person" | "thermal-hotspot" | "motion-anomaly";
  confidence: number;
}

export const scenarios: ScenarioDefinition[] = [
  {
    id: "rubble-training",
    name: "Rubble Training Site",
    description: "Compact indoor/outdoor collapsed-structure training area with blocked corridors.",
    seed: DEFAULT_SCENARIO_SEED,
    width: 42,
    height: 28,
    initialKnown: [{ x: 0, y: 10, width: 4, height: 7 }],
    obstacles: [
      { x: 12, y: 5, width: 1, height: 18 },
      { x: 27, y: 3, width: 1, height: 14 },
      { x: 19, y: 19, width: 16, height: 1 },
      { x: 21, y: 11, width: 4, height: 2 }
    ],
    zones: [
      { id: "zone-a", name: "North Sector", x: 5, y: 2, width: 13, height: 10, priority: "P2" },
      { id: "zone-b", name: "Central Rubble", x: 16, y: 7, width: 13, height: 10, priority: "P1" },
      { id: "zone-c", name: "South Wing", x: 6, y: 17, width: 16, height: 8, priority: "P2" },
      { id: "zone-d", name: "East Annex", x: 30, y: 4, width: 9, height: 17, priority: "P3" }
    ],
    drones: [
      { id: "drone-1", name: "SEEKR 1", x: 2, y: 13 },
      { id: "drone-2", name: "SEEKR 2", x: 2, y: 15 },
      { id: "drone-3", name: "SEEKR 3", x: 2, y: 11 }
    ],
    detectionSeeds: [
      { x: 23, y: 10, kind: "person", confidence: 88 },
      { x: 9, y: 21, kind: "thermal-hotspot", confidence: 74 }
    ],
    scriptedFaults: [
      { id: "fault-link-drone-2", atElapsedSec: 45, kind: "link-loss", droneId: "drone-2", params: { policy: "hold" } },
      { id: "fault-estimator-drone-3", atElapsedSec: 70, kind: "estimator-degradation", droneId: "drone-3", params: { quality: 48 } },
      { id: "fault-false-positive", atElapsedSec: 95, kind: "false-positive-detection", droneId: "drone-1", params: { x: 8, y: 8 } },
      { id: "fault-stale-source", atElapsedSec: 110, kind: "stale-map-source", droneId: "drone-3", params: {} }
    ],
    expectedOutcomes: [
      "coverage-increases",
      "link-loss-creates-alert",
      "estimator-degradation-blocks-risky-command",
      "false-positive-is-reviewable",
      "stale-map-source-visible"
    ]
  },
  {
    id: "wilderness-ravine",
    name: "Wilderness Ravine",
    description: "Larger outdoor search area with natural barriers and lower initial map coverage.",
    seed: 9001,
    width: 54,
    height: 34,
    initialKnown: [{ x: 0, y: 14, width: 5, height: 7 }],
    obstacles: [
      { x: 18, y: 0, width: 2, height: 26 },
      { x: 34, y: 9, width: 3, height: 25 },
      { x: 11, y: 25, width: 21, height: 2 },
      { x: 42, y: 5, width: 2, height: 11 }
    ],
    zones: [
      { id: "zone-a", name: "Trailhead", x: 5, y: 5, width: 13, height: 11, priority: "P2" },
      { id: "zone-b", name: "Ravine West", x: 20, y: 2, width: 14, height: 16, priority: "P1" },
      { id: "zone-c", name: "Ravine South", x: 7, y: 20, width: 18, height: 10, priority: "P2" },
      { id: "zone-d", name: "Ridge East", x: 38, y: 8, width: 12, height: 18, priority: "P2" }
    ],
    drones: [
      { id: "drone-1", name: "SEEKR 1", x: 2, y: 16 },
      { id: "drone-2", name: "SEEKR 2", x: 2, y: 18 },
      { id: "drone-3", name: "SEEKR 3", x: 2, y: 14, batteryPct: 88 }
    ],
    detectionSeeds: [{ x: 31, y: 14, kind: "motion-anomaly", confidence: 79 }],
    scriptedFaults: [
      { id: "fault-low-battery-drone-3", atElapsedSec: 55, kind: "low-battery", droneId: "drone-3", params: { batteryPct: 21 } },
      { id: "fault-dropout-drone-1", atElapsedSec: 25, kind: "drone-dropout", droneId: "drone-1", params: {} },
      { id: "fault-duplicate-detection", atElapsedSec: 125, kind: "duplicate-detection", droneId: "drone-2", params: { x: 31, y: 14 } }
    ],
    expectedOutcomes: [
      "low-battery-triggers-return",
      "dropout-marks-zone-incomplete",
      "duplicate-detection-does-not-overwrite-original"
    ]
  }
];

export const defaultScenario = scenarios[0];

export function getScenario(id: string) {
  return scenarios.find((scenario) => scenario.id === id);
}
