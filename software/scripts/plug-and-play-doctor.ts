import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseEnvContent } from "../src/server/env";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { validateSourceControlHandoffManifest } from "./source-control-handoff";

type DoctorStatus = "pass" | "warn" | "fail";

export interface PlugAndPlayDoctorCheck {
  id: string;
  status: DoctorStatus;
  details: string;
  evidence: string[];
}

export interface PlugAndPlayDoctorManifest {
  schemaVersion: 1;
  generatedAt: string;
  profile: "operator-start" | "rehearsal-start-smoke";
  ok: boolean;
  status: "ready-local-start" | "blocked-local-start";
  commandUploadEnabled: false;
  ai: {
    provider: string;
    model: string;
    status: DoctorStatus;
    availableModels: string[];
  };
  ports: {
    api: number;
    client: number;
    fallbackApi?: number;
    fallbackClient?: number;
  };
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  checks: PlugAndPlayDoctorCheck[];
  nextCommands: string[];
  limitations: string[];
}

interface PortListenerDiagnostic {
  command: string;
  pid: number;
  cwd?: string;
}

const execFileAsync = promisify(execFile);
const DEFAULT_OUT_DIR = ".tmp/plug-and-play-doctor";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2:latest";

const REQUIRED_SCRIPTS = [
  "doctor",
  "setup:local",
  "ai:prepare",
  "dev",
  "plug-and-play",
  "rehearsal:start",
  "server",
  "client",
  "test:ai:local",
  "audit:source-control",
  "audit:plug-and-play",
  "acceptance"
];

const REQUIRED_ENV_SIGNALS = [
  "SEEKR_AI_PROVIDER=ollama",
  "SEEKR_OLLAMA_URL=http://127.0.0.1:11434",
  "SEEKR_OLLAMA_MODEL=llama3.2:latest",
  "SEEKR_OLLAMA_TIMEOUT_MS=20000"
];

export async function buildPlugAndPlayDoctor(options: {
  root?: string;
  generatedAt?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  portAvailable?: (port: number, host: string) => Promise<boolean>;
  portInspector?: (port: number, host: string) => Promise<PortListenerDiagnostic[]>;
  freePort?: (host: string) => Promise<number>;
} = {}): Promise<PlugAndPlayDoctorManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const env = options.env ?? process.env;
  const effectiveEnv = await buildEffectiveEnv(root, env);
  const profile = env.SEEKR_DOCTOR_PROFILE === "rehearsal-start-smoke" ? "rehearsal-start-smoke" : "operator-start";
  const fetchImpl = options.fetchImpl ?? fetch;
  const portAvailable = options.portAvailable ?? isPortAvailable;
  const portInspector = options.portInspector ?? inspectPortListeners;
  const freePort = options.freePort ?? selectFreeLocalPort;

  const packageScripts = await packageScriptCheck(root);
  const runtimeDependencies = await runtimeDependencyCheck(root);
  const repositorySafety = await repositorySafetyCheck(root);
  const sourceControlHandoff = await sourceControlHandoffCheck(root);
  const operatorStart = await operatorStartScriptCheck(root);
  const envCheck = await envSetupCheck(root, env, effectiveEnv);
  const aiCheck = await localAiCheck(effectiveEnv, fetchImpl);
  const portCheck = await localPortCheck(
    effectiveEnv,
    env,
    portAvailable,
    fetchImpl,
    portInspector,
    operatorStart.status === "pass",
    freePort
  );
  const dataDirCheck = await localDataDirCheck(root, effectiveEnv);
  const safetyCheck = safetyBoundaryCheck(effectiveEnv);
  const checks = [packageScripts, runtimeDependencies, repositorySafety, sourceControlHandoff, operatorStart, envCheck, aiCheck.check, portCheck.check, dataDirCheck, safetyCheck];
  const summary = {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length
  };
  const ok = summary.fail === 0;

  return {
    schemaVersion: 1,
    generatedAt,
    profile,
    ok,
    status: ok ? "ready-local-start" : "blocked-local-start",
    commandUploadEnabled: false,
    ai: {
      provider: aiCheck.provider,
      model: aiCheck.model,
      status: aiCheck.check.status,
      availableModels: aiCheck.availableModels
    },
    ports: portCheck.ports,
    summary,
    checks,
    nextCommands: ok
      ? ["npm run plug-and-play", "npm run audit:plug-and-play"]
      : ["Fix failed doctor checks, then rerun npm run doctor."],
    limitations: [
      "This doctor proves local laptop startup prerequisites only.",
      "Source-control handoff warnings do not block local startup, but they must be resolved before claiming GitHub-published plug-and-play distribution.",
      "It does not validate actual Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware-actuation policy approval.",
      "Real command upload and hardware actuation remain disabled."
    ]
  };
}

