import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MissionState } from "../../shared/types";

export class SnapshotStore {
  private readonly snapshotPath: string;

  constructor(private readonly root = process.env.SEEKR_DATA_DIR ?? path.join(process.cwd(), "data")) {
    this.snapshotPath = path.join(root, "latest-state.json");
  }

  async init() {
    await mkdir(this.root, { recursive: true });
  }

  async writeSnapshot(state: MissionState) {
    await writeFile(this.snapshotPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async readSnapshot() {
    try {
      return JSON.parse(await readFile(this.snapshotPath, "utf8")) as MissionState;
    } catch {
      return undefined;
    }
  }
}
