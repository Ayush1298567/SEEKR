import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runRos2ReadOnlyBridge } from "../src/server/bridges/readOnlyBridge";
import type { BridgeRejectedRecord } from "../src/server/bridges/readOnlyBridge";
import { writeBridgeEvidenceArtifact } from "./bridge-evidence";

export interface LiveRos2TopicCommand {
  topic: string;
  command: string;
  args: string[];
  display: string;
}

export interface LiveRos2BridgeOptions {
  baseUrl?: string;
  topics: string[];
  ros2Bin?: string;
  dryRun?: boolean;
  commandPreview?: boolean;
  durationMs?: number;
  maxRecords?: number;
  internalToken?: string;
  missionId?: string;
  receivedAt?: number;
  evidenceLabel?: string;
  outDir?: string;
  generatedAt?: string;
  root?: string;
}

export interface LiveRos2RejectedRecord extends BridgeRejectedRecord {
  topic: string;
}

export interface LiveRos2BridgeResult {
  ok: boolean;
  mode: "ros2-live-readonly";
  dryRun: boolean;
  commandPreview: boolean;
  topics: string[];
  commands: LiveRos2TopicCommand[];
  durationMs: number;
  maxRecords: number;
  inputCount: number;
  acceptedCount: number;
  postedCount: number;
  rejected: LiveRos2RejectedRecord[];
  errors: string[];
  commandEndpointsTouched: false;
  safety: {
    ros2ServicesTouched: false;
    ros2ActionsTouched: false;
    commandUploadEnabled: false;
  };
}

type SpawnLike = typeof spawn;

const DEFAULT_ROS2_BIN = "ros2";
const DEFAULT_DURATION_MS = 30_000;
const DEFAULT_MAX_RECORDS = 200;

export function buildRos2TopicEchoCommand(topic: string, ros2Bin = DEFAULT_ROS2_BIN): LiveRos2TopicCommand {
  const normalizedTopic = normalizeRos2Topic(topic);
  const command = ros2Bin.trim() || DEFAULT_ROS2_BIN;
  const args = ["topic", "echo", "--json", normalizedTopic];
  return {
    topic: normalizedTopic,
    command,
    args,
    display: [command, ...args.map(shellQuote)].join(" ")
  };
}

export function parseLiveRos2BridgeArgs(values: string[]): LiveRos2BridgeOptions {
  const topics: string[] = [];
  const parsed: Omit<LiveRos2BridgeOptions, "topics"> = {};

  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? (values[index + 1]?.startsWith("--") ? undefined : values[++index]);

    if (key === "topic" && value) {
      topics.push(...value.split(",").map((topic) => topic.trim()).filter(Boolean));
    } else if (key === "base-url" && value) parsed.baseUrl = value;
    else if (key === "ros2-bin" && value) parsed.ros2Bin = value;
    else if (key === "duration-ms" && value) parsed.durationMs = Number(value);
    else if (key === "max-records" && value) parsed.maxRecords = Number(value);
    else if (key === "token" && value) parsed.internalToken = value;
    else if (key === "mission-id" && value) parsed.missionId = value;
    else if (key === "received-at" && value) parsed.receivedAt = Number(value);
    else if (key === "evidence-label" && value) parsed.evidenceLabel = value;
    else if (key === "out-dir" && value) parsed.outDir = value;
    else if (key === "generated-at" && value) parsed.generatedAt = value;
    else if (key === "dry-run") parsed.dryRun = true;
    else if (key === "command-preview") parsed.commandPreview = true;
  }

  return { ...parsed, topics };
}

