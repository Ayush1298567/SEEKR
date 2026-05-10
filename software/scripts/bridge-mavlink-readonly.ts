import { pathToFileURL } from "node:url";
import { runMavlinkReadOnlyBridge } from "../src/server/bridges/readOnlyBridge";
import type { ReadOnlyBridgeOptions } from "../src/server/bridges/readOnlyBridge";
import { writeBridgeEvidenceArtifact } from "./bridge-evidence";

export interface MavlinkReadOnlyBridgeCliOptions extends ReadOnlyBridgeOptions {
  evidenceLabel?: string;
  outDir?: string;
  generatedAt?: string;
  root?: string;
  stdin?: boolean;
}

export function parseMavlinkBridgeArgs(values: string[]): MavlinkReadOnlyBridgeCliOptions {
  const args = parseArgs(values);
  return {
    baseUrl: stringArg(args["base-url"]),
    dryRun: Boolean(args["dry-run"]),
    fixtureNames: listArg(args.fixture),
    inputPath: stringArg(args.file),
    binaryInputPath: stringArg(args["binary-file"]),
    inputHex: stringArg(args.hex),
    udpHost: stringArg(args["udp-host"]),
    udpPort: args["udp-port"] ? Number(args["udp-port"]) : undefined,
    durationMs: args["duration-ms"] ? Number(args["duration-ms"]) : undefined,
    maxPackets: args["max-packets"] ? Number(args["max-packets"]) : undefined,
    internalToken: stringArg(args.token),
    receivedAt: args["received-at"] ? Number(args["received-at"]) : undefined,
    evidenceLabel: stringArg(args["evidence-label"]),
    outDir: stringArg(args["out-dir"]),
    generatedAt: stringArg(args["generated-at"]),
    stdin: Boolean(args.stdin)
  };
}

export async function runMavlinkReadOnlyBridgeCli(options: MavlinkReadOnlyBridgeCliOptions) {
  return runMavlinkReadOnlyBridge({
    ...options,
    inputText: options.stdin ? await readStdin() : options.inputText
  });
}

export async function writeMavlinkReadOnlyBridgeEvidence(options: MavlinkReadOnlyBridgeCliOptions) {
  const result = await runMavlinkReadOnlyBridgeCli(options);
  const evidenceResult = {
    ...result,
    safety: {
      commandUploadEnabled: false
    }
  };
  const evidence = await writeBridgeEvidenceArtifact({
    root: options.root,
    outDir: options.outDir,
    generatedAt: options.generatedAt,
    label: options.evidenceLabel ?? (result.listener?.protocol === "udp" ? "mavlink-udp-bench" : "mavlink-readonly"),
    result: evidenceResult,
    limitations: [
      "MAVLink UDP evidence must be paired with actual target-board evidence and required-source rehearsal evidence before a real MAVLink bench blocker can be cleared.",
      "Fixture, file, stdin, hex, or dry-run MAVLink evidence is useful for rehearsal only and cannot clear the real bench blocker."
    ]
  });
  return { result: evidenceResult, ...evidence };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseMavlinkBridgeArgs(process.argv.slice(2));
    if (options.evidenceLabel || options.outDir) {
      const evidence = await writeMavlinkReadOnlyBridgeEvidence(options);
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
      const result = await runMavlinkReadOnlyBridgeCli(options);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      mode: "mavlink-telemetry",
      commandEndpointsTouched: false,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  }
}

function parseArgs(values: string[]) {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (typeof inlineValue === "string") parsed[rawKey] = inlineValue;
    else if (values[index + 1] && !values[index + 1].startsWith("--")) parsed[rawKey] = values[++index];
    else parsed[rawKey] = true;
  }
  return parsed;
}

function listArg(value: string | boolean | undefined) {
  if (typeof value !== "string") return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function stringArg(value: string | boolean | undefined) {
  return typeof value === "string" ? value : undefined;
}

async function readStdin() {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}