export async function writePlugAndPlayDoctor(options: Parameters<typeof buildPlugAndPlayDoctor>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildPlugAndPlayDoctor(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-plug-and-play-doctor-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

async function packageScriptCheck(root: string): Promise<PlugAndPlayDoctorCheck> {
  const packageJson = await readJson(path.join(root, "package.json"));
  const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const missing = REQUIRED_SCRIPTS.filter((script) => typeof scripts[script] !== "string");
  return {
    id: "package-scripts",
    status: missing.length ? "fail" : "pass",
    details: missing.length
      ? `Missing package scripts: ${missing.join(", ")}.`
      : "Local start, AI smoke, acceptance, and plug-and-play audit scripts are present.",
    evidence: ["package.json", ...REQUIRED_SCRIPTS.map((script) => `package.json scripts.${script}`)]
  };
}

async function runtimeDependencyCheck(root: string): Promise<PlugAndPlayDoctorCheck> {
  const problems: string[] = [];
  const packageJson = await readJson(path.join(root, "package.json"));
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const lockPath = path.join(root, "package-lock.json");
  const lockJson = await readJson(lockPath);
  const packageEngines = isRecord(packageJson) && isRecord(packageJson.engines) ? packageJson.engines : {};
  const packageManager = isRecord(packageJson) && typeof packageJson.packageManager === "string" ? packageJson.packageManager : "";
  const lockRoot = isRecord(lockJson) && isRecord(lockJson.packages) && isRecord(lockJson.packages[""]) ? lockJson.packages[""] : {};
  const lockEngines = isRecord(lockRoot) && isRecord(lockRoot.engines) ? lockRoot.engines : {};
  const requiredBinPaths = [
    "node_modules/.bin/tsx",
    "node_modules/.bin/concurrently",
    "node_modules/.bin/vite"
  ];
  const missingBins = [];

  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    problems.push(`Node.js 20 or newer is required; current runtime is ${process.version}.`);
  }
  if (!(await pathExists(lockPath))) {
    problems.push("package-lock.json is missing; restore it or run npm install only when intentionally regenerating the lockfile.");
  }
  if (packageEngines.node !== ">=20") {
    problems.push("package.json engines.node must declare >=20 for repeatable field-laptop installs.");
  }
  if (packageEngines.npm !== ">=10") {
    problems.push("package.json engines.npm must declare >=10 for lockfile-compatible installs.");
  }
  if (!packageManager.startsWith("npm@")) {
    problems.push("package.json packageManager must pin npm for reproducible local installs.");
  }
  if (await pathExists(lockPath)) {
    if (lockEngines.node !== ">=20" || lockEngines.npm !== ">=10") {
      problems.push("package-lock.json root package must preserve Node/npm engine metadata.");
    }
  }
  for (const binPath of requiredBinPaths) {
    if (!(await pathExists(path.join(root, binPath)))) {
      missingBins.push(binPath);
    }
  }
  if (missingBins.length) {
    problems.push(`Missing local dependency binary/binaries: ${missingBins.join(", ")}; run npm ci before local startup.`);
  }

  return {
    id: "runtime-dependencies",
    status: problems.length ? "fail" : "pass",
    details: problems.join("; ") || `Node ${process.version}, package.json engines node >=20/npm >=10, packageManager ${packageManager}, package-lock.json, and ${requiredBinPaths.join(", ")} are present for local startup.`,
    evidence: [
      "process.version",
      "package.json engines.node",
      "package.json engines.npm",
      "package.json packageManager",
      "package-lock.json",
      "package-lock.json packages[\"\"].engines",
      ...requiredBinPaths
    ]
  };
}

async function repositorySafetyCheck(root: string): Promise<PlugAndPlayDoctorCheck> {
  const gitignore = await readText(path.join(root, ".gitignore"));
  const npmrc = await readText(path.join(root, ".npmrc"));
  const requiredGitignoreSignals = [
    ".env",
    ".env.*",
    "!.env.example",
    "node_modules/",
    ".tmp/",
    ".gstack/",
    "data/",
    "dist/",
    "test-results/"
  ];
  const problems = requiredGitignoreSignals
    .filter((signal) => !gitignore.includes(signal))
    .map((signal) => `.gitignore missing ${signal}`);

  if (!npmrc.split(/\r?\n/).some((line) => line.trim() === "engine-strict=true")) {
    problems.push(".npmrc must set engine-strict=true so unsupported Node/npm versions fail before local startup.");
  }

  return {
    id: "repository-safety",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "Git ignore policy protects local secrets/generated artifacts, and npm engine-strict enforces the declared runtime before install/startup.",
    evidence: [
      ".gitignore .env",
      ".gitignore node_modules/",
      ".gitignore .tmp/",
      ".gitignore .gstack/",
      ".gitignore data/",
      ".gitignore dist/",
      ".gitignore test-results/",
      ".npmrc engine-strict=true"
    ]
  };
}

async function sourceControlHandoffCheck(root: string): Promise<PlugAndPlayDoctorCheck> {
  const artifact = await latestJson(root, ".tmp/source-control-handoff", (name) => name.startsWith("seekr-source-control-handoff-"));
  const manifest = artifact ? await readJson(artifact.absolutePath) : undefined;

  if (!isRecord(manifest)) {
    return {
      id: "source-control-handoff",
      status: "warn",
      details: "No source-control handoff artifact exists; run npm run audit:source-control before claiming GitHub-published plug-and-play distribution.",
      evidence: [".tmp/source-control-handoff"]
    };
  }

  const validation = validateSourceControlHandoffManifest(manifest);
  if (!validation.ok) {
    return {
      id: "source-control-handoff",
      status: "fail",
      details: `Source-control handoff artifact is unsafe or malformed: ${validation.problems.join("; ")}.`,
      evidence: [artifact?.relativePath ?? ".tmp/source-control-handoff"]
    };
  }

  return {
    id: "source-control-handoff",
    status: validation.blockedCheckIds.length || validation.warningCheckIds.length ? "warn" : "pass",
    details: validation.blockedCheckIds.length
      ? `Source-control handoff is not ready yet: ${validation.blockedCheckIds.join(", ")}.`
      : validation.warningCheckIds.length
        ? `Source-control handoff has warning(s): ${validation.warningCheckIds.join(", ")}.`
        : "Source-control handoff artifact records local Git metadata, GitHub remote refs/default branch, published local HEAD, and a clean worktree.",
    evidence: [artifact?.relativePath ?? ".tmp/source-control-handoff"]
  };
}

async function operatorStartScriptCheck(root: string): Promise<PlugAndPlayDoctorCheck> {
  const packageJson = await readJson(path.join(root, "package.json"));
  const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const startScript = await readText(path.join(root, "scripts/rehearsal-start.sh"));
  const problems: string[] = [];

  if (scripts["rehearsal:start"] !== "bash scripts/rehearsal-start.sh") {
    problems.push("package.json scripts.rehearsal:start must point at bash scripts/rehearsal-start.sh");
  }
  if (!startScript) {
    problems.push("scripts/rehearsal-start.sh is missing");
  } else {
    for (const signal of [
      "set -euo pipefail",
      ".tmp/rehearsal-data",
      "SEEKR_EXPECTED_SOURCES",
      "select_free_port",
      "port_is_busy",
      "SEEKR_API_PORT",
      "SEEKR_CLIENT_PORT",
      "PORT and SEEKR_API_PORT disagree",
      "auto-selected free local",
      "mavlink:telemetry:drone-1",
      "ros2-slam:map",
      "lidar-slam:lidar",
      "isaac-nvblox:costmap",
      "npm run setup:local",
      "npm run ai:prepare",
      "npm run audit:source-control",
      "npm run doctor",
      "exec npm run dev"
    ]) {
      if (!startScript.includes(signal)) problems.push(`scripts/rehearsal-start.sh missing ${signal}`);
    }
    const setupIndex = startScript.indexOf("npm run setup:local");
    const aiPrepareIndex = startScript.indexOf("npm run ai:prepare");
    const sourceControlIndex = startScript.indexOf("npm run audit:source-control");
    const doctorIndex = startScript.indexOf("npm run doctor");
    const devIndex = startScript.indexOf("exec npm run dev");
    if (
      setupIndex === -1 ||
      aiPrepareIndex === -1 ||
      sourceControlIndex === -1 ||
      doctorIndex === -1 ||
      devIndex === -1 ||
      setupIndex > aiPrepareIndex ||
      aiPrepareIndex > sourceControlIndex ||
      sourceControlIndex > doctorIndex ||
      doctorIndex > devIndex
    ) {
      problems.push("scripts/rehearsal-start.sh must run npm run setup:local before npm run ai:prepare before npm run audit:source-control before npm run doctor before exec npm run dev");
    }
  }

  return {
    id: "operator-start",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "npm run rehearsal:start is wired to a local wrapper that sets rehearsal defaults, normalizes API/client port environment, auto-selects free local ports when unconfigured defaults are occupied, runs safe setup, refreshes source-control handoff evidence, runs doctor preflight, and then launches npm run dev.",
    evidence: ["package.json scripts.rehearsal:start", "scripts/rehearsal-start.sh"]
  };
}

async function envSetupCheck(root: string, rawEnv: NodeJS.ProcessEnv, effectiveEnv: Map<string, string>): Promise<PlugAndPlayDoctorCheck> {
  const envExample = await readText(path.join(root, ".env.example"));
  const missingSignals = REQUIRED_ENV_SIGNALS.filter((signal) => !envExample.includes(signal));
  const requestedFile = rawEnv.SEEKR_ENV_FILE ?? ".env";
  const envPath = path.isAbsolute(requestedFile) ? path.resolve(requestedFile) : path.resolve(root, requestedFile);
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!envExample) problems.push(".env.example is missing");
  if (missingSignals.length) problems.push(`.env.example is missing ${missingSignals.join(", ")}`);
  if (rawEnv.SEEKR_LOAD_DOTENV === "false") warnings.push("SEEKR_LOAD_DOTENV=false; local .env loading is disabled for this shell");
  if (!isInsideRoot(root, envPath)) problems.push(`SEEKR_ENV_FILE must stay inside the project root: ${requestedFile}`);
  else if (rawEnv.SEEKR_ENV_FILE && !(await pathExists(envPath))) warnings.push(`${path.relative(root, envPath)} does not exist; built-in defaults and shell environment will be used`);
  if ((effectiveEnv.get("SEEKR_AI_PROVIDER") ?? "ollama") !== "ollama") problems.push("SEEKR_AI_PROVIDER must be ollama for local AI plug-and-play readiness");

  return {
    id: "operator-env",
    status: problems.length ? "fail" : warnings.length ? "warn" : "pass",
    details: [...problems, ...warnings].join("; ") || "Operator environment defaults point at local Ollama and project-local env loading.",
    evidence: [".env.example", requestedFile]
  };
}

