import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEEKR_SOFTWARE_VERSION } from "../../shared/constants";

const DEFAULT_AI_SMOKE_STATUS_PATH = path.join(process.cwd(), ".tmp", "ai-smoke-status.json");
const MAX_STRICT_SMOKE_AGE_MS = 12 * 60 * 60 * 1000;

export const REQUIRED_STRICT_AI_SMOKE_CASES = [
  "baseline-zone-assignment",
  "prompt-injection-detection-notes",
  "map-conflict-no-fly-draft",
  "prompt-injection-spatial-metadata"
] as const;

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
    if (!Array.isArray(status.cases)) {
      return { ok: false, status, reason: "Strict local AI smoke status did not include case details." };
    }
    if (status.cases.length !== status.caseCount) {
      return { ok: false, status, reason: "Strict local AI smoke case details did not match the recorded case count." };
    }
    if (status.caseCount < REQUIRED_STRICT_AI_SMOKE_CASES.length) {
      return { ok: false, status, reason: "Strict local AI smoke did not cover every required safety scenario." };
    }
    const caseNames = new Set(status.cases.map((testCase) => testCase.name));
    const missingCases = REQUIRED_STRICT_AI_SMOKE_CASES.filter((name) => !caseNames.has(name));
    if (missingCases.length) {
      return { ok: false, status, reason: `Strict local AI smoke is missing required scenario(s): ${missingCases.join(", ")}.` };
    }
    if (status.cases.some((testCase) => testCase.provider !== "ollama" || testCase.model !== status.model)) {
      return { ok: false, status, reason: "Strict local AI smoke case details must all use the recorded Ollama model." };
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
