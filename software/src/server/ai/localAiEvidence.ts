import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEEKR_SOFTWARE_VERSION } from "../../shared/constants";

const DEFAULT_AI_SMOKE_STATUS_PATH = path.join(process.cwd(), ".tmp", "ai-smoke-status.json");
const MAX_STRICT_SMOKE_AGE_MS = 12 * 60 * 60 * 1000;

export interface StrictAiSmokeCase {
  name: string;
  provider: string;
  model: string;
  elapsedMs: number;
  mutatedWhileThinking: boolean;
}

export interface StrictAiSmokeStatus {
  ok: boolean;
  generatedAt: number;
  softwareVersion: string;
  provider: string;
  model: string;
  requireOllama: boolean;
  caseCount: number;
  cases: StrictAiSmokeCase[];
}

export interface StrictAiSmokeEvidence {
  ok: boolean;
  status?: StrictAiSmokeStatus;
  reason?: string;
}

export function aiSmokeStatusPath() {
  return process.env.SEEKR_AI_SMOKE_STATUS_PATH ?? DEFAULT_AI_SMOKE_STATUS_PATH;
}

export async function writeStrictAiSmokeStatus(status: StrictAiSmokeStatus, filePath = aiSmokeStatusPath()) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function readStrictAiSmokeEvidence(nowMs = Date.now(), filePath = aiSmokeStatusPath()): Promise<StrictAiSmokeEvidence> {
  try {
    const status = JSON.parse(await readFile(filePath, "utf8")) as StrictAiSmokeStatus;
    if (!status.ok) return { ok: false, status, reason: "Strict local AI smoke status recorded a failure." };
    if (status.softwareVersion !== SEEKR_SOFTWARE_VERSION) {
      return { ok: false, status, reason: `Strict local AI smoke was run on ${status.softwareVersion}, current build is ${SEEKR_SOFTWARE_VERSION}.` };
    }
    if (nowMs - status.generatedAt > MAX_STRICT_SMOKE_AGE_MS) {
      return { ok: false, status, reason: "Strict local AI smoke status is older than 12 hours." };
    }
    if (!status.requireOllama || status.provider !== "ollama") {
      return { ok: false, status, reason: "Strict local AI smoke must run with Ollama required." };
    }
    if (status.cases.some((testCase) => testCase.mutatedWhileThinking)) {
      return { ok: false, status, reason: "Strict local AI smoke observed mutation while thinking." };
    }
    return { ok: true, status };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "Strict local AI smoke has not been run for this working session."
        : `Strict local AI smoke status could not be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
