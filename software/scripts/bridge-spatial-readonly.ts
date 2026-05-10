import { pathToFileURL } from "node:url";
import { runSpatialReadOnlyBridge } from "../src/server/bridges/readOnlyBridge";
import type { ReadOnlyBridgeOptions } from "../src/server/bridges/readOnlyBridge";
import { writeBridgeEvidenceArtifact } from "./bridge-evidence";

export interface SpatialReadOnlyBridgeCliOptions extends ReadOnlyBridgeOptions {
  evidenceLabel?: string;
  outDir?: string;
  generatedAt?: string;
  root?: string;
  stdin?: boolean;
}

export function parseSpatialBridgeArgs(values: string[]): SpatialReadOnlyBridgeCliOptions {
  const args = parseArgs(values);
  return {
    baseUrl: stringArg(args["base-url"]),
    dryRun: Boolean(args["dry-run"]),
    fixtureNames: listArg(args.fixture),
    inputPath: stringArg(args.file),
    inputText: stringArg(args["input-text"]),
    internalToken: stringArg(args.token),
    receivedAt: args["received-at"] ? Number(args["received-at"]) : undefined,
    missionId: stringArg(args["mission-id"]),
    evidenceLabel: stringArg(args["evidence-label"]),
    outDir: stringArg(args["out-dir"]),
    generatedAt: stringArg(args["generated-at"]),
    stdin: Boolean(args.stdin)
  };
}

export async function runSpatialReadOnlyBridgeCli(options: SpatialReadOnlyBridgeCliOptions) {
  return runSpatialReadOnlyBridge({
    ...options,
    inputText: options.stdin ? await readStdin() : options.inputText
  });
}

export async function writeSpatialReadOnlyBridgeEvidence(options: SpatialReadOnlyBridgeCliOptions) {
  const result = await runSpatialReadOnlyBridgeCli(options);
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
    label: options.evidenceLabel ?? "spatial-readonly",
    result: evidenceResult,
    limitations: [
      "Spatial bridge evidence must be paired with actual target-board evidence and required-source rehearsal evidence before LiDAR/spatial bench proof can be claimed.",
      "Fixture, file, stdin, or dry-run spatial evidence is useful for rehearsal only and cannot validate real LiDAR/depth hardware."
    ]
  });
  return { result: evidenceResult, ...evidence };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseSpatialBridgeArgs(process.argv.slice(2));
    if (options.evidenceLabel || options.outDir) {
      const evidence = await writeSpatialReadOnlyBridgeEvidence(options);
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
      const result = await runSpatialReadOnlyBridgeCli(options);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      mode: "spatial-assets",
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
