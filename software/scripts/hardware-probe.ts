import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildHardwareReadinessReport, parseHardwareTarget } from "../src/server/hardwareReadiness";
import { MissionPersistence } from "../src/server/persistence";
import { MissionStore } from "../src/server/state";
import type { HardwareTargetId } from "../src/shared/types";

const targetFlagIndex = process.argv.indexOf("--target");
const targetArg = process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1] ?? (targetFlagIndex >= 0 ? process.argv[targetFlagIndex + 1] : undefined);
const targets: HardwareTargetId[] = targetArg
  ? [parseHardwareTarget(targetArg)]
  : ["jetson-orin-nano", "raspberry-pi-5"];

const root = await mkdtemp(path.join(os.tmpdir(), "seekr-hardware-probe-"));
try {
  const persistence = new MissionPersistence(root);
  await persistence.init();
  const store = new MissionStore({ clock: () => 1_800_000_000_000, eventStore: persistence.events });
  const reports = await Promise.all(targets.map((target) => buildHardwareReadinessReport(target, store, persistence)));
  console.log(JSON.stringify({ ok: reports.every((report) => report.ok), reports }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
