import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { MissionEvent } from "../../shared/types";
import { eventId, hashValue } from "../domain/ids";

type Actor = MissionEvent["actor"];

export interface MissionEventDraft {
  missionId: string;
  type: string;
  actor: Actor;
  createdAt: number;
  payload: Record<string, unknown>;
}

export class AppendOnlyEventStore {
  private events: MissionEvent[] = [];
  private listeners: Array<(event: MissionEvent) => void> = [];
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly eventsPath: string;

  constructor(private readonly root = process.env.SEEKR_DATA_DIR ?? path.join(process.cwd(), "data")) {
    this.eventsPath = path.join(root, "mission-events.ndjson");
  }

  async init() {
    await mkdir(this.root, { recursive: true });
  }

  append(draft: MissionEventDraft): MissionEvent {
    const seq = this.events.length + 1;
    const prevHash = this.events.at(-1)?.hash ?? "GENESIS";
    const base = {
      eventId: eventId(seq),
      missionId: draft.missionId,
      seq,
      type: draft.type,
      actor: draft.actor,
      createdAt: draft.createdAt,
      payload: draft.payload,
      prevHash
    };
    const event: MissionEvent = {
      ...base,
      hash: hashValue(base)
    };

    this.events.push(event);
    this.listeners.forEach((listener) => listener(event));
    return event;
  }

  async appendAndPersist(draft: MissionEventDraft) {
    const event = this.append(draft);
    await this.persistEvent(event);
    return event;
  }

  async persistEvent(event: MissionEvent) {
    const write = this.persistQueue
      .catch(() => undefined)
      .then(() => appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8"));
    this.persistQueue = write;
    await write;
  }

  async flush() {
    await this.persistQueue;
  }

  onEvent(listener: (event: MissionEvent) => void) {
    this.listeners.push(listener);
  }

  all() {
    return [...this.events];
  }

  since(seq = 0) {
    return this.events.filter((event) => event.seq > seq);
  }

  tail(limit = 50) {
    return this.events.slice(-limit);
  }

  clearForReplay(events: MissionEvent[] = []) {
    this.events = [...events];
  }

  nextCommandSequence() {
    return this.events.length + 1;
  }

  validateHashChain(events = this.events) {
    const errors: string[] = [];
    events.forEach((event, index) => {
      const prevHash = index === 0 ? "GENESIS" : events[index - 1]?.hash;
      if (event.prevHash !== prevHash) errors.push(`Event ${event.eventId} has invalid prevHash`);
      const { hash: _hash, ...base } = event;
      const expected = hashValue(base);
      if (event.hash !== expected) errors.push(`Event ${event.eventId} hash mismatch`);
    });
    return { ok: errors.length === 0, errors };
  }

  async readPersisted() {
    try {
      const body = await readFile(this.eventsPath, "utf8");
      return body
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as MissionEvent);
    } catch {
      return [];
    }
  }
}