export async function runLiveRos2ReadOnlyBridge(
  options: LiveRos2BridgeOptions,
  spawnImpl: SpawnLike = spawn
): Promise<LiveRos2BridgeResult> {
  const topics = uniqueTopics(options.topics);
  if (!topics.length) throw new Error("At least one --topic must be provided for the live ROS 2 bridge.");

  const durationMs = boundedInteger(options.durationMs, 1, 600_000, DEFAULT_DURATION_MS);
  const maxRecords = boundedInteger(options.maxRecords, 1, 10_000, DEFAULT_MAX_RECORDS);
  const commands = topics.map((topic) => buildRos2TopicEchoCommand(topic, options.ros2Bin));

  const result: LiveRos2BridgeResult = {
    ok: false,
    mode: "ros2-live-readonly",
    dryRun: Boolean(options.dryRun),
    commandPreview: Boolean(options.commandPreview),
    topics,
    commands,
    durationMs,
    maxRecords,
    inputCount: 0,
    acceptedCount: 0,
    postedCount: 0,
    rejected: [],
    errors: [],
    commandEndpointsTouched: false,
    safety: {
      ros2ServicesTouched: false,
      ros2ActionsTouched: false,
      commandUploadEnabled: false
    }
  };

  if (options.commandPreview) {
    result.ok = true;
    return result;
  }

  const children: ChildProcess[] = [];
  let pending = Promise.resolve();
  let stopping = false;

  await new Promise<void>((resolve) => {
    let openChildren = commands.length;
    const finish = () => {
      if (stopping) return;
      stopping = true;
      for (const child of children) {
        if (!child.killed) child.kill("SIGTERM");
      }
      void pending.finally(resolve);
    };
    const timer = setTimeout(finish, durationMs);

    for (const topicCommand of commands) {
      const child = spawnImpl(topicCommand.command, topicCommand.args, { stdio: ["ignore", "pipe", "pipe"] });
      children.push(child);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");

      let stdoutBuffer = "";
      let stderrTail = "";

      child.stdout?.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          pending = pending.then(async () => {
            if (result.inputCount >= maxRecords) return;
            await processRos2JsonLine(trimmed, topicCommand.topic, options, result);
            if (result.inputCount >= maxRecords) finish();
          });
        }
      });

      child.stderr?.on("data", (chunk: string) => {
        stderrTail = `${stderrTail}${chunk}`.slice(-1_000);
      });

      child.on("error", (error) => {
        result.errors.push(`${topicCommand.display}: ${error.message}`);
      });

      child.on("close", (code, signal) => {
        openChildren -= 1;
        const trimmedStderr = stderrTail.trim();
        if (!stopping && code && code !== 0) {
          result.errors.push(`${topicCommand.display} exited with code ${code}${trimmedStderr ? `: ${trimmedStderr}` : ""}`);
        } else if (!stopping && signal) {
          result.errors.push(`${topicCommand.display} exited with signal ${signal}${trimmedStderr ? `: ${trimmedStderr}` : ""}`);
        }
        if (openChildren === 0) {
          clearTimeout(timer);
          void pending.finally(resolve);
        }
      });
    }
  });

  result.ok = result.inputCount > 0 && result.rejected.length === 0 && result.errors.length === 0;
  if (result.inputCount === 0) result.errors.push("No ROS 2 topic records were observed before the bridge stopped.");
  return result;
}

export async function writeLiveRos2ReadOnlyBridgeEvidence(
  options: LiveRos2BridgeOptions,
  spawnImpl: SpawnLike = spawn
) {
  const result = await runLiveRos2ReadOnlyBridge(options, spawnImpl);
  const evidence = await writeBridgeEvidenceArtifact({
    root: options.root,
    outDir: options.outDir,
    generatedAt: options.generatedAt,
    label: options.evidenceLabel ?? "ros2-live-bench",
    result,
    limitations: [
      "Live ROS 2 evidence must be paired with required-source rehearsal evidence before the real ROS 2 bench blocker can be cleared.",
      "This wrapper subscribes with ros2 topic echo only; it does not call ROS services or actions."
    ]
  });
  return { result, ...evidence };
}

async function processRos2JsonLine(
  line: string,
  topic: string,
  options: LiveRos2BridgeOptions,
  result: LiveRos2BridgeResult
) {
  const bridgeResult = await runRos2ReadOnlyBridge({
    baseUrl: options.baseUrl,
    dryRun: options.dryRun,
    inputText: line,
    ros2Topic: topic,
    internalToken: options.internalToken,
    missionId: options.missionId,
    receivedAt: typeof options.receivedAt === "number" ? options.receivedAt + result.inputCount : undefined
  });

  result.inputCount += bridgeResult.inputCount;
  result.acceptedCount += bridgeResult.acceptedCount;
  result.postedCount += bridgeResult.postedCount;
  result.rejected.push(...bridgeResult.rejected.map((rejection) => ({ ...rejection, topic })));
}

function uniqueTopics(values: string[]) {
  return [...new Set(values.map(normalizeRos2Topic))];
}

function normalizeRos2Topic(value: string) {
  const topic = value.trim();
  if (!/^\/[A-Za-z0-9_./~-]+$/.test(topic)) {
    throw new Error(`Invalid ROS 2 topic "${value}". Use an absolute topic such as /drone/pose without remaps or shell syntax.`);
  }
  return topic.replace(/\/+/g, "/");
}

function boundedInteger(value: number | undefined, min: number, max: number, fallback: number) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseLiveRos2BridgeArgs(process.argv.slice(2));
    if (options.evidenceLabel || options.outDir) {
      const evidence = await writeLiveRos2ReadOnlyBridgeEvidence(options);
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
      const result = await runLiveRos2ReadOnlyBridge(options);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      mode: "ros2-live-readonly",
      commandEndpointsTouched: false,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  }
}