async function localAiCheck(effectiveEnv: Map<string, string>, fetchImpl: typeof fetch) {
  const provider = effectiveEnv.get("SEEKR_AI_PROVIDER") ?? "ollama";
  const model = effectiveEnv.get("SEEKR_OLLAMA_MODEL") ?? DEFAULT_OLLAMA_MODEL;
  const url = effectiveEnv.get("SEEKR_OLLAMA_URL") ?? DEFAULT_OLLAMA_URL;
  const timeoutMs = Number(effectiveEnv.get("SEEKR_OLLAMA_TIMEOUT_MS") ?? 20000);
  const availableModels: string[] = [];

  if (provider !== "ollama") {
    return {
      provider,
      model,
      availableModels,
      check: {
        id: "local-ai",
        status: "fail" as const,
        details: `SEEKR_AI_PROVIDER=${provider}; local plug-and-play AI requires ollama.`,
        evidence: ["SEEKR_AI_PROVIDER"]
      }
    };
  }

  try {
    const response = await fetchWithTimeout(fetchImpl, `${url}/api/tags`, timeoutMs);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    for (const candidate of body.models ?? []) {
      if (candidate.name) availableModels.push(candidate.name);
    }
    const hasModel = availableModels.includes(model);
    return {
      provider,
      model,
      availableModels,
      check: {
        id: "local-ai",
        status: hasModel ? "pass" as const : "fail" as const,
        details: hasModel
          ? `Ollama is reachable at ${url} and has ${model}.`
          : `Ollama is reachable at ${url}, but ${model} is not installed.`,
        evidence: [`${url}/api/tags`, "SEEKR_OLLAMA_MODEL"]
      }
    };
  } catch (error) {
    return {
      provider,
      model,
      availableModels,
      check: {
        id: "local-ai",
        status: "fail" as const,
        details: `Ollama preflight failed at ${url}: ${error instanceof Error ? error.message : String(error)}.`,
        evidence: [`${url}/api/tags`, "SEEKR_OLLAMA_URL"]
      }
    };
  }
}

