import path from "node:path";
import type { AuditEvent, MissionEvent, MissionState } from "../shared/types";
import { AppendOnlyEventStore } from "./persistence/eventStore";
import { EvidenceStore } from "./persistence/evidenceStore";
import { ReplayStore } from "./persistence/replayStore";
import type { ReplayRunMetadata } from "./persistence/replayStore";
import { SnapshotStore } from "./persistence/snapshotStore";
import { loadLocalEnv } from "./env";

loadLocalEnv();

export class MissionPersistence {
  readonly root: string;
  readonly events: AppendOnlyEventStore;
  readonly snapshots: SnapshotStore;
  readonly evidence: EvidenceStore;
  readonly replays: ReplayStore;

  constructor(root = process.env.SEEKR_DATA_DIR) {
    this.root = root ?? path.join(process.cwd(), "data");
    this.events = new AppendOnlyEventStore(this.root);
    this.snapshots = new SnapshotStore(this.root);
    this.evidence = new EvidenceStore(this.root);
    this.replays = new ReplayStore(this.root);
  }

  async init() {
    await Promise.all([this.events.init(), this.snapshots.init(), this.evidence.init(), this.replays.init()]);
  }

  async appendEvent(event: AuditEvent | MissionEvent) {
    if ("hash" in event) return;
  }

  async writeSnapshot(state: MissionState) {
    await this.snapshots.writeSnapshot(state);
  }

  async exportBundle(state: MissionState, events: MissionEvent[], runMetadata?: ReplayRunMetadata) {
    await this.events.flush();
    const manifest = this.replays.exportManifest(state, events, runMetadata);
    await this.replays.persistManifest(manifest);
    return manifest;
  }
}
