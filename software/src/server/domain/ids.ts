import crypto from "node:crypto";
import { EVENT_HASH_ALGORITHM } from "../../shared/constants";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function hashValue(value: unknown): string {
  return crypto.createHash(EVENT_HASH_ALGORITHM).update(stableStringify(value)).digest("hex");
}

export function eventId(seq: number) {
  return `evt-${seq.toString().padStart(8, "0")}`;
}

export function commandId(kind: string, seq: number) {
  return `cmd-${kind.replaceAll(".", "-")}-${seq.toString().padStart(6, "0")}`;
}

export function deterministicId(prefix: string, ...parts: Array<string | number | undefined>) {
  const source = parts.filter((part) => part !== undefined).join(":");
  return `${prefix}-${hashValue(source).slice(0, 12)}`;
}