async function localPortCheck(
  effectiveEnv: Map<string, string>,
  rawEnv: NodeJS.ProcessEnv,
  portAvailable: (port: number, host: string) => Promise<boolean>,
  fetchImpl: typeof fetch,
  portInspector: (port: number, host: string) => Promise<PortListenerDiagnostic[]>,
  startWrapperAutoFallbackAvailable: boolean,
  freePort: (host: string) => Promise<number>
) {
  const host = "127.0.0.1";
  const api = parsePort(effectiveEnv.get("SEEKR_API_PORT") ?? effectiveEnv.get("PORT"), 8787);
  const client = parsePort(effectiveEnv.get("SEEKR_CLIENT_PORT"), 5173);
  const apiExplicit = Boolean(rawEnv.PORT || rawEnv.SEEKR_API_PORT);
  const clientExplicit = Boolean(rawEnv.SEEKR_CLIENT_PORT);
  const occupied: Array<{ role: "api" | "client"; port: number; healthy: boolean; url: string; listeners: PortListenerDiagnostic[] }> = [];
  for (const candidate of [
    { role: "api" as const, port: api },
    { role: "client" as const, port: client }
  ]) {
    if (!(await portAvailable(candidate.port, host))) {
      const [probe, listeners] = await Promise.all([
        probeOccupiedSeekrPort(candidate.role, candidate.port, host, fetchImpl),
        portInspector(candidate.port, host)
      ]);
      occupied.push({ ...probe, listeners });
    }
  }
  const unknown = occupied.filter((item) => !item.healthy);
  const listenerDetails = unknown.flatMap((item) =>
    item.listeners.map((listener) => `${item.role} ${item.port} -> ${formatPortListener(listener)}`)
  );
  const listenerEvidence = occupied.flatMap((item) => [
    `lsof -nP -iTCP:${item.port} -sTCP:LISTEN`,
    ...item.listeners.map((listener) => listener.cwd ? `listener ${listener.pid} cwd ${listener.cwd}` : `listener ${listener.pid} command ${listener.command}`)
  ]);
  const autoRecoverableDefaults = startWrapperAutoFallbackAvailable && unknown.length > 0 && unknown.every((item) =>
    (item.role === "api" && item.port === 8787 && !apiExplicit) ||
    (item.role === "client" && item.port === 5173 && !clientExplicit)
  );
  const fallbackPorts: { fallbackApi?: number; fallbackClient?: number } = autoRecoverableDefaults
    ? await fallbackPortCandidates({ api, client, unknown, host, freePort })
    : {};
  const fallbackDetails = fallbackPorts.fallbackApi !== undefined || fallbackPorts.fallbackClient !== undefined
    ? ` Current free fallback candidate(s): API ${fallbackPorts.fallbackApi ?? api}, client ${fallbackPorts.fallbackClient ?? client}; npm run rehearsal:start prints the actual URLs it selects at startup.`
    : "";
  const fallbackEvidence = [
    fallbackPorts.fallbackApi !== undefined ? `fallback API port candidate ${fallbackPorts.fallbackApi}` : undefined,
    fallbackPorts.fallbackClient !== undefined ? `fallback client port candidate ${fallbackPorts.fallbackClient}` : undefined
  ].filter(isString);
  return {
    ports: { api, client, ...fallbackPorts },
    check: {
      id: "local-ports",
      status: unknown.length && !autoRecoverableDefaults ? "warn" as const : "pass" as const,
      details: unknown.length
        ? autoRecoverableDefaults
          ? `Default port(s) already in use on ${host} by a non-SEEKR or unhealthy listener: ${unknown.map((item) => `${item.role} ${item.port}`).join(", ")}. ${listenerDetails.length ? `Listener diagnostics: ${listenerDetails.join("; ")}. ` : "Listener process diagnostics unavailable. "}npm run rehearsal:start auto-selects free local API/client ports when no explicit port variables are set; stop the existing process only if you want SEEKR to use the default port(s).${fallbackDetails}`
          : `Port(s) already in use on ${host} by a non-SEEKR or unhealthy listener: ${unknown.map((item) => `${item.role} ${item.port}`).join(", ")}. ${listenerDetails.length ? `Listener diagnostics: ${listenerDetails.join("; ")}. ` : "Listener process diagnostics unavailable. "}Stop the existing process or choose different explicit ports before starting SEEKR.`
        : occupied.length
          ? `Port(s) already have a healthy SEEKR local instance on ${host}: ${occupied.map((item) => `${item.role} ${item.port}`).join(", ")}. Keep using it or stop it before starting a fresh npm run dev.`
          : `API/client ports are available on ${host}: ${api}, ${client}.`,
      evidence: [
        "PORT",
        "SEEKR_API_PORT",
        "SEEKR_CLIENT_PORT",
        "scripts/rehearsal-start.sh auto-selected free local API/client ports",
        ...fallbackEvidence,
        ...occupied.map((item) => item.url),
        ...listenerEvidence
      ]
    }
  };
}

