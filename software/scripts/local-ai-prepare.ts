import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";

type LocalAiPrepareStatus = "pass" | "fail";

export interface LocalAiPrepareCheck {
  id: string;
  status: LocalAiPrepareStatus;
  details: string;
  evidence: string[];
}

export interface LocalAiPrepareManifest {
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  status: "ready-local-ai-model" | "blocked-local-ai-model";
  commandUploadEnabled: false;
  provider: "ollama";
  model: string;
  pullModel: string;
  pullAttempted: boolean;
  prepareCommand: string[];
  checks: LocalAiPrepareCheck[];
  nextCommands: string[];
  limitations: string[];
}

type ExecFileImpl = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);
const DEFAULT_OUT_DIR = ".tmp/local-ai-prepare";
const DEFAULT_OLLAMA_MODEL = "llama3.2:latest";
const DEFAULT_OLLAMA_COMMAND = "ollama";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export async function buildLocalAiPrepare(options: {
  root?: string;
  generatedAt?: string;
  model?: string;
  ollamaCommand?: string;
  timeoutMs?: number;
  checkOnly?: boolean;
  env?: NodeJS.ProcessEnv;
  execFileImpl?: ExecFileImpl;
} = {}): Promise<LocalAiPrepareManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const env = options.env ?? process.env;
  const model = options.model ?? env.SEEKR_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
  const pullModel = normalizePullModel(model);
  const ollamaCommand = options.ollamaCommand ?? DEFAULT_OLLAMA_COMMAND;
  const prepareCommand = [ollamaCommand, "pull", pullModel];
  const execImpl = options.execFileImpl ?? defaultExecFile;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checks: LocalAiPrepareCheck[] = [];
  let pullAttempted = false;

  if (!isSafeOllamaModelArgument(model) || !isSafeOllamaModelArgument(pullModel)) {
    checks.push({
      id: "ollama-model-prep",
      status: "fail",
      details: "Refusing unsafe Ollama model argument; model names must be a single non-option argument without whitespace or control characters.",
      evidence: ["package.json scripts.ai:prepare", prepareCommand.join(" ")]
    });
  } else if (options.checkOnly) {
    checks.push({
      id: "ollama-model-prep",
      status: "pass",
      details: `Check-only mode recorded the required model preparation command: ${prepareCommand.join(" ")}.`,
      evidence: ["package.json scripts.ai:prepare", prepareCommand.join(" ")]
    });
  } else {
    pullAttempted = true;
    try {
      const result = await execImpl(ollamaCommand, ["pull", pullModel], {
        cwd: root,
        timeout,
        env,
        maxBuffer: 4 * 1024 * 1024
      });
      checks.push({
        id: "ollama-model-prep",
        status: "pass",
        details: compactOutput(result.stdout, result.stderr) || `${prepareCommand.join(" ")} completed successfully.`,
        evidence: ["package.json scripts.ai:prepare", prepareCommand.join(" ")]
      });
    } catch (error) {
      checks.push({
        id: "ollama-model-prep",
        status: "fail",
        details: compactError(error) || `${prepareCommand.join(" ")} failed; install/start Ollama and rerun npm run ai:prepare.`,
        evidence: ["package.json scripts.ai:prepare", prepareCommand.join(" ")]
      });
    }
  }

  const ok = checks.every((check) => check.status === "pass");
  return {
    schemaVersion: 1,
    generatedAt,
    ok,
    status: ok ? "ready-local-ai-model" : "blocked-local-ai-model",
    commandUploadEnabled: false,
    provider: "ollama",
    model,
    pullModel,
    pullAttempted,
    prepareCommand,
    checks,
    nextCommands: ok
      ? ["npm run doctor", "npm run test:ai:local", "npm run rehearsal:start"]
      : ["Install/start Ollama, then rerun npm run ai:prepare."],
    limitations: [
      "This command prepares the local Ollama model only.",
      "It does not generate AI command payloads, bypass operator validation, validate hardware, or enable command upload.",
      "Real command upload and hardware actuation remain disabled."
    ]
  };
}

