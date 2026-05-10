import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

const DEFAULT_OUT_DIR = ".tmp/plug-and-play-doctor";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2:latest";

const REQUIRED_SCRIPTS = [
  "doctor",
  "setup:local",
  "dev",
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
} = {}): Promise<PlugAndPlayDoctorManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const env = options.env ?? process.env;
  const effectiveEnv = await buildEffectiveEnv(root, env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const portAvailable = options.portAvailable ?? isPortAvailable;

  const packageScripts = await packageScriptCheck(root);
  const runtimeDependencies = await runtimeDependencyCheck(root);
  const repositorySafety = await repositorySafetyCheck(root);
  const sourceControlHandoff = await sourceControlHandoffCheck(root);
  const operatorStart = await operatorStartScriptCheck(root);
  const envCheck = await envSetupCheck(root, env, effectiveEnv);
  const aiCheck = await localAiCheck(effectiveEnv, fetchImpl);
  const portCheck = await localPortCheck(effectiveEnv, portAvailable);
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
      ? ["npm run rehearsal:start", "npm run audit:plug-and-play"]
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
      "mavlink:telemetry:drone-1",
      "ros2-slam:map",
      "lidar-slam:lidar",
      "isaac-nvblox:costmap",
      "npm run setup:local",
      "npm run audit:source-control",
      "npm run doctor",
      "exec npm run dev"
    ]) {
      if (!startScript.includes(signal)) problems.push(`scripts/rehearsal-start.sh missing ${signal}`);
    }
    const setupIndex = startScript.indexOf("npm run setup:local");
    const sourceControlIndex = startScript.indexOf("npm run audit:source-control");
    const doctorIndex = startScript.indexOf("npm run doctor");
    const devIndex = startScript.indexOf("exec npm run dev");
    if (
      setupIndex === -1 ||
      sourceControlIndex === -1 ||
      doctorIndex === -1 ||
      devIndex === -1 ||
      setupIndex > sourceControlIndex ||
      sourceControlIndex > doctorIndex ||
      doctorIndex > devIndex
    ) {
      problems.push("scripts/rehearsal-start.sh must run npm run setup:local before npm run audit:source-control before npm run doctor before exec npm run dev");
    }
  }

  return {
    id: "operator-start",
    status: problems.length ? "fail" : "pass",
    details: problems.length
      ? problems.join("; ")
      : "npm run rehearsal:start is wired to a local wrapper that sets rehearsal defaults, runs safe setup, refreshes source-control handoff evidence, runs doctor preflight, and then launches npm run dev.",
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

async function localPortCheck(effectiveEnv: Map<string, string>, portAvailable: (port: number, host: string) => Promise<boolean>) {
  const host = "127.0.0.1";
  const api = parsePort(effectiveEnv.get("SEEKR_API_PORT") ?? effectiveEnv.get("PORT"), 8787);
  const client = parsePort(effectiveEnv.get("SEEKR_CLIENT_PORT"), 5173);
  const unavailable: number[] = [];
  for (const port of [api, client]) {
    if (!(await portAvailable(port, host))) unavailable.push(port);
  }
  return {
    ports: { api, client },
    check: {
      id: "local-ports",
      status: unavailable.length ? "warn" as const : "pass" as const,
      details: unavailable.length
        ? `Port(s) already in use on ${host}: ${unavailable.join(", ")}. Stop the existing process before starting a fresh npm run dev, or keep using the already-running SEEKR instance.`
        : `API/client ports are available on ${host}: ${api}, ${client}.`,
      evidence: ["PORT", "SEEKR_API_PORT", "SEEKR_CLIENT_PORT"]
    }
  };
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

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderMarkdown(manifest: PlugAndPlayDoctorManifest) {
  return `${[
    "# SEEKR Plug-And-Play Doctor",
    "",
    `Generated at: ${manifest.generatedAt}`,
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