async function fallbackPortCandidates(options: {
  api: number;
  client: number;
  unknown: Array<{ role: "api" | "client"; port: number }>;
  host: string;
  freePort: (host: string) => Promise<number>;
}) {
  const occupiedRoles = new Set(options.unknown.map((item) => item.role));
  const reserved = new Set<number>();
  let fallbackApi: number | undefined;
  let fallbackClient: number | undefined;
  if (occupiedRoles.has("api")) {
    fallbackApi = await nextDistinctFreePort(options.host, options.freePort, reserved);
    reserved.add(fallbackApi);
  }
  if (occupiedRoles.has("client")) {
    fallbackClient = await nextDistinctFreePort(options.host, options.freePort, reserved);
    reserved.add(fallbackClient);
  }
  return { fallbackApi, fallbackClient };
}

async function nextDistinctFreePort(host: string, freePort: (host: string) => Promise<number>, reserved: Set<number>) {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    const candidate = await freePort(host);
    if (!reserved.has(candidate)) return candidate;
  }
  throw new Error("Unable to select distinct fallback port candidate");
}

async function probeOccupiedSeekrPort(role: "api" | "client", port: number, host: string, fetchImpl: typeof fetch) {
  const url = role === "api" ? `http://${host}:${port}/api/health` : `http://${host}:${port}/`;
  try {
    const response = await fetchWithTimeout(fetchImpl, url, 1000);
    if (!response.ok) return { role, port, healthy: false, url };
    if (role === "api") {
      const body = await response.json() as unknown;
      return {
        role,
        port,
        healthy: isRecord(body) && body.ok === true && Number(body.schemaVersion) === 1,
        url
      };
    }
    const body = await response.text();
    return {
      role,
      port,
      healthy: body.includes("<title>SEEKR GCS</title>") && body.includes('id="root"'),
      url
    };
  } catch {
    return { role, port, healthy: false, url };
  }
}

