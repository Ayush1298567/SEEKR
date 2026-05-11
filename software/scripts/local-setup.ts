import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";

type SetupStatus = "pass" | "fail";

interface LocalSetupCheck {
  id: string;
  status: SetupStatus;
  details: string;
  evidence: string[];
}

interface LocalSetupManifest {
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  status: "ready-local-setup" | "blocked-local-setup";
  commandUploadEnabled: false;
  envFilePath: string;
  envCreated: boolean;
  envAlreadyExisted: boolean;
  dataDirPath: string;
  checks: LocalSetupCheck[];
  nextCommands: string[];
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/plug-and-play-setup";
const DEFAULT_ENV_FILE = ".env";
const DEFAULT_DATA_DIR = ".tmp/rehearsal-data";
const REQUIRED_ENV_SIGNALS = [
  "SEEKR_AI_PROVIDER=ollama",
  "SEEKR_OLLAMA_URL=http://127.0.0.1:11434",
  "SEEKR_OLLAMA_MODEL=llama3.2:latest",
  "SEEKR_OLLAMA_TIMEOUT_MS=20000"
];

export async function writeLocalSetup(options: {
  root?: string;
  generatedAt?: string;
  outDir?: string;
  envFile?: string;
  dataDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const envFile = options.envFile ?? DEFAULT_ENV_FILE;
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const safeTimestamp = safeIsoTimestampForFileName(generatedAt);
  const envTarget = resolveProjectPath(root, envFile);
  const dataTarget = resolveProjectPath(root, dataDir);
  const checks: LocalSetupCheck[] = [];
  let envCreated = false;
  let envAlreadyExisted = false;

  const envExamplePath = path.join(root, ".env.example");
  const envExample = await readText(envExamplePath);
  const envExampleProblems = REQUIRED_ENV_SIGNALS.filter((signal) => !envExample.includes(signal));
  checks.push({
    id: "env-example",
    status: envExample && envExampleProblems.length === 0 ? "pass" : "fail",
    details: envExample
      ? envExampleProblems.length
        ? `.env.example is missing required local AI signal(s): ${envExampleProblems.join(", ")}.`
        : ".env.example contains the local Ollama plug-and-play defaults."
      : ".env.example is missing.",
    evidence: [".env.example"]
  });

  if (!envTarget.ok) {
    checks.push({
      id: "env-file",
      status: "fail",
      details: envTarget.problem,
      evidence: [envFile]
    });
  } else if (await pathExists(envTarget.absolutePath)) {
    envAlreadyExisted = true;
    checks.push({
      id: "env-file",
      status: "pass",
      details: `${envTarget.relativePath} already exists and was not overwritten.`,
      evidence: [envTarget.relativePath]
    });
  } else if (!envExample) {
    checks.push({
      id: "env-file",
      status: "fail",
      details: `Cannot create ${envTarget.relativePath} because .env.example is missing.`,
      evidence: [".env.example", envTarget.relativePath]
    });
  } else {
    await mkdir(path.dirname(envTarget.absolutePath), { recursive: true });
    await writeFile(envTarget.absolutePath, envExample, { encoding: "utf8", flag: "wx" });
    envCreated = true;
    checks.push({
      id: "env-file",
      status: "pass",
      details: `Created ${envTarget.relativePath} from .env.example without overwriting an existing file.`,
      evidence: [".env.example", envTarget.relativePath]
    });
  }

  if (!dataTarget.ok) {
    checks.push({
      id: "rehearsal-data-dir",
      status: "fail",
      details: dataTarget.problem,
      evidence: [dataDir]
    });
  } else {
    await mkdir(dataTarget.absolutePath, { recursive: true });
    checks.push({
      id: "rehearsal-data-dir",
      status: "pass",
      details: `Prepared project-local rehearsal data directory at ${dataTarget.relativePath}.`,
      evidence: [dataTarget.relativePath]
    });
  }

  const envContent = envTarget.ok && await pathExists(envTarget.absolutePath)
    ? await readText(envTarget.absolutePath)
    : envExample;
  const unsafeFlags = [
    "SEEKR_COMMAND_UPLOAD_ENABLED=true",
    "SEEKR_HARDWARE_ACTUATION_ENABLED=true"
  ].filter((signal) => envContent.includes(signal));
  checks.push({
    id: "safety-boundary",
    status: unsafeFlags.length ? "fail" : "pass",
    details: unsafeFlags.length
      ? `Local setup must not enable unsafe flag(s): ${unsafeFlags.join(", ")}.`
      : "Local setup does not enable command upload or hardware actuation.",
    evidence: [envTarget.ok ? envTarget.relativePath : envFile, ".env.example"]
  });

  const ok = checks.every((check) => check.status === "pass");
  const manifest: LocalSetupManifest = {
    schemaVersion: 1,
    generatedAt,
    ok,
    status: ok ? "ready-local-setup" : "blocked-local-setup",
    commandUploadEnabled: false,
    envFilePath: envTarget.ok ? envTarget.relativePath : envFile,
    envCreated,
    envAlreadyExisted,
    dataDirPath: dataTarget.ok ? dataTarget.relativePath : dataDir,
    checks,
    nextCommands: ok
      ? ["npm run ai:prepare", "npm run doctor", "npm run rehearsal:start"]
      : ["Fix failed local setup checks, then rerun npm run setup:local."],
    limitations: [
      "This setup command prepares local files only; use npm run ai:prepare to prepare the local Ollama model.",
      "It does not validate actual Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware-actuation policy approval.",
      "Real command upload and hardware actuation remain disabled."
    ]
  };

  const baseName = `seekr-local-setup-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);
  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function resolveProjectPath(root: string, requested: string) {
  const absolutePath = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
  if (!isInsideRoot(root, absolutePath)) {
    return {
      ok: false as const,
      absolutePath,
      relativePath: requested,
      problem: `${requested} must stay inside the project root.`
    };
  }
  return {
    ok: true as const,
    absolutePath,
    relativePath: path.relative(root, absolutePath) || "."
  };
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

function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderMarkdown(manifest: LocalSetupManifest) {
  return `${[
    "# SEEKR Local Setup",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `OK: ${manifest.ok}`,
    "Command upload enabled: false",
    `Env file: ${manifest.envFilePath}`,
    `Env created: ${manifest.envCreated}`,
    `Env already existed: ${manifest.envAlreadyExisted}`,
    `Data directory: ${manifest.dataDirPath}`,
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
  ].join("\n")}\n`;
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
  writeLocalSetup({
    outDir: typeof args.outDir === "string" ? args.outDir : undefined,
    envFile: typeof args.envFile === "string" ? args.envFile : undefined,
    dataDir: typeof args.dataDir === "string" ? args.dataDir : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  }).then((result) => {
    console.log(JSON.stringify({
      ok: result.manifest.ok,
      status: result.manifest.status,
      commandUploadEnabled: result.manifest.commandUploadEnabled,
      envFilePath: result.manifest.envFilePath,
      envCreated: result.manifest.envCreated,
      envAlreadyExisted: result.manifest.envAlreadyExisted,
      dataDirPath: result.manifest.dataDirPath,
      jsonPath: result.jsonPath,
      markdownPath: result.markdownPath
    }, null, 2));
    process.exit(result.manifest.ok ? 0 : 1);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