export async function writeLocalAiPrepare(options: Parameters<typeof buildLocalAiPrepare>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildLocalAiPrepare(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-local-ai-prepare-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

export function localAiPrepareManifestOk(manifest: unknown) {
  if (!isRecord(manifest)) return false;
  const checks = Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  const prepareCommand = Array.isArray(manifest.prepareCommand) ? manifest.prepareCommand.map(String) : [];
  const prepareCommandText = prepareCommand.join(" ");
  const model = typeof manifest.model === "string" && manifest.model.length > 0 ? manifest.model : undefined;
  const pullModel = typeof manifest.pullModel === "string" && manifest.pullModel.length > 0 ? manifest.pullModel : undefined;
  return manifest.ok === true &&
    manifest.status === "ready-local-ai-model" &&
    manifest.commandUploadEnabled === false &&
    manifest.provider === "ollama" &&
    model !== undefined &&
    pullModel !== undefined &&
    manifest.pullAttempted === true &&
    isSafeOllamaModelArgument(model) &&
    isSafeOllamaModelArgument(pullModel) &&
    prepareCommand.length === 3 &&
    isOllamaCommand(prepareCommand[0]) &&
    prepareCommand[1] === "pull" &&
    prepareCommand[2] === pullModel &&
    checks.some((check) =>
      check.id === "ollama-model-prep" &&
      check.status === "pass" &&
      Array.isArray(check.evidence) &&
      check.evidence.some((item) => item === "package.json scripts.ai:prepare") &&
      check.evidence.some((item) => item === prepareCommandText)
    );
}

export function localAiPrepareMatchesAcceptanceModel(manifest: unknown, acceptance: unknown) {
  if (!localAiPrepareManifestOk(manifest) || !isRecord(manifest) || !isRecord(acceptance)) return false;
  const strictLocalAi = isRecord(acceptance.strictLocalAi) ? acceptance.strictLocalAi : undefined;
  if (!strictLocalAi || strictLocalAi.ok !== true || strictLocalAi.provider !== "ollama") return false;
  const acceptedModel = typeof strictLocalAi.model === "string" && strictLocalAi.model.length > 0 ? strictLocalAi.model : undefined;
  if (!acceptedModel) return false;
  const preparedModel = typeof manifest.model === "string" ? manifest.model : undefined;
  const preparedPullModel = typeof manifest.pullModel === "string" ? manifest.pullModel : undefined;
  const prepareCommand = Array.isArray(manifest.prepareCommand) ? manifest.prepareCommand.map(String) : [];
  const expectedPullModel = normalizePullModel(acceptedModel);
  return preparedModel === acceptedModel &&
    preparedPullModel === expectedPullModel &&
    prepareCommand.at(-1) === expectedPullModel;
}

function normalizePullModel(model: string) {
  return model === DEFAULT_OLLAMA_MODEL ? "llama3.2" : model;
}

function isSafeOllamaModelArgument(value: string | undefined) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !value.startsWith("-") &&
    !/[\s\x00-\x1f\x7f]/.test(value);
}

function isOllamaCommand(command: string | undefined) {
  if (!command) return false;
  return command === DEFAULT_OLLAMA_COMMAND ||
    (path.isAbsolute(command) && path.basename(command) === DEFAULT_OLLAMA_COMMAND);
}

async function defaultExecFile(
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number }
) {
  const result = await execFileAsync(file, args, options);
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

function compactOutput(stdout: string, stderr: string) {
  return compactLines([stdout, stderr].filter(Boolean).join("\n"));
}

function compactError(error: unknown) {
  const record = isRecord(error) ? error : {};
  const output = [
    record.message,
    record.stdout,
    record.stderr
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join("\n");
  return compactLines(output);
}

function compactLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderMarkdown(manifest: LocalAiPrepareManifest) {
  return `${[
    "# SEEKR Local AI Prepare",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `OK: ${manifest.ok}`,
    "Command upload enabled: false",
    `Provider: ${manifest.provider}`,
    `Model: ${manifest.model}`,
    `Prepare command: ${manifest.prepareCommand.join(" ")}`,
    `Pull attempted: ${manifest.pullAttempted}`,
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
  writeLocalAiPrepare({
    model: typeof args.model === "string" ? args.model : undefined,
    ollamaCommand: typeof args["ollama-command"] === "string" ? args["ollama-command"] : undefined,
    outDir: typeof args.out === "string" ? args.out : undefined,
    checkOnly: args["check-only"] === true,
    timeoutMs: typeof args.timeoutMs === "string" ? Number(args.timeoutMs) : undefined
  }).then((result) => {
    console.log(JSON.stringify({
      ok: result.manifest.ok,
      status: result.manifest.status,
      commandUploadEnabled: result.manifest.commandUploadEnabled,
      model: result.manifest.model,
      pullModel: result.manifest.pullModel,
      prepareCommand: result.manifest.prepareCommand,
      jsonPath: result.jsonPath,
      markdownPath: result.markdownPath
    }, null, 2));
    if (!result.manifest.ok) process.exitCode = 1;
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