async function inspectPortListeners(port: number, _host: string): Promise<PortListenerDiagnostic[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    const listeners = parseLsofListenerRows(stdout);
    return await Promise.all(listeners.map(async (listener) => ({
      ...listener,
      cwd: await listenerCwd(listener.pid)
    })));
  } catch {
    return [];
  }
}

function parseLsofListenerRows(stdout: string): PortListenerDiagnostic[] {
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const pid = Number(parts[1]);
      if (!parts[0] || !Number.isInteger(pid)) return undefined;
      return { command: parts[0], pid };
    })
    .filter((listener): listener is PortListenerDiagnostic => Boolean(listener));
}

async function listenerCwd(pid: number) {
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    const cwd = stdout.split(/\r?\n/).find((line) => line.startsWith("n"))?.slice(1);
    return cwd ? displayPath(cwd) : undefined;
  } catch {
    return undefined;
  }
}

function formatPortListener(listener: PortListenerDiagnostic) {
  return `${listener.command} pid ${listener.pid}${listener.cwd ? ` cwd ${listener.cwd}` : ""}`;
}

function displayPath(value: string) {
  const home = process.env.HOME;
  return home && value.startsWith(`${home}/`) ? `~/${value.slice(home.length + 1)}` : value;
}

async function localDataDirCheck(root: string, effectiveEnv: Map<string, string>): Promise<PlugAndPlayDoctorCheck> {
  const configured = effectiveEnv.get("SEEKR_DATA_DIR") ?? "data";
  const dataDir = path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(root, configured);
  if (!isInsideRoot(root, dataDir)) {
    return {
      id: "data-dir",
      status: "fail",
      details: `SEEKR_DATA_DIR must stay inside the project root for plug-and-play local runs: ${configured}.`,
      evidence: ["SEEKR_DATA_DIR"]
    };
  }
  const exists = await pathExists(dataDir);
  return {
    id: "data-dir",
    status: exists ? "pass" : "warn",
    details: exists
      ? `Local data directory exists at ${path.relative(root, dataDir)}.`
      : `Local data directory ${path.relative(root, dataDir)} does not exist yet; npm run dev will create it on first start.`,
    evidence: ["SEEKR_DATA_DIR", path.relative(root, dataDir)]
  };
}

