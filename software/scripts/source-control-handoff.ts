import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";

type SourceControlCheckStatus = "pass" | "warn" | "blocked";
type SourceControlHandoffStatus = "ready-source-control-handoff" | "ready-source-control-handoff-with-warnings" | "blocked-source-control-handoff";

export interface SourceControlHandoffCheck {
  id: string;
  status: SourceControlCheckStatus;
  details: string;
  evidence: string[];
}

export interface SourceControlHandoffNextAction {
  id: string;
  status: "required" | "verification";
  details: string;
  commands: string[];
  clearsCheckIds: string[];
}

export interface SourceControlHandoffManifest {
  schemaVersion: 1;
  generatedAt: string;
  status: SourceControlHandoffStatus;
  ready: boolean;
  commandUploadEnabled: false;
  repositoryUrl: string;
  packageRepositoryUrl?: string;
  gitMetadataPath?: string;
  configuredRemoteUrls: string[];
  remoteDefaultBranch?: string;
  remoteRefCount: number;
  blockedCheckCount: number;
  warningCheckCount: number;
  checks: SourceControlHandoffCheck[];
  nextActionChecklist: SourceControlHandoffNextAction[];
  limitations: string[];
}

interface LsRemoteResult {
  ok: boolean;
  output: string;
  error?: string;
}

const DEFAULT_OUT_DIR = ".tmp/source-control-handoff";
export const EXPECTED_REPOSITORY_URL = "https://github.com/Ayush1298567/SEEKR";
const REQUIRED_SOURCE_CONTROL_CHECK_IDS = ["repository-reference", "local-git-metadata", "configured-github-remote", "github-remote-refs"];
const execFileAsync = promisify(execFile);

export async function buildSourceControlHandoff(options: {
  root?: string;
  generatedAt?: string;
  lsRemote?: (repositoryUrl: string) => Promise<LsRemoteResult>;
} = {}): Promise<SourceControlHandoffManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const lsRemote = options.lsRemote ?? gitLsRemote;
  const packageJson = await readJson(path.join(root, "package.json"));
  const localReadme = await readText(path.join(root, "README.md"));
  const parentReadme = await readText(path.join(root, "..", "README.md"));
  const packageRepositoryUrl = repositoryUrlFromPackage(packageJson);
  const referenceText = [packageRepositoryUrl, localReadme, parentReadme].filter(Boolean).join("\n");
  const gitMetadata = await findGitMetadata(root);
  const configuredRemoteUrls = gitMetadata
    ? remoteUrlsFromGitConfig(await readText(path.join(gitMetadata.gitDir, "config")))
    : [];
  const remoteProbe = await lsRemote(EXPECTED_REPOSITORY_URL);
  const remoteState = parseLsRemote(remoteProbe.output);

  const checks: SourceControlHandoffCheck[] = [
    {
      id: "repository-reference",
      status: /github\.com\/Ayush1298567\/SEEKR/i.test(referenceText) ? "pass" : "blocked",
      details: /github\.com\/Ayush1298567\/SEEKR/i.test(referenceText)
        ? "Package metadata or README documentation names the SEEKR GitHub repository."
        : "Package metadata or README documentation must name https://github.com/Ayush1298567/SEEKR.",
      evidence: ["package.json repository", "README.md", "../README.md"]
    },
    {
      id: "local-git-metadata",
      status: gitMetadata ? "pass" : "blocked",
      details: gitMetadata
        ? "Local Git metadata is present for diff review and handoff history."
        : "This workspace is not a Git worktree; local diff review and source-control handoff history are unavailable.",
      evidence: [gitMetadata ? path.relative(root, gitMetadata.gitDir) || ".git" : ".git"]
    },
    {
      id: "configured-github-remote",
      status: configuredRemoteUrls.some(pointsAtExpectedRepository) ? "pass" : gitMetadata ? "blocked" : "warn",
      details: configuredRemoteUrls.some(pointsAtExpectedRepository)
        ? "Local Git metadata has a remote pointing at Ayush1298567/SEEKR."
        : gitMetadata
          ? "Local Git metadata exists, but no configured remote points at Ayush1298567/SEEKR."
          : "No local Git metadata exists, so configured remotes cannot be inspected.",
      evidence: configuredRemoteUrls.length ? configuredRemoteUrls : [".git/config"]
    },
    {
      id: "github-remote-refs",
      status: remoteProbe.ok && remoteState.refCount > 0 && remoteState.defaultBranch ? "pass" : remoteProbe.ok ? "blocked" : "warn",
      details: remoteProbe.ok
        ? remoteState.refCount > 0 && remoteState.defaultBranch
          ? `GitHub remote has ${remoteState.refCount} ref(s) and default branch ${remoteState.defaultBranch}.`
          : "GitHub remote is reachable but has no published refs/default branch yet."
        : `GitHub remote refs could not be inspected: ${remoteProbe.error ?? "unknown git ls-remote failure"}.`,
      evidence: [EXPECTED_REPOSITORY_URL, "git ls-remote --symref"]
    }
  ];

  const blockedCheckCount = checks.filter((check) => check.status === "blocked").length;
  const warningCheckCount = checks.filter((check) => check.status === "warn").length;
  const ready = blockedCheckCount === 0;
  const nextActionChecklist = sourceControlNextActions(checks);

  return {
    schemaVersion: 1,
    generatedAt,
    status: ready
      ? warningCheckCount
        ? "ready-source-control-handoff-with-warnings"
        : "ready-source-control-handoff"
      : "blocked-source-control-handoff",
    ready,
    commandUploadEnabled: false,
    repositoryUrl: EXPECTED_REPOSITORY_URL,
    packageRepositoryUrl,
    gitMetadataPath: gitMetadata ? path.relative(root, gitMetadata.gitDir) || ".git" : undefined,
    configuredRemoteUrls,
    remoteDefaultBranch: remoteState.defaultBranch,
    remoteRefCount: remoteState.refCount,
    blockedCheckCount,
    warningCheckCount,
    checks,
    nextActionChecklist,
    limitations: [
      "This audit is read-only and does not initialize Git, commit files, push branches, or change GitHub settings.",
      "Source-control handoff status is separate from aircraft hardware readiness.",
      "Real command upload and hardware actuation remain disabled."
    ]
  };
}

