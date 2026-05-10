import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";

type DigestStatus = "pass" | "fail";

export interface HandoffDigestVerification {
  path: string;
  status: DigestStatus;
  expectedBytes: number;
  actualBytes?: number;
  expectedSha256: string;
  actualSha256?: string;
  details: string;
}

export interface HandoffVerificationManifest {
  schemaVersion: 1;
  generatedAt: string;
  status: "pass" | "fail";
  commandUploadEnabled: false;
  indexPath?: string;
  indexGeneratedAt?: string;
  indexStatus?: string;
  indexLocalAlphaOk: boolean;
  indexComplete: boolean;
  digestCount: number;
  safetyBoundary: {
    realAircraftCommandUpload: false;
    hardwareActuationEnabled: false;
    runtimePolicyInstalled: false;
  };
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  digests: HandoffDigestVerification[];
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/handoff-index";

export async function buildHandoffVerification(options: {
  root?: string;
  generatedAt?: string;
  indexPath?: string;
} = {}): Promise<HandoffVerificationManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const index = options.indexPath
    ? { relativePath: options.indexPath, absolutePath: path.resolve(root, options.indexPath) }
    : await latestJson(root, ".tmp/handoff-index", (name) => name.startsWith("seekr-handoff-index-"));

  const blockers: string[] = [];
  const warnings: string[] = [];
  const digests: HandoffDigestVerification[] = [];

  if (!index) {
    blockers.push("No handoff index JSON evidence exists.");
    return emptyManifest(generatedAt, blockers, warnings);
  }

  if (!isInsideRoot(root, index.absolutePath)) {
    blockers.push(`Handoff index path escapes root: ${index.relativePath}`);
    return emptyManifest(generatedAt, blockers, warnings, index.relativePath);
  }

  const manifest = await readJson(index.absolutePath);
  const artifactDigests = isRecord(manifest) && Array.isArray(manifest.artifactDigests)
    ? manifest.artifactDigests.filter(isRecord)
    : [];

  if (!isRecord(manifest)) blockers.push("Handoff index is missing or malformed.");
  else {
    if (manifest.commandUploadEnabled !== false) blockers.push("Handoff index must keep commandUploadEnabled false.");
    if (manifest.localAlphaOk !== true) blockers.push("Handoff index must report localAlphaOk true.");
    if (!isRecord(manifest.validation) || manifest.validation.ok !== true) blockers.push("Handoff index validation must be ok.");
    if (!handoffSafetyBoundaryFalse(manifest)) blockers.push("Handoff index safety boundary authorization fields must remain false.");
    if (!handoffHardwareClaimsFalse(manifest)) blockers.push("Handoff index hardware claims must remain false.");
    if (manifest.complete !== true) warnings.push("Handoff index is local-alpha ready but still incomplete on real-world evidence.");
  }

  if (!artifactDigests.length) blockers.push("Handoff index has no artifactDigests entries.");

  for (const digest of artifactDigests) {
    digests.push(await verifyDigest(root, digest));
  }

  blockers.push(...digests
    .filter((digest) => digest.status === "fail")
    .map((digest) => `${digest.path}: ${digest.details}`));
  const ok = blockers.length === 0;

  return {
    schemaVersion: 1,
    generatedAt,
    status: ok ? "pass" : "fail",
    commandUploadEnabled: false,
    indexPath: index.relativePath,
    indexGeneratedAt: isRecord(manifest) ? stringOrUndefined(manifest.generatedAt) : undefined,
    indexStatus: isRecord(manifest) ? stringOrUndefined(manifest.status) : undefined,
    indexLocalAlphaOk: isRecord(manifest) && manifest.localAlphaOk === true,
    indexComplete: isRecord(manifest) && manifest.complete === true,
    digestCount: digests.length,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    validation: {
      ok,
      warnings,
      blockers
    },
    digests,
    limitations: [
      "This verification checks a handoff index and the SHA-256 digests it recorded for linked local artifacts.",
      "It does not regenerate acceptance, completion-audit, demo, bench, hardware, policy, safety, or overnight evidence.",
      "It does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware actuation."
    ]
  };
}

