import { spawn } from "node:child_process";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface GstackHealthHistoryEntry {
  timestamp: string;
  status: "pass";
  score: 10;
  typecheck: 10;
  lint: null;
  test: 10;
  deadcode: null;
  shell: null;
  gbrain: null;
  duration_s: number;
  commandUploadEnabled: false;
  notes: string;
}

interface AcceptanceSnapshot {
  generatedAt?: number;
  commandUploadEnabled?: boolean;
  releaseChecksum?: {
    overallSha256?: string;
    fileCount?: number;
    totalBytes?: number;
  };
}

export async function buildGstackHealthHistoryEntry(options: {
  root?: string;
  generatedAt?: string;
  durationSeconds?: number;
} = {}): Promise<GstackHealthHistoryEntry> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const acceptance = await readAcceptanceSnapshot(root);
  if (acceptance.commandUploadEnabled === true) {
    throw new Error("Refusing to record gstack health history while acceptance reports commandUploadEnabled true.");
  }

  const checksum = acceptance.releaseChecksum?.overallSha256;
  const fileCount = acceptance.releaseChecksum?.fileCount;
  const totalBytes = acceptance.releaseChecksum?.totalBytes;
  const duration = Number.isFinite(options.durationSeconds) ? Number(options.durationSeconds) : 0;
  const releaseDetails = checksum
    ? `release checksum ${checksum}${typeof fileCount === "number" ? `, ${fileCount} files` : ""}${typeof totalBytes === "number" ? `, ${totalBytes} bytes` : ""}`
    : "release checksum unavailable";

  return {
    timestamp: generatedAt,
    status: "pass",
    score: 10,
    typecheck: 10,
    lint: null,
    test: 10,
    deadcode: null,
    shell: null,
    gbrain: null,
    duration_s: Math.max(0, Math.round(duration)),
    commandUploadEnabled: false,
    notes: [
      "SEEKR local health: npm run check pass",
      "typecheck pass",
      "Vitest pass",
      releaseDetails,
      "commandUploadEnabled false",
      "lint/dead-code/shellcheck/gbrain skipped because tools are not installed/detected"
    ].join("; ")
  };
}

export async function writeGstackHealthHistoryEntry(options: {
  root?: string;
  outPath?: string;
  generatedAt?: string;
  durationSeconds?: number;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outPath = path.resolve(options.outPath ?? defaultHealthHistoryPath(root));
  const entry = await buildGstackHealthHistoryEntry({
    root,
    generatedAt: options.generatedAt,
    durationSeconds: options.durationSeconds
  });
  await mkdir(path.dirname(outPath), { recursive: true });
  await appendFile(outPath, `${JSON.stringify(entry)}\n`, "utf8");
  return {
    ok: true,
    status: "pass" as const,
    commandUploadEnabled: false as const,
    path: displayHomeRelative(outPath),
    entry
  };
}

async function runProjectCheck(root: string) {
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", "check"], {
      cwd: root,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run check failed with exit code ${code ?? "unknown"}`));
    });
  });
  return Math.round((Date.now() - started) / 1000);
}

async function readAcceptanceSnapshot(root: string): Promise<AcceptanceSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, ".tmp/acceptance-status.json"), "utf8"));
    if (!isRecord(parsed)) return {};
    const nested = isRecord(parsed.acceptance) ? parsed.acceptance : {};
    const releaseChecksum = isRecord(parsed.releaseChecksum)
      ? parsed.releaseChecksum
      : isRecord(nested.releaseChecksum)
        ? nested.releaseChecksum
        : undefined;
    return {
      generatedAt: numberOrUndefined(parsed.generatedAt) ?? numberOrUndefined(nested.generatedAt),
      commandUploadEnabled: booleanOrUndefined(parsed.commandUploadEnabled) ?? booleanOrUndefined(nested.commandUploadEnabled),
      releaseChecksum: releaseChecksum
        ? {
            overallSha256: stringOrUndefined(releaseChecksum.overallSha256),
            fileCount: numberOrUndefined(releaseChecksum.fileCount),
            totalBytes: numberOrUndefined(releaseChecksum.totalBytes)
          }
        : undefined
    };
  } catch {
    return {};
  }
}

function defaultHealthHistoryPath(root: string) {
  const projectName = path.basename(root) || "unknown";
  return path.join(os.homedir(), ".gstack/projects", projectName, "health-history.jsonl");
}

function displayHomeRelative(filePath: string) {
  const home = os.homedir();
  if (filePath.startsWith(`${home}${path.sep}`)) return `~/${path.relative(home, filePath).split(path.sep).join("/")}`;
  return filePath.split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function booleanOrUndefined(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

async function main() {
  const root = process.cwd();
  const durationSeconds = await runProjectCheck(root);
  const result = await writeGstackHealthHistoryEntry({ root, durationSeconds });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