export async function writeSourceControlHandoff(options: Parameters<typeof buildSourceControlHandoff>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const manifest = await buildSourceControlHandoff(options);
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-source-control-handoff-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function parseLsRemote(output: string) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const defaultBranch = lines
    .map((line) => /^ref:\s+(refs\/heads\/[^\s]+)\s+HEAD$/.exec(line)?.[1])
    .find((branch): branch is string => typeof branch === "string")
    ?.replace(/^refs\/heads\//, "");
  const refCount = lines.filter((line) => /^[0-9a-f]{40}\s+refs\//i.test(line)).length;
  return { defaultBranch, refCount };
}

async function gitLsRemote(repositoryUrl: string): Promise<LsRemoteResult> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", "--symref", repositoryUrl], {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, output: stdout };
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: [
        String((error as { stdout?: unknown }).stdout ?? "").trim(),
        String((error as { stderr?: unknown }).stderr ?? "").trim(),
        String((error as { message?: unknown }).message ?? "").trim()
      ].filter(Boolean).join(" ").slice(0, 500)
    };
  }
}

function renderMarkdown(manifest: SourceControlHandoffManifest) {
  const lines = [
    "# SEEKR Source-Control Handoff",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `Ready: ${manifest.ready}`,
    `Command upload enabled: ${manifest.commandUploadEnabled}`,
    `Repository: ${manifest.repositoryUrl}`,
    manifest.packageRepositoryUrl ? `Package repository: ${manifest.packageRepositoryUrl}` : undefined,
    manifest.gitMetadataPath ? `Git metadata: ${manifest.gitMetadataPath}` : "Git metadata: missing",
    `Configured remotes: ${manifest.configuredRemoteUrls.length ? manifest.configuredRemoteUrls.join(", ") : "none"}`,
    `Remote default branch: ${manifest.remoteDefaultBranch ?? "none"}`,
    `Remote ref count: ${manifest.remoteRefCount}`,
    `Blocked checks: ${manifest.blockedCheckCount}`,
    `Warning checks: ${manifest.warningCheckCount}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Details | Evidence |",
    "| --- | --- | --- | --- |",
    ...manifest.checks.map((check) => `| ${check.id} | ${check.status} | ${check.details} | ${check.evidence.join(", ")} |`),
    "",
    "## Publication Next Steps",
    "",
    "| Step | Status | Details | Commands | Clears |",
    "| --- | --- | --- | --- | --- |",
    ...manifest.nextActionChecklist.map((action) =>
      `| ${action.id} | ${action.status} | ${action.details} | ${action.commands.map((command) => `\`${command}\``).join("<br>")} | ${action.clearsCheckIds.join(", ")} |`
    ),
    "",
    "## Limitations",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].filter((line): line is string => typeof line === "string");
  return `${lines.join("\n")}\n`;
}

async function findGitMetadata(root: string): Promise<{ gitDir: string } | undefined> {
  let current = root;
  while (true) {
    const candidate = path.join(current, ".git");
    if (await pathExists(candidate)) return { gitDir: candidate };
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function remoteUrlsFromGitConfig(config: string) {
  return config
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => /^url\s*=\s*(.+)$/.exec(line)?.[1])
    .filter((url): url is string => typeof url === "string" && url.length > 0);
}

function pointsAtExpectedRepository(value: string) {
  return /github\.com[:/]Ayush1298567\/SEEKR(?:\.git)?$/i.test(value.replace(/^git\+/, ""));
}

export function validateSourceControlHandoffManifest(manifest: unknown) {
  const problems: string[] = [];
  if (!isRecord(manifest)) {
    return {
      ok: false,
      problems: ["source-control handoff artifact is not a JSON object"],
      blockedCheckIds: [] as string[],
      warningCheckIds: [] as string[],
      ready: false
    };
  }

  const checks = Array.isArray(manifest.checks) ? manifest.checks.filter(isRecord) : [];
  const checkIds = new Set(checks.map((check) => String(check.id ?? "")));
  const blockedCheckIds = checks
    .filter((check) => check.status === "blocked")
    .map((check) => String(check.id ?? "unknown"));
  const warningCheckIds = checks
    .filter((check) => check.status === "warn")
    .map((check) => String(check.id ?? "unknown"));
  const nextActions = Array.isArray(manifest.nextActionChecklist) ? manifest.nextActionChecklist.filter(isRecord) : [];
  const nextActionIds = new Set(nextActions.map((action) => String(action.id ?? "")));
  const status = String(manifest.status);
  const limitations = Array.isArray(manifest.limitations) ? manifest.limitations.map(String).join(" ") : "";
  const ready = manifest.ready === true;
  const manifestBlockedCheckCount = Number(manifest.blockedCheckCount);
  const manifestWarningCheckCount = Number(manifest.warningCheckCount);
  const readyMatchesChecks = manifest.ready === (blockedCheckIds.length === 0);
  const statusMatchesChecks = blockedCheckIds.length
    ? status === "blocked-source-control-handoff"
    : warningCheckIds.length
      ? status === "ready-source-control-handoff-with-warnings"
      : status === "ready-source-control-handoff";
  const blockedCountMatchesChecks = manifestBlockedCheckCount === blockedCheckIds.length;
  const warningCountMatchesChecks = manifestWarningCheckCount === warningCheckIds.length;

  if (manifest.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (manifest.commandUploadEnabled !== false) problems.push("commandUploadEnabled must be false");
  if (manifest.repositoryUrl !== EXPECTED_REPOSITORY_URL) problems.push(`repositoryUrl must be ${EXPECTED_REPOSITORY_URL}`);
  if (!Number.isFinite(Number(manifest.remoteRefCount)) || Number(manifest.remoteRefCount) < 0) {
    problems.push("remoteRefCount must be a non-negative number");
  }
  if (!Number.isInteger(manifestBlockedCheckCount) || manifestBlockedCheckCount < 0) {
    problems.push("blockedCheckCount must be a non-negative integer");
  }
  if (!Number.isInteger(manifestWarningCheckCount) || manifestWarningCheckCount < 0) {
    problems.push("warningCheckCount must be a non-negative integer");
  }
  if (!Array.isArray(manifest.configuredRemoteUrls)) problems.push("configuredRemoteUrls must be an array");
  for (const id of REQUIRED_SOURCE_CONTROL_CHECK_IDS) {
    if (!checkIds.has(id)) problems.push(`missing required check ${id}`);
  }
  if (!checks.every((check) => ["pass", "warn", "blocked"].includes(String(check.status)) && typeof check.details === "string")) {
    problems.push("checks must use pass/warn/blocked statuses and include details");
  }
  if (!nextActions.length) {
    problems.push("nextActionChecklist must include publication or verification steps");
  }
  if (!nextActions.every(sourceControlNextActionOk)) {
    problems.push("nextActionChecklist entries must include id, status, details, commands, and clearsCheckIds");
  }
  if ((blockedCheckIds.length || warningCheckIds.length) && !nextActionIds.has("rerun-source-control-audit")) {
    problems.push("nextActionChecklist must include rerun-source-control-audit when source-control checks are blocked or warned");
  }
  if (blockedCheckIds.includes("local-git-metadata") && !nextActions.some((action) => nextActionClearsWithCommand(action, "local-git-metadata", /git init|restore .*\.git/i))) {
    problems.push("nextActionChecklist must include a local Git metadata recovery step when .git metadata is missing");
  }
  if ((blockedCheckIds.includes("configured-github-remote") || warningCheckIds.includes("configured-github-remote")) && !nextActions.some((action) => nextActionClearsWithCommand(action, "configured-github-remote", /git remote (add|set-url) origin/i))) {
    problems.push("nextActionChecklist must include a GitHub remote configuration step when the remote cannot be verified");
  }
  if (blockedCheckIds.includes("github-remote-refs") && !nextActions.some((action) => nextActionClearsWithCommand(action, "github-remote-refs", /git push/i))) {
    problems.push("nextActionChecklist must include a manual publish step when GitHub has no refs");
  }
  if (!readyMatchesChecks) problems.push("ready must match blocked check count");
  if (!statusMatchesChecks) problems.push("status must match blocked/warning check count");
  if (!blockedCountMatchesChecks) problems.push("blockedCheckCount must match blocked checks");
  if (!warningCountMatchesChecks) problems.push("warningCheckCount must match warning checks");
  if (!/does not initialize Git|commit files|push branches|change GitHub settings/i.test(limitations)) {
    problems.push("limitations must state that the audit does not initialize Git, commit, push, or change GitHub settings");
  }
  if (!/separate from aircraft hardware readiness/i.test(limitations)) {
    problems.push("limitations must keep source-control handoff separate from hardware readiness");
  }
  if (!/command upload|hardware actuation/i.test(limitations)) {
    problems.push("limitations must preserve disabled command upload/hardware actuation");
  }

  return {
    ok: problems.length === 0,
    problems,
    blockedCheckIds,
    warningCheckIds,
    ready
  };
}

function sourceControlNextActions(checks: SourceControlHandoffCheck[]): SourceControlHandoffNextAction[] {
  const statusFor = (id: string) => checks.find((check) => check.id === id)?.status;
  const localGitMissing = statusFor("local-git-metadata") === "blocked";
  const remoteMissing = statusFor("configured-github-remote") === "blocked" || statusFor("configured-github-remote") === "warn";
  const remoteRefsMissing = statusFor("github-remote-refs") === "blocked";
  const actions: SourceControlHandoffNextAction[] = [];

  if (localGitMissing) {
    actions.push({
      id: "restore-or-initialize-local-git",
      status: "required",
      details: "Restore the original .git directory if this folder came from another checkout; otherwise initialize a new local Git worktree after reviewing generated artifacts.",
      commands: [
        "test -d .git && git status --short --branch",
        "git init",
        "git status --ignored --short"
      ],
      clearsCheckIds: ["local-git-metadata"]
    });
  }

  if (remoteMissing) {
    actions.push({
      id: "configure-github-origin",
      status: "required",
      details: "Point the local worktree at the SEEKR GitHub repository before publication review.",
      commands: [
        "git remote add origin git@github.com:Ayush1298567/SEEKR.git",
        "git remote set-url origin git@github.com:Ayush1298567/SEEKR.git",
        "git remote -v"
      ],
      clearsCheckIds: ["configured-github-remote"]
    });
  }

  if (remoteRefsMissing) {
    actions.push({
      id: "publish-reviewed-main",
      status: "required",
      details: "After reviewing local changes and ignored files, create the reviewed initial commit and publish the default branch to GitHub.",
      commands: [
        "git status --ignored --short",
        "git add .",
        "git status --short",
        "git commit -m \"Initial SEEKR local alpha\"",
        "git branch -M main",
        "git push -u origin main"
      ],
      clearsCheckIds: ["github-remote-refs"]
    });
  }

  actions.push({
    id: actions.length ? "rerun-source-control-audit" : "verify-source-control-before-bundle",
    status: "verification",
    details: actions.length
      ? "Rerun the read-only audit after manual source-control recovery so the handoff can prove Git metadata, origin, and remote refs are current."
      : "Rerun the read-only audit before final bundling to keep source-control evidence current.",
    commands: ["npm run audit:source-control"],
    clearsCheckIds: REQUIRED_SOURCE_CONTROL_CHECK_IDS
  });

  return actions;
}

function sourceControlNextActionOk(action: Record<string, unknown>) {
  const commands = Array.isArray(action.commands) ? action.commands : [];
  const clearsCheckIds = Array.isArray(action.clearsCheckIds) ? action.clearsCheckIds : [];
  return typeof action.id === "string" &&
    action.id.length > 0 &&
    ["required", "verification"].includes(String(action.status)) &&
    typeof action.details === "string" &&
    action.details.length > 0 &&
    commands.length > 0 &&
    commands.every((command) => typeof command === "string" && command.length > 0) &&
    clearsCheckIds.length > 0 &&
    clearsCheckIds.every((id) => REQUIRED_SOURCE_CONTROL_CHECK_IDS.includes(String(id)));
}

function nextActionClearsWithCommand(action: Record<string, unknown>, checkId: string, commandPattern: RegExp) {
  const commands = Array.isArray(action.commands) ? action.commands.map(String) : [];
  const clearsCheckIds = Array.isArray(action.clearsCheckIds) ? action.clearsCheckIds.map(String) : [];
  return clearsCheckIds.includes(checkId) && commands.some((command) => commandPattern.test(command));
}

function repositoryUrlFromPackage(packageJson: unknown) {
  if (!isRecord(packageJson)) return undefined;
  const repository = packageJson.repository;
  if (typeof repository === "string") return repository;
  if (isRecord(repository) && typeof repository.url === "string") return repository.url;
  return undefined;
}

async function readJson(filePath: string): Promise<unknown> {
  const content = await readText(filePath);
  if (!content) return undefined;
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

async function readText(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  writeSourceControlHandoff()
    .then(({ manifest, jsonPath, markdownPath }) => {
      console.log(JSON.stringify({
        ok: true,
        status: manifest.status,
        ready: manifest.ready,
        commandUploadEnabled: manifest.commandUploadEnabled,
        repositoryUrl: manifest.repositoryUrl,
        packageRepositoryUrl: manifest.packageRepositoryUrl,
        gitMetadataPath: manifest.gitMetadataPath,
        configuredRemoteUrls: manifest.configuredRemoteUrls,
        remoteDefaultBranch: manifest.remoteDefaultBranch,
        remoteRefCount: manifest.remoteRefCount,
        blockedCheckCount: manifest.blockedCheckCount,
        warningCheckCount: manifest.warningCheckCount,
        jsonPath,
        markdownPath
      }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
