import { createReadStream } from "node:fs";
import { pathToFileURL } from "node:url";
import { runMavlinkReadOnlyBridge } from "../src/server/bridges/readOnlyBridge";
import type { BridgeRejectedRecord } from "../src/server/bridges/readOnlyBridge";
import { writeBridgeEvidenceArtifact } from "./bridge-evidence";

export interface SerialMavlinkBridgeOptions {
  baseUrl?: string;
  devicePath: string;
  dryRun?: boolean;
  commandPreview?: boolean;
  durationMs?: number;
  maxBytes?: number;
  internalToken?: string;
  receivedAt?: number;
  evidenceLabel?: string;
  outDir?: string;
  generatedAt?: string;
  root?: string;
}

export interface SerialMavlinkBridgeResult {
  ok: boolean;
  mode: "mavlink-serial-readonly";
  dryRun: boolean;
  commandPreview: boolean;
  devicePath: string;
  durationMs: number;
  maxBytes: number;
  inputBytes: number;
  inputCount: number;
  acceptedCount: number;
  postedCount: number;
  rejected: BridgeRejectedRecord[];
  errors: string[];
  commandEndpointsTouched: false;
  safety: {
    serialWriteOpened: false;
    commandUploadEnabled: false;
  };
}

const DEFAULT_DURATION_MS = 30_000;
const DEFAULT_MAX_BYTES = 1_000_000;

export function parseSerialMavlinkBridgeArgs(values: string[]): SerialMavlinkBridgeOptions {
  const parsed: Partial<SerialMavlinkBridgeOptions> = {};

  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? (values[index + 1]?.startsWith("--") ? undefined : values[++index]);

    if ((key === "device" || key === "serial-device") && value) parsed.devicePath = value;
    else if (key === "base-url" && value) parsed.baseUrl = value;
    else if (key === "duration-ms" && value) parsed.durationMs = Number(value);
    else if (key === "max-bytes" && value) parsed.maxBytes = Number(value);
    else if (key === "token" && value) parsed.internalToken = value;
    else if (key === "received-at" && value) parsed.receivedAt = Number(value);
    else if (key === "evidence-label" && value) parsed.evidenceLabel = value;
    else if (key === "out-dir" && value) parsed.outDir = value;
    else if (key === "generated-at" && value) parsed.generatedAt = value;
    else if (key === "dry-run") parsed.dryRun = true;
    else if (key === "command-preview") parsed.commandPreview = true;
  }

  return {
    ...parsed,
    devicePath: parsed.devicePath ?? ""
  };
}

export async function runSerialMavlinkReadOnlyBridge(options: SerialMavlinkBridgeOptions): Promise<SerialMavlinkBridgeResult> {
  const devicePath = normalizeDevicePath(options.devicePath);
  const durationMs = boundedInteger(options.durationMs, 1, 600_000, DEFAULT_DURATION_MS);
  const maxBytes = boundedInteger(options.maxBytes, 1, 100_000_000, DEFAULT_MAX_BYTES);
  const result: SerialMavlinkBridgeResult = {
    ok: false,
    mode: "mavlink-serial-readonly",
    dryRun: Boolean(options.dryRun),
    commandPreview: Boolean(options.commandPreview),
    devicePath,
    durationMs,
    maxBytes,
    inputBytes: 0,
    inputCount: 0,
    acceptedCount: 0,
    postedCount: 0,
    rejected: [],
    errors: [],
    commandEndpointsTouched: false,
    safety: {
      serialWriteOpened: false,
      commandUploadEnabled: false
    }
  };

  if (options.commandPreview) {
    result.ok = true;
    return result;
  }

  const capture = await captureSerialBytes(devicePath, durationMs, maxBytes);
  result.inputBytes = capture.bytes.length;
  result.errors.push(...capture.errors);

  if (!capture.bytes.length) {
    result.errors.push("No MAVLink serial bytes were observed before the bridge stopped.");
    return result;
  }

  const bridge = await runMavlinkReadOnlyBridge({
    baseUrl: options.baseUrl,
    dryRun: options.dryRun,
    binaryInput: capture.bytes,
    internalToken: options.internalToken,
    receivedAt: options.receivedAt
  });

  result.inputCount = bridge.inputCount;
  result.acceptedCount = bridge.acceptedCount;
  result.postedCount = bridge.postedCount;
  result.rejected = bridge.rejected;
  result.ok = bridge.ok && result.errors.length === 0;
  return result;
}

export async function writeSerialMavlinkReadOnlyBridgeEvidence(options: SerialMavlinkBridgeOptions) {
  const result = await runSerialMavlinkReadOnlyBridge(options);
  const evidence = await writeBridgeEvidenceArtifact({
    root: options.root,
    outDir: options.outDir,
    generatedAt: options.generatedAt,
    label: options.evidenceLabel ?? "mavlink-serial-bench",
    result,
    limitations: [
      "MAVLink serial evidence must be paired with required-source rehearsal evidence before the real MAVLink bench blocker can be cleared.",
      "Serial baud rate, permissions, and USB adapter setup are outside SEEKR; this wrapper opens the device read-only."
    ]
  });
  return { result, ...evidence };
}

async function captureSerialBytes(devicePath: string, durationMs: number, maxBytes: number) {
  const chunks: Buffer[] = [];
  const errors: string[] = [];
  let inputBytes = 0;

  await new Promise<void>((resolve) => {
    const stream = createReadStream(devicePath, {
      flags: "r",
      highWaterMark: Math.min(maxBytes, 16_384)
    });
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      stream.destroy();
      resolve();
    };
    const timer = setTimeout(finish, durationMs);

    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - inputBytes;
      if (remaining <= 0) {
        finish();
        return;
      }
      const accepted = buffer.subarray(0, remaining);
      chunks.push(accepted);
      inputBytes += accepted.length;
      if (inputBytes >= maxBytes) finish();
    });
    stream.on("error", (error) => {
      errors.push(error.message);
      finish();
    });
    stream.on("end", finish);
  });

  return { bytes: Buffer.concat(chunks), errors };
}

function normalizeDevicePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("A read-only MAVLink serial --device path is required.");
  if (trimmed.includes("\0") || /[\r\n]/.test(trimmed)) throw new Error("Serial device path must be a single filesystem path.");
  return trimmed;
}

function boundedInteger(value: number | undefined, min: number, max: number, fallback: number) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseSerialMavlinkBridgeArgs(process.argv.slice(2));
    if (options.evidenceLabel || options.outDir) {
      const evidence = await writeSerialMavlinkReadOnlyBridgeEvidence(options);
      console.log(JSON.stringify({
        ...evidence.result,
        evidence: {
          jsonPath: evidence.jsonPath,
          markdownPath: evidence.markdownPath,
          status: evidence.manifest.status,
          validation: evidence.manifest.validation
        }
      }, null, 2));
      if (!evidence.result.ok) process.exitCode = 1;
    } else {
      const result = await runSerialMavlinkReadOnlyBridge(options);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      mode: "mavlink-serial-readonly",
      commandEndpointsTouched: false,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  }
}
