import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REQUIRED_STRICT_AI_SMOKE_CASES, isLocalOllamaUrl } from "./ai/localAiEvidence";
import { SEEKR_SCHEMA_VERSION, SEEKR_SOFTWARE_VERSION } from "../shared/constants";

export const REQUIRED_ACCEPTANCE_COMMANDS = [
  "npm run check",
  "npm run bench:edge",
  "npm run bench:flight",
  "npm run bench:sitl",
  "npm run bench:sitl:io -- --fixture px4-process-io",
  "npm run bench:sitl:io -- --fixture ardupilot-process-io",
  "npm run bench:dimos",
  "npm run safety:command-boundary",
  "npm run test:ai:local",
  "npm run test:ui",
  "npm run smoke:preview",
  "npm run smoke:rehearsal:start",
  "npm run release:checksum"
];

const DEFAULT_ACCEPTANCE_STATUS_PATH = path.join(process.cwd(), ".tmp", "acceptance-status.json");
const MAX_ACCEPTANCE_AGE_MS = 12 * 60 * 60 * 1000;

export interface AcceptanceRunStatus {
  ok: boolean;
  generatedAt: number;
  schemaVersion: number;
  softwareVersion: string;
  cwd: string;
  nodeVersion: string;
  platform: string;
  pid: number;
  completedCommands: string[];
  strictLocalAi: {
    ok: boolean;
    provider: string;
    model: string;
    ollamaUrl: string;
    commandUploadEnabled: false;
    caseCount: number;
    caseNames: string[];
    generatedAt: number;
  };
  releaseChecksum: {
    jsonPath: string;
    sha256Path: string;
    markdownPath: string;
    overallSha256: string;
    fileCount: number;
    totalBytes: number;
  };
  commandBoundaryScan: {
    jsonPath: string;
    markdownPath: string;
    status: "pass";
    scannedFileCount: number;
    violationCount: 0;
    allowedFindingCount: number;
    commandUploadEnabled: false;
  };
  commandUploadEnabled: false;
  safetyBoundary: {
    realHardwareCommandUpload: "blocked";
    mavlink: "read-only";
    ros2: "read-only";
    px4ArdupilotHardwareTransport: "blocked";
  };
}

export interface AcceptanceEvidence {
  ok: boolean;
  status: "pass" | "missing" | "stale" | "software-mismatch" | "incomplete" | "unsafe";
  currentBoot: boolean;
  ageMs?: number;
  generatedAt?: number;
  softwareVersion?: string;
  commandCount?: number;
  strictLocalAi?: {
    ok: boolean;
    provider: string;
    model: string;
    ollamaUrl: string;
    commandUploadEnabled: false;
    caseCount: number;
    caseNames: string[];
  };
  releaseChecksum?: {
    overallSha256: string;
    fileCount: number;
    totalBytes: number;
  };
  commandBoundaryScan?: {
    status: "pass";
    scannedFileCount: number;
    violationCount: 0;
    allowedFindingCount: number;
  };
  commandUploadEnabled: false;
  reason?: string;
}

export function acceptanceStatusPath() {
  return process.env.SEEKR_ACCEPTANCE_STATUS_PATH ?? DEFAULT_ACCEPTANCE_STATUS_PATH;
}

