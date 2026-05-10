import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";

export interface ReleaseFileChecksum {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ReleaseChecksumManifest {
  schemaVersion: 1;
  generatedAt: string;
  softwareVersion: string;
  commandUploadEnabled: false;
  safetyBoundary: {
    realHardwareCommandUpload: "blocked";
    mavlink: "read-only";
    ros2: "read-only";
    px4ArdupilotHardwareTransport: "blocked";
  };
  fileCount: number;
  totalBytes: number;
  overallSha256: string;
  files: ReleaseFileChecksum[];
}

export const DEFAULT_RELEASE_INPUTS = [
  "package.json",
  "package-lock.json",
  ".gitignore",
  ".npmrc",
  ".env.example",
  "README.md",
  "index.html",
  "tsconfig.json",
  "vite.config.ts",
  "playwright.config.ts",
  "src",
  "scripts",
  "fixtures",
  "docs",
  "dist"
];

const DEFAULT_OUT_DIR = ".tmp/release-evidence";
const IGNORED_NAMES = new Set([".DS_Store"]);

export async function buildReleaseChecksumManifest(options: {
  root?: string;
  inputs?: string[];
  generatedAt?: string;
} = {}): Promise<ReleaseChecksumManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const inputs = options.inputs ?? DEFAULT_RELEASE_INPUTS;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const files = await collectReleaseFiles(root, inputs);
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version?: string };
  const checksumInput = files.map((file) => `${file.sha256}  ${file.bytes}  ${file.path}`).join("\n");
  const overallSha256 = createHash("sha256").update(`${checksumInput}\n`).digest("hex");

  return {
    schemaVersion: 1,
    generatedAt,
    softwareVersion: packageJson.version ?? "unknown",
    commandUploadEnabled: false,
    safetyBoundary: {
      realHardwareCommandUpload: "blocked",
      mavlink: "read-only",
      ros2: "read-only",
      px4ArdupilotHardwareTransport: "blocked"
    },
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    overallSha256,
    files
  };
}

export async function writeReleaseChecksumEvidence(options: {
  root?: string;
  outDir?: string;
  inputs?: string[];
  generatedAt?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildReleaseChecksumManifest({
    root,
    inputs: options.inputs,
    generatedAt: options.generatedAt
  });
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-release-${manifest.softwareVersion}-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const sha256Path = path.join(outDir, `${baseName}.sha256`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(sha256Path, renderSha256(manifest), "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, sha256Path, markdownPath };
}

async function collectReleaseFiles(root: string, inputs: string[]) {
  const files: ReleaseFileChecksum[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const absolutePath = path.resolve(root, input);
    if (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root) {
      throw new Error(`Release input escapes root: ${input}`);
    }
    await collectPath(root, absolutePath, files, seen);
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectPath(root: string, absolutePath: string, files: ReleaseFileChecksum[], seen: Set<string>) {
  const stats = await stat(absolutePath);
  const relativePath = toRelativePath(root, absolutePath);
  if (IGNORED_NAMES.has(path.basename(absolutePath))) return;

  if (stats.isDirectory()) {
    const children = await readdir(absolutePath);
    for (const child of children.sort()) {
      await collectPath(root, path.join(absolutePath, child), files, seen);
    }
    return;
  }

  if (!stats.isFile()) return;
  if (seen.has(relativePath)) return;
  seen.add(relativePath);

  const bytes = await readFile(absolutePath);
  files.push({
    path: relativePath,
    bytes: stats.size,
    sha256: createHash("sha256").update(bytes).digest("hex")
  });
}

function renderSha256(manifest: ReleaseChecksumManifest) {
  return `${[
    ...manifest.files.map((file) => `${file.sha256}  ${file.path}`),
    `${manifest.overallSha256}  SEEKR_RELEASE_OVERALL`
  ].join("\n")}\n`;
}

function renderMarkdown(manifest: ReleaseChecksumManifest) {
  return `${[
    "# SEEKR Release Checksum Evidence",
    "",
    `Generated at: ${manifest.generatedAt}`,
    `Software version: ${manifest.softwareVersion}`,
    `Files covered: ${manifest.fileCount}`,
    `Total bytes: ${manifest.totalBytes}`,
    `Overall SHA-256: ${manifest.overallSha256}`,
    "",
    "Command upload enabled: false",
    "",
    "This evidence proves local install file integrity only. It does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, or aircraft command authority.",
    "",
    "Safety boundary:",
    "",
    "- Real hardware command upload: blocked",
    "- MAVLink integration: read-only",
    "- ROS 2 integration: read-only",
    "- PX4/ArduPilot hardware transport: blocked",
    ""
  ].join("\n")}\n`;
}

function toRelativePath(root: string, absolutePath: string) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | undefined> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    args[key] = inlineValue ?? argv[index + 1];
    if (!inlineValue) index += 1;
  }
  return args;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  const result = await writeReleaseChecksumEvidence({
    root: args.root,
    outDir: args.out,
    generatedAt: args.generatedAt
  });
  console.log(JSON.stringify({
    ok: true,
    commandUploadEnabled: result.manifest.commandUploadEnabled,
    fileCount: result.manifest.fileCount,
    totalBytes: result.manifest.totalBytes,
    overallSha256: result.manifest.overallSha256,
    jsonPath: result.jsonPath,
    sha256Path: result.sha256Path,
    markdownPath: result.markdownPath
  }, null, 2));
}