export async function writeHandoffVerification(options: Parameters<typeof buildHandoffVerification>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildHandoffVerification(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-handoff-verification-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function emptyManifest(
  generatedAt: string,
  blockers: string[],
  warnings: string[],
  indexPath?: string
): HandoffVerificationManifest {
  return {
    schemaVersion: 1,
    generatedAt,
    status: "fail",
    commandUploadEnabled: false,
    indexPath,
    indexLocalAlphaOk: false,
    indexComplete: false,
    digestCount: 0,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    validation: {
      ok: false,
      warnings,
      blockers
    },
    digests: [],
    limitations: [
      "This verification checks a handoff index and the SHA-256 digests it recorded for linked local artifacts.",
      "It does not validate hardware or authorize command upload."
    ]
  };
}

async function verifyDigest(root: string, digest: Record<string, unknown>): Promise<HandoffDigestVerification> {
  const relativePath = String(digest.path ?? "");
  const expectedBytes = Number(digest.bytes);
  const expectedSha256 = String(digest.sha256 ?? "");
  const absolutePath = path.resolve(root, relativePath);

  if (!relativePath || !isInsideRoot(root, absolutePath)) {
    return {
      path: relativePath || "(missing path)",
      status: "fail",
      expectedBytes: Number.isFinite(expectedBytes) ? expectedBytes : 0,
      expectedSha256,
      details: "Digest path is missing or escapes the project root."
    };
  }

  if (!Number.isFinite(expectedBytes) || expectedBytes < 0 || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return {
      path: relativePath,
      status: "fail",
      expectedBytes: Number.isFinite(expectedBytes) ? expectedBytes : 0,
      expectedSha256,
      details: "Digest entry is malformed."
    };
  }

  try {
    const bytes = await readFile(absolutePath);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    const bytesMatch = bytes.byteLength === expectedBytes;
    const shaMatches = actualSha256 === expectedSha256;
    return {
      path: relativePath,
      status: bytesMatch && shaMatches ? "pass" : "fail",
      expectedBytes,
      actualBytes: bytes.byteLength,
      expectedSha256,
      actualSha256,
      details: bytesMatch && shaMatches ? "Digest matches." : "File bytes or SHA-256 no longer match the handoff index."
    };
  } catch {
    return {
      path: relativePath,
      status: "fail",
      expectedBytes,
      expectedSha256,
      details: "Linked artifact is missing."
    };
  }
}

interface LatestJson {
  absolutePath: string;
  relativePath: string;
}

async function latestJson(root: string, directory: string, predicate: (name: string) => boolean): Promise<LatestJson | undefined> {
  const absoluteDir = path.join(root, directory);
  try {
    const names = (await readdir(absoluteDir)).filter((name) => name.endsWith(".json") && predicate(name)).sort();
    const latest = names.at(-1);
    if (!latest) return undefined;
    return {
      absolutePath: path.join(absoluteDir, latest),
      relativePath: path.posix.join(directory.split(path.sep).join("/"), latest)
    };
  } catch {
    return undefined;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function handoffSafetyBoundaryFalse(manifest: Record<string, unknown>) {
  if (!isRecord(manifest.safetyBoundary)) return false;
  return manifest.safetyBoundary.realAircraftCommandUpload === false &&
    manifest.safetyBoundary.hardwareActuationEnabled === false &&
    manifest.safetyBoundary.runtimePolicyInstalled === false;
}

function handoffHardwareClaimsFalse(manifest: Record<string, unknown>) {
  if (!isRecord(manifest.hardwareClaims)) return false;
  const claims = manifest.hardwareClaims;
  return [
    "jetsonOrinNanoValidated",
    "raspberryPi5Validated",
    "realMavlinkBenchValidated",
    "realRos2BenchValidated",
    "hilFailsafeValidated",
    "isaacJetsonCaptureValidated",
    "hardwareActuationAuthorized"
  ].every((key) => claims[key] === false);
}

function renderMarkdown(manifest: HandoffVerificationManifest) {
  return `${[
    "# SEEKR Handoff Verification",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    manifest.indexPath ? `Index: ${manifest.indexPath}` : undefined,
    manifest.indexGeneratedAt ? `Index generated at: ${manifest.indexGeneratedAt}` : undefined,
    manifest.indexStatus ? `Index status: ${manifest.indexStatus}` : undefined,
    `Index local alpha OK: ${manifest.indexLocalAlphaOk}`,
    `Index complete: ${manifest.indexComplete}`,
    "",
    "Command upload enabled: false",
    "",
    "Safety boundary:",
    "",
    `- realAircraftCommandUpload: ${manifest.safetyBoundary.realAircraftCommandUpload}`,
    `- hardwareActuationEnabled: ${manifest.safetyBoundary.hardwareActuationEnabled}`,
    `- runtimePolicyInstalled: ${manifest.safetyBoundary.runtimePolicyInstalled}`,
    "",
    "Digest verification:",
    "",
    "| Path | Status | Expected bytes | Actual bytes | Details |",
    "| --- | --- | ---: | ---: | --- |",
    ...(manifest.digests.length
      ? manifest.digests.map((digest) => `| ${digest.path} | ${digest.status} | ${digest.expectedBytes} | ${digest.actualBytes ?? "n/a"} | ${escapeTable(digest.details)} |`)
      : ["| None | fail | 0 | n/a | No digests checked. |"]),
    "",
    "Validation:",
    "",
    `- OK: ${manifest.validation.ok}`,
    ...(manifest.validation.blockers.length ? manifest.validation.blockers.map((item) => `- Blocker: ${item}`) : ["- Blockers: none"]),
    ...(manifest.validation.warnings.length ? manifest.validation.warnings.map((item) => `- Warning: ${item}`) : ["- Warnings: none"]),
    "",
    "Limitations:",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].filter((line): line is string => typeof line === "string").join("\n")}\n`;
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isInsideRoot(root: string, absolutePath: string) {
  return absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const result = await writeHandoffVerification({
    outDir: typeof args.out === "string" ? args.out : undefined,
    indexPath: typeof args.index === "string" ? args.index : undefined,
    generatedAt: typeof args.generatedAt === "string" ? args.generatedAt : undefined
  });
  console.log(JSON.stringify({
    ok: result.manifest.validation.ok,
    status: result.manifest.status,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    indexPath: result.manifest.indexPath,
    digestCount: result.manifest.digestCount,
    validation: result.manifest.validation,
    jsonPath: result.jsonPath,
    markdownPath: result.markdownPath
  }, null, 2));
  if (!result.manifest.validation.ok) process.exitCode = 1;
}