export function writeAcceptanceStatus(status: AcceptanceRunStatus, filePath = acceptanceStatusPath()) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export function readAcceptanceEvidence(
  nowMs = Date.now(),
  bootedAt = 0,
  filePath = acceptanceStatusPath()
): AcceptanceEvidence {
  try {
    const status = JSON.parse(readFileSync(filePath, "utf8")) as AcceptanceRunStatus;
    const ageMs = Math.max(0, nowMs - status.generatedAt);
    const currentBoot = status.generatedAt >= bootedAt;
    const missingCommands = REQUIRED_ACCEPTANCE_COMMANDS.filter((command) => !status.completedCommands.includes(command));
    const strictAiCaseNames = Array.isArray(status.strictLocalAi?.caseNames)
      ? status.strictLocalAi.caseNames.map(String)
      : [];
    const missingStrictAiCases = REQUIRED_STRICT_AI_SMOKE_CASES.filter((name) => !strictAiCaseNames.includes(name));
    const base = {
      currentBoot,
      ageMs,
      generatedAt: status.generatedAt,
      softwareVersion: status.softwareVersion,
      commandCount: status.completedCommands.length,
      strictLocalAi: status.strictLocalAi
        ? {
            ok: status.strictLocalAi.ok,
            provider: status.strictLocalAi.provider,
            model: status.strictLocalAi.model,
            ollamaUrl: status.strictLocalAi.ollamaUrl,
            commandUploadEnabled: status.strictLocalAi.commandUploadEnabled,
            caseCount: status.strictLocalAi.caseCount,
            caseNames: strictAiCaseNames
          }
        : undefined,
      releaseChecksum: status.releaseChecksum
        ? {
            overallSha256: status.releaseChecksum.overallSha256,
            fileCount: status.releaseChecksum.fileCount,
            totalBytes: status.releaseChecksum.totalBytes
          }
        : undefined,
      commandBoundaryScan: status.commandBoundaryScan
        ? {
            status: status.commandBoundaryScan.status,
            scannedFileCount: status.commandBoundaryScan.scannedFileCount,
            violationCount: status.commandBoundaryScan.violationCount,
            allowedFindingCount: status.commandBoundaryScan.allowedFindingCount
          }
        : undefined,
      commandUploadEnabled: false as const
    };

    if (!status.ok) {
      return { ok: false, status: "incomplete", ...base, reason: "Acceptance status recorded a failed run." };
    }
    if (status.softwareVersion !== SEEKR_SOFTWARE_VERSION || status.schemaVersion !== SEEKR_SCHEMA_VERSION) {
      return {
        ok: false,
        status: "software-mismatch",
        ...base,
        reason: `Acceptance was recorded for software ${status.softwareVersion}/schema ${status.schemaVersion}; current is ${SEEKR_SOFTWARE_VERSION}/schema ${SEEKR_SCHEMA_VERSION}.`
      };
    }
    if (ageMs > MAX_ACCEPTANCE_AGE_MS) {
      return { ok: false, status: "stale", ...base, reason: "Acceptance status is older than 12 hours." };
    }
    if (missingCommands.length) {
      return {
        ok: false,
        status: "incomplete",
        ...base,
        reason: `Acceptance status is missing required commands: ${missingCommands.join(", ")}.`
      };
    }
    if (strictAiCaseNames.length !== Number(status.strictLocalAi?.caseCount) || missingStrictAiCases.length) {
      return {
        ok: false,
        status: "incomplete",
        ...base,
        reason: missingStrictAiCases.length
          ? `Acceptance status is missing required strict local AI scenario(s): ${missingStrictAiCases.join(", ")}.`
          : "Acceptance status strict local AI case names do not match the recorded case count."
      };
    }
    if (status.strictLocalAi?.provider !== "ollama" || !isLocalOllamaUrl(status.strictLocalAi.ollamaUrl)) {
      return { ok: false, status: "unsafe", ...base, reason: "Acceptance status strict local AI evidence must use a loopback Ollama URL." };
    }
    if (status.strictLocalAi?.commandUploadEnabled !== false) {
      return { ok: false, status: "unsafe", ...base, reason: "Acceptance status strict local AI evidence must preserve commandUploadEnabled false." };
    }
    if (
      status.commandBoundaryScan?.status !== "pass" ||
      status.commandBoundaryScan?.commandUploadEnabled !== false ||
      status.commandBoundaryScan?.violationCount !== 0 ||
      !Number.isFinite(status.commandBoundaryScan?.scannedFileCount) ||
      status.commandBoundaryScan.scannedFileCount <= 0
    ) {
      return { ok: false, status: "unsafe", ...base, reason: "Acceptance status did not preserve passing command-boundary scan evidence." };
    }
    if (
      status.commandUploadEnabled !== false ||
      status.safetyBoundary?.realHardwareCommandUpload !== "blocked" ||
      status.safetyBoundary?.mavlink !== "read-only" ||
      status.safetyBoundary?.ros2 !== "read-only" ||
      status.safetyBoundary?.px4ArdupilotHardwareTransport !== "blocked"
    ) {
      return { ok: false, status: "unsafe", ...base, reason: "Acceptance status did not preserve the command-upload safety boundary." };
    }

    return { ok: true, status: "pass", ...base };
  } catch (error) {
    return {
      ok: false,
      status: "missing",
      currentBoot: false,
      commandUploadEnabled: false,
      reason: error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "Acceptance status has not been recorded for this working session."
        : `Acceptance status could not be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