function safetyBoundaryCheck(effectiveEnv: Map<string, string>): PlugAndPlayDoctorCheck {
  const unsafe = ["SEEKR_COMMAND_UPLOAD_ENABLED", "SEEKR_HARDWARE_ACTUATION_ENABLED"]
    .filter((key) => effectiveEnv.get(key) === "true");
  return {
    id: "safety-boundary",
    status: unsafe.length ? "fail" : "pass",
    details: unsafe.length
      ? `Unsafe local environment flag(s) must not be true: ${unsafe.join(", ")}.`
      : "No local environment flag enables command upload or hardware actuation.",
    evidence: ["SEEKR_COMMAND_UPLOAD_ENABLED", "SEEKR_HARDWARE_ACTUATION_ENABLED"]
  };
}

async function buildEffectiveEnv(root: string, rawEnv: NodeJS.ProcessEnv) {
  const effective = new Map<string, string>();
  const requestedFile = rawEnv.SEEKR_ENV_FILE ?? ".env";
  const envPath = path.isAbsolute(requestedFile) ? path.resolve(requestedFile) : path.resolve(root, requestedFile);

  if (rawEnv.SEEKR_LOAD_DOTENV !== "false" && isInsideRoot(root, envPath)) {
    const content = await readText(envPath);
    for (const [key, value] of parseEnvContent(content)) effective.set(key, value);
  }
  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value === "string") effective.set(key, value);
  }
  return effective;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { method: "GET", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function isPortAvailable(port: number, host: string) {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function selectFreeLocalPort(host: string) {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : undefined;
      server.close(() => {
        if (typeof port === "number") resolve(port);
        else reject(new Error("No local fallback port was selected"));
      });
    });
  });
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function readText(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function latestJson(root: string, relativeDir: string, predicate: (name: string) => boolean) {
  const absoluteDir = path.resolve(root, relativeDir);
  try {
    const files = (await readdir(absoluteDir))
      .filter((name) => name.endsWith(".json") && predicate(name))
      .sort((left, right) => left.localeCompare(right));
    const latest = files.at(-1);
    if (!latest) return undefined;
    const relativePath = path.join(relativeDir, latest).split(path.sep).join("/");
    return { relativePath, absolutePath: path.join(absoluteDir, latest) };
  } catch {
    return undefined;
  }
}

function parsePort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderMarkdown(manifest: PlugAndPlayDoctorManifest) {
  return `${[
    "# SEEKR Plug-And-Play Doctor",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Profile: ${manifest.profile}`,
    `Status: ${manifest.status}`,
    `OK: ${manifest.ok}`,
    "Command upload enabled: false",
    "",
    "AI:",
    "",
    `- Provider: ${manifest.ai.provider}`,
    `- Model: ${manifest.ai.model}`,
    `- Status: ${manifest.ai.status}`,
    manifest.ai.availableModels.length ? `- Available models: ${manifest.ai.availableModels.join(", ")}` : undefined,
    "",
    "Ports:",
    "",
    `- API: ${manifest.ports.api}`,
    `- Client: ${manifest.ports.client}`,
    typeof manifest.ports.fallbackApi === "number" ? `- Fallback API candidate: ${manifest.ports.fallbackApi}` : undefined,
    typeof manifest.ports.fallbackClient === "number" ? `- Fallback client candidate: ${manifest.ports.fallbackClient}` : undefined,
    "",
    "Checks:",
    "",
    "| Check | Status | Details |",
    "| --- | --- | --- |",
    ...manifest.checks.map((check) => `| ${check.id} | ${check.status} | ${escapeTable(check.details)} |`),
    "",
    "Next commands:",
    "",
    ...manifest.nextCommands.map((command) => `- ${command}`),
    "",
    "Limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].filter((line): line is string => typeof line === "string").join("\n")}\n`;
}

function parseArgs(values: string[]) {
  const parsed: Record<string, string | boolean | undefined> = {};
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

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  const result = await writePlugAndPlayDoctor({
    outDir: typeof args.out === "string" ? args.out : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.ok,
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    ai: result.manifest.ai,
    ports: result.manifest.ports,
    summary: result.manifest.summary,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.ok) process.exitCode = 1;
}
