import { spawn, type ChildProcess } from "node:child_process";
import { AddressInfo, createServer } from "node:net";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { localAiPrepareManifestOk } from "./local-ai-prepare";
import {
  doctorCheckStatusOk,
  doctorPortWarningEvidenceOk,
  doctorRuntimeDependencyEvidenceOk,
  doctorSourceControlEvidenceOk,
  plugAndPlaySetupOk,
  REQUIRED_DOCTOR_CHECK_IDS
} from "./plug-and-play-artifact-contract";
import { validateSourceControlHandoffManifest } from "./source-control-handoff";

type SmokeCheckStatus = "pass" | "fail";

export interface RehearsalStartSmokeCheck {
  id: string;
  status: SmokeCheckStatus;
  details: string;
  evidence: string[];
}

export interface RehearsalStartSmokeManifest {
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  status: SmokeCheckStatus;
  commandUploadEnabled: false;
  command: "npm run rehearsal:start";
  apiPort: number;
  clientPort: number;
  dataDirPath: string;
  plugAndPlaySetupPath?: string;
  localAiPreparePath?: string;
  sourceControlHandoffPath?: string;
  plugAndPlayDoctorPath?: string;
  checked: string[];
  checks: RehearsalStartSmokeCheck[];
  logTail: string;
  safetyBoundary: {
    realAircraftCommandUpload: false;
    hardwareActuationEnabled: false;
    runtimePolicyInstalled: false;
  };
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/rehearsal-start-smoke";
export const REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS = [
  "wrapper-started",
  "setup-artifact",
  "local-ai-prepare-artifact",
  "source-control-handoff-artifact",
  "doctor-artifact",
  "api-health",
  "client-shell",
  "runtime-config",
  "source-health",
  "readiness",
  "shutdown"
];

export async function writeRehearsalStartSmoke(options: {
  root?: string;
  generatedAt?: string;
  outDir?: string;
  apiPort?: number;
  clientPort?: number;
  timeoutMs?: number;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const safeTimestamp = safeIsoTimestampForFileName(generatedAt);
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const apiPort = options.apiPort ?? await freePort();
  const clientPort = options.clientPort ?? await freePort();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const dataDirPath = path.posix.join(DEFAULT_OUT_DIR, `run-${safeTimestamp}`, "data");
  const child = spawn("npm", ["run", "rehearsal:start"], {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      PORT: String(apiPort),
      SEEKR_API_PORT: String(apiPort),
      SEEKR_CLIENT_PORT: String(clientPort),
      SEEKR_DOCTOR_PROFILE: "rehearsal-start-smoke",
      SEEKR_DATA_DIR: dataDirPath,
      SEEKR_EXPECTED_SOURCES: process.env.SEEKR_EXPECTED_SOURCES ?? [
        "mavlink:telemetry:drone-1",
        "ros2-slam:map",
        "detection:spatial",
        "lidar-slam:lidar",
        "lidar-slam:slam",
        "isaac-nvblox:costmap",
        "isaac-nvblox:perception"
      ].join(",")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs: string[] = [];
  const checks: RehearsalStartSmokeCheck[] = [];
  const startedAtMs = Date.parse(generatedAt);
  let plugAndPlaySetupPath: string | undefined;
  let localAiPreparePath: string | undefined;
  let sourceControlHandoffPath: string | undefined;
  let plugAndPlayDoctorPath: string | undefined;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => logs.push(chunk));
  child.stderr.on("data", (chunk: string) => logs.push(chunk));

  await recordCheck(checks, "wrapper-started", "The rehearsal start wrapper process launches.", ["npm run rehearsal:start"], async () => {
    await delay(250);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`wrapper exited before serving: ${tail(logs)}`);
    }
  });
  await recordDynamicCheck(checks, "setup-artifact", "The wrapper writes fresh local setup evidence before serving.", async () => {
    const artifact = await waitForLatestJson(root, ".tmp/plug-and-play-setup", "seekr-local-setup-", startedAtMs, timeoutMs, logs);
    if (!plugAndPlaySetupOk(artifact.manifest)) {
      throw new Error("latest local setup artifact is missing required env/data/safety evidence");
    }
    plugAndPlaySetupPath = artifact.relativePath;
    return [artifact.relativePath];
  });
  await recordDynamicCheck(checks, "local-ai-prepare-artifact", "The wrapper writes fresh local AI prepare evidence before serving.", async () => {
    const artifact = await waitForLatestJson(root, ".tmp/local-ai-prepare", "seekr-local-ai-prepare-", startedAtMs, timeoutMs, logs);
    if (!localAiPrepareManifestOk(artifact.manifest)) {
      throw new Error("latest local AI prepare artifact does not prove a passing Ollama model preparation run");
    }
    localAiPreparePath = artifact.relativePath;
    return [artifact.relativePath];
  });
  await recordDynamicCheck(checks, "source-control-handoff-artifact", "The wrapper writes source-control handoff evidence before serving.", async () => {
    const artifact = await waitForLatestJson(root, ".tmp/source-control-handoff", "seekr-source-control-handoff-", startedAtMs, timeoutMs, logs);
    const validation = validateSourceControlHandoffManifest(artifact.manifest);
    if (!validation.ok || !isRecord(artifact.manifest) || artifact.manifest.commandUploadEnabled !== false) {
      throw new Error(`latest source-control handoff artifact is malformed or unsafe: ${validation.problems.join("; ")}`);
    }
    sourceControlHandoffPath = artifact.relativePath;
    return [artifact.relativePath];
  });
  await recordDynamicCheck(checks, "doctor-artifact", "The wrapper writes a smoke-profile doctor artifact before serving.", async () => {
    const artifact = await waitForLatestJson(root, ".tmp/plug-and-play-doctor", "seekr-plug-and-play-doctor-", startedAtMs, timeoutMs, logs);
    if (!rehearsalStartDoctorOk(artifact.manifest, sourceControlHandoffPath)) {
      throw new Error("latest rehearsal-start doctor artifact is missing required runtime/source-control/AI/port/data/safety evidence");
    }
    plugAndPlayDoctorPath = artifact.relativePath;
    return [artifact.relativePath, sourceControlHandoffPath ?? ".tmp/source-control-handoff"];
  });
  await recordCheck(checks, "api-health", "The API becomes healthy through the rehearsal start command.", [`http://127.0.0.1:${apiPort}/api/health`], async () => {
    await waitForOk(`http://127.0.0.1:${apiPort}/api/health`, timeoutMs, logs);
  });
  await recordCheck(checks, "client-shell", "The Vite client shell is reachable through the rehearsal start command.", [`http://127.0.0.1:${clientPort}/`], async () => {
    const response = await waitForOk(`http://127.0.0.1:${clientPort}/`, timeoutMs, logs);
    const html = await response.text();
    assert(html.includes('id="root"'), "client shell should contain React root");
  });
  await recordCheck(checks, "runtime-config", "Runtime config preserves local ports, expected read-only sources, and disabled command upload.", [`http://127.0.0.1:${apiPort}/api/config`], async () => {
    const config = await json<Record<string, unknown>>(`http://127.0.0.1:${apiPort}/api/config`);
    const server = isRecord(config.server) ? config.server : {};
    const safety = isRecord(config.safety) ? config.safety : {};
    const sourceHealth = isRecord(config.sourceHealth) ? config.sourceHealth : {};
    const expectedSources = Array.isArray(config.expectedSources) ? config.expectedSources : [];
    assert(server.apiPort === String(apiPort), "runtime config must report the smoke API port");
    assert(server.clientPort === String(clientPort), "runtime config must report the smoke client port");
    assert(safety.commandUploadEnabled === false, "runtime config must keep command upload disabled");
    assert(safety.realAdaptersReadOnly === true, "runtime config must keep real adapters read-only");
    assert(sourceHealth.expectedSourcesConfigured === true, "expected sources must be configured");
    assert(expectedSources.length >= 6, "expected read-only source categories must be visible");
  });
  await recordCheck(checks, "source-health", "Source-health endpoint exposes the expected read-only source categories without blocking failures.", [`http://127.0.0.1:${apiPort}/api/source-health`], async () => {
    const report = await json<Record<string, unknown>>(`http://127.0.0.1:${apiPort}/api/source-health`);
    const summary = isRecord(report.summary) ? report.summary : {};
    assert(summary.fail === 0, "source health must not report blocking failures");
    assert(Number(summary.expectedSourceCount) >= 5, "source health must include expected rehearsal adapters");
    assert(Array.isArray(summary.channels) && summary.channels.length >= 6, "source health must include expected rehearsal source categories");
  });
  await recordCheck(checks, "readiness", "Readiness endpoint remains locally usable with safety-boundary evidence.", [`http://127.0.0.1:${apiPort}/api/readiness`], async () => {
    const readiness = await json<Record<string, unknown>>(`http://127.0.0.1:${apiPort}/api/readiness`);
    const checks = Array.isArray(readiness.checks) ? readiness.checks.filter(isRecord) : [];
    assert(readiness.ok === true, "readiness must have no blocking failures");
    assert(
      checks.some((check) => check.id === "safety-boundary" && check.status === "pass" && check.blocking === true),
      "readiness must prove the safety boundary"
    );
  });

  const shutdown = await stopProcessGroup(child);
  checks.push({
    id: "shutdown",
    status: shutdown.ok ? "pass" : "fail",
    details: shutdown.details,
    evidence: ["SIGTERM", "npm run rehearsal:start"]
  });

  const ok = checks.every((check) => check.status === "pass");
  const manifest: RehearsalStartSmokeManifest = {
    schemaVersion: 1,
    generatedAt,
    ok,
    status: ok ? "pass" : "fail",
    commandUploadEnabled: false,
    command: "npm run rehearsal:start",
    apiPort,
    clientPort,
    dataDirPath,
    plugAndPlaySetupPath,
    localAiPreparePath,
    sourceControlHandoffPath,
    plugAndPlayDoctorPath,
    checked: checks.map((check) => check.id),
    checks,
    logTail: tail(logs),
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    limitations: [
      "This smoke starts the local rehearsal wrapper only long enough to prove laptop startup, API/client reachability, source-health visibility, readiness, and clean shutdown.",
      "It does not validate actual Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware-actuation policy approval.",
      "Real command upload and hardware actuation remain disabled."
    ]
  };

  await mkdir(outDir, { recursive: true });
  const baseName = `seekr-rehearsal-start-smoke-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

export function validateRehearsalStartSmokeManifest(manifest: unknown) {
  const problems: string[] = [];
  if (!isRecord(manifest)) {
    return { ok: false, problems: ["rehearsal-start smoke artifact is not a JSON object"] };
  }
  const checks = Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  const checked = Array.isArray(manifest.checked) ? manifest.checked.map(String) : [];
  if (manifest.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (manifest.ok !== true) problems.push("ok must be true");
  if (manifest.status !== "pass") problems.push("status must be pass");
  if (manifest.commandUploadEnabled !== false) problems.push("commandUploadEnabled must be false");
  if (manifest.command !== "npm run rehearsal:start") problems.push("command must be npm run rehearsal:start");
  if (!Number.isFinite(Number(manifest.apiPort)) || Number(manifest.apiPort) <= 0) problems.push("apiPort must be positive");
  if (!Number.isFinite(Number(manifest.clientPort)) || Number(manifest.clientPort) <= 0) problems.push("clientPort must be positive");
  if (typeof manifest.dataDirPath !== "string" || !manifest.dataDirPath.includes(".tmp/rehearsal-start-smoke/")) problems.push("dataDirPath must be project-local rehearsal-start-smoke storage");
  if (typeof manifest.plugAndPlaySetupPath !== "string" || !manifest.plugAndPlaySetupPath.includes(".tmp/plug-and-play-setup/")) problems.push("plugAndPlaySetupPath must reference local setup evidence");
  if (typeof manifest.localAiPreparePath !== "string" || !manifest.localAiPreparePath.includes(".tmp/local-ai-prepare/")) problems.push("localAiPreparePath must reference local AI prepare evidence");
  if (typeof manifest.sourceControlHandoffPath !== "string" || !manifest.sourceControlHandoffPath.includes(".tmp/source-control-handoff/")) problems.push("sourceControlHandoffPath must reference source-control handoff evidence");
  if (typeof manifest.plugAndPlayDoctorPath !== "string" || !manifest.plugAndPlayDoctorPath.includes(".tmp/plug-and-play-doctor/")) problems.push("plugAndPlayDoctorPath must reference smoke-profile doctor evidence");
  if (!arraysEqual(checked, REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS)) {
    problems.push("checked must exactly match the required rehearsal-start smoke check IDs in order");
  }
  if (!checkIdsAreExact(checks, REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS)) {
    problems.push("checks must exactly match the required rehearsal-start smoke check IDs in order");
  }
  for (const check of checks) {
    if (check.status !== "pass") problems.push(`check ${String(check.id ?? "unknown")} must pass`);
    if (typeof check.details !== "string" || !check.details) problems.push(`check ${String(check.id ?? "unknown")} must include details`);
  }
  if (!safetyBoundaryFalse(manifest)) problems.push("safety boundary authorization fields must remain false");
  return { ok: problems.length === 0, problems };
}

async function recordCheck(
  checks: RehearsalStartSmokeCheck[],
  id: string,
  requirement: string,
  evidence: string[],
  fn: () => Promise<void>
) {
  try {
    await fn();
    checks.push({ id, status: "pass", details: requirement, evidence });
  } catch (error) {
    checks.push({ id, status: "fail", details: `${requirement} Failed: ${error instanceof Error ? error.message : String(error)}`, evidence });
  }
}

async function recordDynamicCheck(
  checks: RehearsalStartSmokeCheck[],
  id: string,
  requirement: string,
  fn: () => Promise<string[]>
) {
  try {
    const evidence = await fn();
    checks.push({ id, status: "pass", details: requirement, evidence });
  } catch (error) {
    checks.push({ id, status: "fail", details: `${requirement} Failed: ${error instanceof Error ? error.message : String(error)}`, evidence: [id] });
  }
}

async function waitForOk(url: string, timeoutMs: number, logs: string[]) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`${url} did not become ready: ${String(lastError)}\n${tail(logs)}`);
}

async function waitForLatestJson(
  root: string,
  directory: string,
  prefix: string,
  sinceMs: number,
  timeoutMs: number,
  logs: string[]
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const artifact = await latestJson(root, directory, prefix, sinceMs);
      if (artifact) return artifact;
      lastError = new Error(`No ${directory}/${prefix}*.json artifact generated after smoke start.`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`${String(lastError)}\n${tail(logs)}`);
}

async function latestJson(root: string, directory: string, prefix: string, sinceMs: number) {
  const absoluteDirectory = path.join(root, directory);
  const names = await readdir(absoluteDirectory).catch(() => []);
  const jsonNames = names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left));
  for (const name of jsonNames) {
    const absolutePath = path.join(absoluteDirectory, name);
    const manifest = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
    const generatedAtMs = timeMs(isRecord(manifest) ? manifest.generatedAt : undefined);
    if (generatedAtMs !== undefined && generatedAtMs >= sinceMs) {
      return {
        relativePath: path.posix.join(directory, name),
        absolutePath,
        manifest
      };
    }
  }
  return undefined;
}

async function json<T>(url: string) {
  const response = await fetch(url);
  assert(response.ok, `${url} returned ${response.status}`);
  return await response.json() as T;
}

function rehearsalStartDoctorOk(manifest: unknown, expectedSourceControlPath?: string) {
  if (!isRecord(manifest)) return false;
  const ai = isRecord(manifest.ai) ? manifest.ai : {};
  const summary = isRecord(manifest.summary) ? manifest.summary : {};
  const checks = Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  return manifest.ok === true &&
    manifest.status === "ready-local-start" &&
    manifest.profile === "rehearsal-start-smoke" &&
    manifest.commandUploadEnabled === false &&
    ai.provider === "ollama" &&
    ai.status === "pass" &&
    Number(summary.fail) === 0 &&
    checkIdsAreExact(checks, REQUIRED_DOCTOR_CHECK_IDS) &&
    REQUIRED_DOCTOR_CHECK_IDS.every((id) => doctorCheckStatusOk(checks, id)) &&
    doctorRuntimeDependencyEvidenceOk(checks) &&
    doctorSourceControlEvidenceOk(checks, expectedSourceControlPath) &&
    doctorPortWarningEvidenceOk(checks);
}

function timeMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function stopProcessGroup(child: ChildProcess) {
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    delay(3_000).then(() => false)
  ]);
  if (exited || child.exitCode !== null || child.signalCode !== null) {
    return { ok: true, details: "Rehearsal start process group terminated after smoke verification." };
  }
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  return { ok: false, details: "Rehearsal start process group required SIGKILL after timeout." };
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function renderMarkdown(manifest: RehearsalStartSmokeManifest) {
  return `${[
    "# SEEKR Rehearsal Start Smoke",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `OK: ${manifest.ok}`,
    "Command upload enabled: false",
    `Command: ${manifest.command}`,
    `API port: ${manifest.apiPort}`,
    `Client port: ${manifest.clientPort}`,
    `Data directory: ${manifest.dataDirPath}`,
    manifest.plugAndPlaySetupPath ? `Setup artifact: ${manifest.plugAndPlaySetupPath}` : undefined,
    manifest.localAiPreparePath ? `Local AI prepare artifact: ${manifest.localAiPreparePath}` : undefined,
    manifest.sourceControlHandoffPath ? `Source-control handoff artifact: ${manifest.sourceControlHandoffPath}` : undefined,
    manifest.plugAndPlayDoctorPath ? `Smoke doctor artifact: ${manifest.plugAndPlayDoctorPath}` : undefined,
    "",
    "Checks:",
    "",
    "| Check | Status | Details |",
    "| --- | --- | --- |",
    ...manifest.checks.map((check) => `| ${check.id} | ${check.status} | ${escapeTable(check.details)} |`),
    "",
    "Limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].filter((line): line is string => typeof line === "string").join("\n")}\n`;
}

function safetyBoundaryFalse(manifest: Record<string, unknown>) {
  const boundary = isRecord(manifest.safetyBoundary) ? manifest.safetyBoundary : {};
  return boundary.realAircraftCommandUpload === false &&
    boundary.hardwareActuationEnabled === false &&
    boundary.runtimePolicyInstalled === false;
}

function checkIdsAreExact(checks: Record<string, unknown>[], requiredIds: readonly string[]) {
  return checks.length === requiredIds.length &&
    checks.every((check, index) => check.id === requiredIds[index]);
}

function arraysEqual(left: string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tail(logs: string[]) {
  return logs.join("").slice(-3_000);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await writeRehearsalStartSmoke();
  console.log(JSON.stringify({
    ok: result.manifest.ok,
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    apiPort: result.manifest.apiPort,
    clientPort: result.manifest.clientPort,
    checked: result.manifest.checked,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.ok) process.exitCode = 1;
}
