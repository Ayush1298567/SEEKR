import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveArtifactOutDir, safeFileNamePart, safeIsoTimestampForFileName } from "./artifact-paths";

export interface BridgeEvidenceResultShape {
  ok: boolean;
  mode: string;
  dryRun?: boolean;
  commandPreview?: boolean;
  inputCount?: number;
  acceptedCount?: number;
  postedCount?: number;
  rejected?: unknown[];
  errors?: unknown[];
  commandEndpointsTouched: false;
  safety?: Record<string, unknown>;
}

export interface BridgeEvidenceManifest<Result extends BridgeEvidenceResultShape = BridgeEvidenceResultShape> {
  schemaVersion: 1;
  generatedAt: string;
  label: string;
  bridgeMode: string;
  status: "pass" | "blocked";
  commandUploadEnabled: false;
  validation: {
    ok: boolean;
    blockers: string[];
    warnings: string[];
  };
  bridgeResult: Result;
  evidenceSha256: string;
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/bridge-evidence";
const DEFAULT_LIMITATIONS = [
  "This artifact records a SEEKR read-only bridge run or command preview.",
  "It does not validate Jetson/Pi hardware, aircraft command authority, HIL behavior, or source freshness by itself.",
  "Use required-source rehearsal evidence after live capture to prove SEEKR source health observed fresh read-only events."
];

export async function writeBridgeEvidenceArtifact<Result extends BridgeEvidenceResultShape>(options: {
  root?: string;
  outDir?: string;
  label?: string;
  generatedAt?: string;
  result: Result;
  limitations?: string[];
}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = options.label?.trim() || options.result.mode;
  const validation = validateBridgeResult(options.result);
  const manifestWithoutHash = {
    schemaVersion: 1 as const,
    generatedAt,
    label,
    bridgeMode: options.result.mode,
    status: validation.ok ? "pass" as const : "blocked" as const,
    commandUploadEnabled: false as const,
    validation,
    bridgeResult: options.result,
    limitations: [...DEFAULT_LIMITATIONS, ...(options.limitations ?? [])]
  };
  const evidenceSha256 = createHash("sha256").update(JSON.stringify(manifestWithoutHash)).digest("hex");
  const manifest: BridgeEvidenceManifest<Result> = {
    ...manifestWithoutHash,
    evidenceSha256
  };
  const safeTimestamp = safeIsoTimestampForFileName(generatedAt);
  const baseName = `seekr-bridge-evidence-${safeFileNamePart(options.result.mode, "bridge-evidence")}-${safeFileNamePart(label, "bridge-evidence")}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderBridgeEvidenceMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function validateBridgeResult(result: BridgeEvidenceResultShape) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const safety = isRecord(result.safety) ? result.safety : {};

  if (result.ok !== true) blockers.push("Bridge run did not complete successfully; this artifact cannot clear a bench blocker.");
  if (result.commandEndpointsTouched !== false) blockers.push("Bridge result must report commandEndpointsTouched: false.");
  if (safety.commandUploadEnabled !== false) blockers.push("Bridge safety block must report commandUploadEnabled: false.");
  if ("serialWriteOpened" in safety && safety.serialWriteOpened !== false) blockers.push("MAVLink serial evidence must report serialWriteOpened: false.");
  if ("ros2ServicesTouched" in safety && safety.ros2ServicesTouched !== false) blockers.push("ROS 2 live evidence must report ros2ServicesTouched: false.");
  if ("ros2ActionsTouched" in safety && safety.ros2ActionsTouched !== false) blockers.push("ROS 2 live evidence must report ros2ActionsTouched: false.");
  if (result.commandPreview === true) warnings.push("Command preview evidence only; it does not prove live source data was observed.");
  if (result.dryRun === true && result.commandPreview !== true) warnings.push("Dry-run bridge evidence does not prove SEEKR ingest endpoints accepted posted records.");

  return {
    ok: blockers.length === 0,
    blockers,
    warnings
  };
}

function renderBridgeEvidenceMarkdown(manifest: BridgeEvidenceManifest) {
  const safety = isRecord(manifest.bridgeResult.safety) ? manifest.bridgeResult.safety : {};
  const rows = Object.entries(safety).map(([key, value]) => `| ${humanizeKey(key)} | \`${String(value)}\` |`);
  const errors = Array.isArray(manifest.bridgeResult.errors) ? manifest.bridgeResult.errors.map(String) : [];
  const rejectedCount = Array.isArray(manifest.bridgeResult.rejected) ? manifest.bridgeResult.rejected.length : 0;

  return [
    "# SEEKR Bridge Evidence",
    "",
    `- Label: ${manifest.label}`,
    `- Generated at: ${manifest.generatedAt}`,
    `- Bridge mode: ${manifest.bridgeMode}`,
    `- Status: ${manifest.status}`,
    `- Command upload enabled: ${manifest.commandUploadEnabled}`,
    `- Command endpoints touched: ${manifest.bridgeResult.commandEndpointsTouched}`,
    `- Dry run: ${Boolean(manifest.bridgeResult.dryRun)}`,
    `- Command preview: ${Boolean(manifest.bridgeResult.commandPreview)}`,
    `- Input count: ${manifest.bridgeResult.inputCount ?? 0}`,
    `- Accepted count: ${manifest.bridgeResult.acceptedCount ?? 0}`,
    `- Posted count: ${manifest.bridgeResult.postedCount ?? 0}`,
    `- Rejected count: ${rejectedCount}`,
    `- Evidence SHA-256: ${manifest.evidenceSha256}`,
    "",
    "## Safety Flags",
    "",
    "| Flag | Value |",
    "| --- | --- |",
    rows.length ? rows.join("\n") : "| none | `n/a` |",
    "",
    "## Validation",
    "",
    `- OK: ${manifest.validation.ok}`,
    manifest.validation.blockers.length ? `- Blockers: ${manifest.validation.blockers.join("; ")}` : "- Blockers: none",
    manifest.validation.warnings.length ? `- Warnings: ${manifest.validation.warnings.join("; ")}` : "- Warnings: none",
    errors.length ? `- Bridge errors: ${errors.join("; ")}` : "- Bridge errors: none",
    "",
    "## Limitations",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].join("\n");
}

function humanizeKey(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^\w/, (match) => match.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
