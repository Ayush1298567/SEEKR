import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEEKR_SCHEMA_VERSION, SEEKR_SOFTWARE_VERSION } from "../src/shared/constants";
import type { ReplayManifest } from "../src/shared/types";
import { hashValue } from "../src/server/domain/ids";
import { MissionStore } from "../src/server/state";

const FIXED_CLOCK = 1_800_000_000_000;
const GOLDEN_ROOT = path.join(process.cwd(), "fixtures", "golden");
const SCENARIOS = ["rubble-training", "wilderness-ravine"];
const TICKS = 130;

await mkdir(GOLDEN_ROOT, { recursive: true });

for (const scenarioId of SCENARIOS) {
  const store = new MissionStore({ clock: () => FIXED_CLOCK });
  if (scenarioId !== "rubble-training") store.loadScenario(scenarioId);
  store.start();
  for (let index = 0; index < TICKS; index += 1) store.tick(1);

  const events = store.allEvents();
  const state = store.snapshot();
  const finalStateHash = hashValue(state);
  const selectedSeqs = [1, Math.floor(events.length / 2), events.length].filter((seq, index, values) => seq > 0 && values.indexOf(seq) === index);
  const replayManifest: ReplayManifest = {
    replayId: `golden-${scenarioId}-${events.length}`,
    missionId: state.missionId,
    scenarioId: state.scenarioId,
    exportedAt: FIXED_CLOCK,
    schemaVersion: SEEKR_SCHEMA_VERSION,
    softwareVersion: SEEKR_SOFTWARE_VERSION,
    eventCount: events.length,
    eventLog: events,
    snapshots: [state],
    evidenceIndex: state.evidenceAssets,
    adapterMetadata: {
      source: state.source,
      scenarioId: state.scenarioId,
      simulator: state.simulator
    },
    finalStateHash
  };

  const fixture = {
    scenarioId,
    ticks: TICKS,
    seed: state.simulator.seed,
    eventLog: events,
    finalStateHash,
    replayManifest,
    selectedStateSnapshots: selectedSeqs.map((seq) => {
      const snapshot = store.buildReplayState(events, seq);
      return {
        seq,
        hash: hashValue(snapshot),
        phase: snapshot.phase,
        coveragePct: snapshot.metrics.coveragePct,
        detections: snapshot.detections.length,
        taskLedger: snapshot.taskLedger.slice(0, 5)
      };
    })
  };

  await writeFile(path.join(GOLDEN_ROOT, `${scenarioId}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(`updated fixtures/golden/${scenarioId}.json`);
}
