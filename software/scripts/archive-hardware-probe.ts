import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";
import { buildHardwareReadinessReport, parseHardwareTarget } from "../src/server/hardwareReadiness";
import { MissionPersistence } from "../src/server/persistence";
import { MissionStore } from "../src/server/state";
import type { HardwareReadinessReport, HardwareTargetId } from "../src/shared/types";

export interface HardwareEvidenceArchive {
  schemaVersion: 1;
  ok: boolean;
  archivedAt: number;
  archivedAtIso: string;
  commandUploadEnabled: false;
  actualHardwareValidationComplete: boolean;
  hardwareValidationScope: "actual-target" | "off-board-readiness";
  targetIds: HardwareTargetId[];
  actualTargetHostValidated: Record<string, boolean>;
  limitations: string[];
  cwd: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  reports: HardwareReadinessReport[];
}

const DEFAULT_OUT_DIR = ".tmp/hardware-evidence";

export async function writeHardwareEvidenceArchive(options: {
  root?: string;
  outDir?: string;
  targets?: HardwareTargetId[];
  archivedAt?: number;
} = {}) {
  const cwd = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(cwd, options.outDir ?? DEFAULT_OUT_DIR);
  const targets = options.targets ?? ["jetson-orin-nano", "raspberry-pi-5"];
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "seekr-hardware-evidence-"));

  try {
    const persistence = new MissionPersistence(tempRoot);
    await persistence.init();
    const store = new MissionStore({ clock: () => Date.now(), eventStore: persistence.events });
    const reports = await Promise.all(targets.map((target) => buildHardwareReadinessReport(target, store, persistence)));
    const archive = createHardwareEvidenceArchive(reports, targets, {
      archivedAt: options.archivedAt,
      cwd
    });
    const timestamp = safeIsoTimestampForFileName(archive.archivedAtIso, "archivedAtIso");
    const targetPart = targets.map((target) => safeFileNamePart(target, "hardware-target")).join("+");
    const baseName = `seekr-hardware-evidence-${targetPart}-${timestamp}`;
    const jsonPath = path.join(outDir, `${baseName}.json`);
    const markdownPath = path.join(outDir, `${baseName}.md`);
    await mkdir(outDir, { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, renderMarkdown(archive), "utf8");
    return { archive, jsonPath, markdownPath };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export function createHardwareEvidenceArchive(
  reports: HardwareReadinessReport[],
  targets: HardwareTargetId[],
  options: { archivedAt?: number; cwd?: string } = {}
): HardwareEvidenceArchive {
  validateHardwareArchiveInputs(reports, targets, options.archivedAt);
  const archivedAt = options.archivedAt ?? Date.now();
  const archivedAtIso = new Date(archivedAt).toISOString();
  const actualTargetHostValidated = Object.fromEntries(
    reports.map((report) => [report.target.id, hostPlatformPassed(report)])
  );
  const actualHardwareValidationComplete = targets.every((target) => actualTargetHostValidated[target] === true);

  return {
    schemaVersion: 1,
    ok: reports.every((report) => report.ok),
    archivedAt,
    archivedAtIso,
    commandUploadEnabled: false,
    actualHardwareValidationComplete,
    hardwareValidationScope: actualHardwareValidationComplete ? "actual-target" : "off-board-readiness",
    targetIds: targets,
    actualTargetHostValidated,
    limitations: actualHardwareValidationComplete
      ? [
          "This archive proves hardware readiness only for the listed target host checks.",
          "It does not enable real MAVLink, ROS 2, or aircraft command upload."
        ]
      : [
          "This archive is an off-board readiness snapshot because at least one target host-platform check did not pass.",
          "It must not be cited as actual Jetson/Pi hardware validation.",
          "It does not enable real MAVLink, ROS 2, or aircraft command upload."
        ],
    cwd: options.cwd ?? process.cwd(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    reports
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

function parseTargets(value: string | boolean | undefined): HardwareTargetId[] {
  if (!value) return ["jetson-orin-nano", "raspberry-pi-5"];
  if (value === true || value === "all") return ["jetson-orin-nano", "raspberry-pi-5"];
  return [parseHardwareTarget(value)];
}

function validateHardwareArchiveInputs(reports: HardwareReadinessReport[], targets: HardwareTargetId[], archivedAt?: number) {
  if (targets.length === 0) throw new Error("Hardware evidence archive requires at least one hardware target.");
  if (reports.length === 0) throw new Error("Hardware evidence archive requires at least one hardware readiness report.");
  for (const target of targets) parseHardwareTarget(target);
  const reportTargets = new Set(reports.map((report) => report.target.id));
  for (const target of targets) {
    if (!reportTargets.has(target)) throw new Error(`Hardware evidence archive is missing a readiness report for target ${target}.`);
  }
  const timestamp = archivedAt ?? Date.now();
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) {
    throw new Error("archivedAt must be a finite timestamp.");
  }
}

function hostPlatformPassed(report: HardwareReadinessReport) {
  return report.checks.some((check) => check.id === "host-platform" && check.status === "pass");
}

function renderMarkdown(archive: HardwareEvidenceArchive) {
  const lines = [
    "# SEEKR Hardware Evidence Archive",
    "",
    `Archived at: ${archive.archivedAtIso}`,
    "",
    "Command upload enabled: false",
    `Actual hardware validation complete: ${archive.actualHardwareValidationComplete}`,
    `Hardware validation scope: ${archive.hardwareValidationScope}`,
    "",
    "Limitations:",
    "",
    ...archive.limitations.map((limitation) => `- ${limitation}`),
    ""
  ];

  for (const report of archive.reports) {
    lines.push(
      `## ${report.target.label}`,
      "",
      `- Target: ${report.target.id}`,
      `- OK: ${report.ok}`,
      `- Actual target host validated: ${archive.actualTargetHostValidated[report.target.id] === true}`,
      `- Host: ${report.host.platform}/${report.host.arch}, Node ${report.host.nodeVersion}`,
      `- Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.blocking} blocking`,
      `- Command upload enabled: ${report.summary.commandUploadEnabled}`,
      "",
      "| Check | Status | Blocking | Details |",
      "| --- | --- | --- | --- |"
    );
    for (const check of report.checks) {
      lines.push(`| ${escapeTable(check.label)} | ${check.status} | ${check.blocking} | ${escapeTable(check.details)} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  const targets = parseTargets(args.target);
  const result = await writeHardwareEvidenceArchive({
    outDir: typeof args.out === "string" ? args.out : undefined,
    targets
  });
  console.log(JSON.stringify({
    ok: result.archive.ok,
    commandUploadEnabled: false,
    actualHardwareValidationComplete: result.archive.actualHardwareValidationComplete,
    hardwareValidationScope: result.archive.hardwareValidationScope,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath,
    targetIds: targets
  }, null, 2));
  if (!result.archive.ok) process.exitCode = 1;
}
