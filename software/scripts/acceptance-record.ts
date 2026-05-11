import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectInputPath } from "./artifact-paths";
import { readStrictAiSmokeEvidence } from "../src/server/ai/localAiEvidence";
import { readAcceptanceEvidence, REQUIRED_ACCEPTANCE_COMMANDS, writeAcceptanceStatus } from "../src/server/acceptanceEvidence";
import { SEEKR_SCHEMA_VERSION, SEEKR_SOFTWARE_VERSION } from "../src/shared/constants";

interface ReleaseChecksumManifest {
  commandUploadEnabled: false;
  overallSha256: string;
  fileCount: number;
  totalBytes: number;
}

interface CommandBoundaryScanManifest {
  status: "pass" | "fail";
  commandUploadEnabled: false;
  summary?: {
    scannedFileCount?: number;
    violationCount?: number;
    allowedFindingCount?: number;
  };
}

const args = parseArgs(process.argv.slice(2));
const root = process.cwd();
const outPath = acceptanceStatusOutputPath(root, args.out);
const generatedAt = typeof args.generatedAt === "string" ? Number(args.generatedAt) : Date.now();
const releaseDir = resolveProjectInputPath(root, typeof args.releaseDir === "string" ? args.releaseDir : ".tmp/release-evidence", "release evidence directory");
const safetyDir = resolveProjectInputPath(root, typeof args.safetyDir === "string" ? args.safetyDir : ".tmp/safety-evidence", "command-boundary evidence directory");
const releaseEvidence = await latestReleaseEvidence(releaseDir);
const commandBoundaryScan = await latestCommandBoundaryScan(safetyDir);
const strictAi = await readStrictAiSmokeEvidence(generatedAt);

if (!strictAi.ok || !strictAi.status) {
  throw new Error(strictAi.reason ?? "Strict local AI evidence is missing or invalid.");
}
if (releaseEvidence.manifest.commandUploadEnabled !== false) {
  throw new Error("Release checksum evidence must keep commandUploadEnabled false.");
}
if (
  commandBoundaryScan.manifest.status !== "pass" ||
  commandBoundaryScan.manifest.commandUploadEnabled !== false ||
  Number(commandBoundaryScan.manifest.summary?.violationCount) !== 0 ||
  !Number.isFinite(Number(commandBoundaryScan.manifest.summary?.scannedFileCount)) ||
  Number(commandBoundaryScan.manifest.summary?.scannedFileCount) <= 0
) {
  throw new Error("Command-boundary scan evidence must pass with zero violations and commandUploadEnabled false.");
}

writeAcceptanceStatus({
  ok: true,
  generatedAt,
  schemaVersion: SEEKR_SCHEMA_VERSION,
  softwareVersion: SEEKR_SOFTWARE_VERSION,
  cwd: process.cwd(),
  nodeVersion: process.version,
  platform: process.platform,
  pid: process.pid,
  completedCommands: REQUIRED_ACCEPTANCE_COMMANDS,
  strictLocalAi: {
    ok: strictAi.ok,
    provider: strictAi.status.provider,
    model: strictAi.status.model,
    caseCount: strictAi.status.caseCount,
    caseNames: strictAi.status.cases.map((testCase) => testCase.name),
    generatedAt: strictAi.status.generatedAt
  },
  releaseChecksum: {
    jsonPath: releaseEvidence.jsonPath,
    sha256Path: releaseEvidence.sha256Path,
    markdownPath: releaseEvidence.markdownPath,
    overallSha256: releaseEvidence.manifest.overallSha256,
    fileCount: releaseEvidence.manifest.fileCount,
    totalBytes: releaseEvidence.manifest.totalBytes
  },
  commandBoundaryScan: {
    jsonPath: commandBoundaryScan.jsonPath,
    markdownPath: commandBoundaryScan.markdownPath,
    status: "pass",
    scannedFileCount: Number(commandBoundaryScan.manifest.summary?.scannedFileCount) || 0,
    violationCount: 0,
    allowedFindingCount: Number(commandBoundaryScan.manifest.summary?.allowedFindingCount) || 0,
    commandUploadEnabled: false
  },
  commandUploadEnabled: false,
  safetyBoundary: {
    realHardwareCommandUpload: "blocked",
    mavlink: "read-only",
    ros2: "read-only",
    px4ArdupilotHardwareTransport: "blocked"
  }
}, outPath);

console.log(JSON.stringify({
  ok: true,
  acceptance: readAcceptanceEvidence(generatedAt, 0, outPath),
  statusPath: outPath
}, null, 2));

async function latestReleaseEvidence(releaseEvidenceDir: string) {
  const entries = await readdir(releaseEvidenceDir, { withFileTypes: true });
  const jsonNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name.startsWith("seekr-release-"))
    .map((entry) => entry.name)
    .sort();
  const latest = jsonNames.at(-1);
  if (!latest) throw new Error(`No release checksum JSON evidence found in ${releaseEvidenceDir}.`);

  const jsonPath = path.join(releaseEvidenceDir, latest);
  const manifest = JSON.parse(await readFile(jsonPath, "utf8")) as ReleaseChecksumManifest;
  const base = latest.replace(/\.json$/, "");
  return {
    manifest,
    jsonPath,
    sha256Path: path.join(releaseEvidenceDir, `${base}.sha256`),
    markdownPath: path.join(releaseEvidenceDir, `${base}.md`)
  };
}

async function latestCommandBoundaryScan(safetyEvidenceDir: string) {
  const entries = await readdir(safetyEvidenceDir, { withFileTypes: true });
  const jsonNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name.startsWith("seekr-command-boundary-scan-"))
    .map((entry) => entry.name)
    .sort();
  const latest = jsonNames.at(-1);
  if (!latest) throw new Error(`No command-boundary scan JSON evidence found in ${safetyEvidenceDir}.`);

  const jsonPath = path.join(safetyEvidenceDir, latest);
  const manifest = JSON.parse(await readFile(jsonPath, "utf8")) as CommandBoundaryScanManifest;
  const base = latest.replace(/\.json$/, "");
  return {
    manifest,
    jsonPath,
    markdownPath: path.join(safetyEvidenceDir, `${base}.md`)
  };
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

function acceptanceStatusOutputPath(root: string, outArg: string | boolean | undefined) {
  const requestedPath = typeof outArg === "string"
    ? outArg
    : process.env.SEEKR_ACCEPTANCE_STATUS_PATH ?? ".tmp/acceptance-status.json";
  return resolveProjectInputPath(root, requestedPath, "acceptance status output path");
}
