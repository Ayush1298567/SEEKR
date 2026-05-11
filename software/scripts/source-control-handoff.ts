import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { OPERATOR_QUICKSTART_PATH, operatorQuickstartProblems } from "./operator-quickstart-contract";

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
  localBranch?: string;
  localHeadSha?: string;
  remoteDefaultBranchSha?: string;
  workingTreeStatusLineCount?: number;
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

interface GitCommandResult {
  ok: boolean;
  stdout: string;
  error?: string;
}

interface FreshCloneResult {
  ok: boolean;
  cloneSucceeded: boolean;
  headSha?: string;
  checkedPaths: string[];
  missingPaths: string[];
  installDryRunOk?: boolean;
  installDryRunError?: string;
  operatorQuickstartProblems?: string[];
  error?: string;
}

interface LocalGitState {
  branch?: string;
  headSha?: string;
  statusLines?: string[];
  branchError?: string;
  headError?: string;
  statusError?: string;
}

const DEFAULT_OUT_DIR = ".tmp/source-control-handoff";
export const EXPECTED_REPOSITORY_URL = "https://github.com/Ayush1298567/SEEKR";
const REQUIRED_SOURCE_CONTROL_CHECK_IDS = ["repository-reference", "github-landing-readme", "local-git-metadata", "configured-github-remote", "github-remote-refs", "fresh-clone-smoke", "local-head-published", "working-tree-clean"];
const GITHUB_LANDING_README_COMMAND_ORDER_EVIDENCE = "github-landing-readme-command-order";
const GITHUB_LANDING_README_AI_READINESS_EVIDENCE = "github-landing-readme-ai-readiness-proof";
const REQUIRED_GITHUB_LANDING_README_SIGNALS = [
  "git clone https://github.com/Ayush1298567/SEEKR.git",
  "cd SEEKR/software",
  "git pull --ff-only",
  "npm ci",
  "npm run setup:local",
  "npm run audit:source-control",
  "npm run doctor",
  "npm run rehearsal:start",
  "npm run smoke:rehearsal:start",
  "npm run test:ai:local",
  "npm run audit:plug-and-play",
  "command upload",
  "hardware actuation"
];
const REQUIRED_GITHUB_LANDING_README_COMMAND_ORDER = [
  "git clone https://github.com/Ayush1298567/SEEKR.git",
  "cd SEEKR/software",
  "npm ci",
  "npm run setup:local",
  "npm run audit:source-control",
  "npm run doctor",
  "npm run rehearsal:start",
  "npm run smoke:rehearsal:start",
  "npm run test:ai:local",
  "npm run audit:plug-and-play"
];
const REQUIRED_FRESH_CLONE_PATHS = [
  "README.md",
  "software/package.json",
  "software/package-lock.json",
  "software/.env.example",
  "software/scripts/rehearsal-start.sh",
  "software/docs/OPERATOR_QUICKSTART.md"
];
const FRESH_CLONE_COMMAND = "git clone --depth 1";
const NPM_CI_DRY_RUN_COMMAND = "npm ci --dry-run --ignore-scripts --no-audit --fund=false --prefer-offline";
const execFileAsync = promisify(execFile);

export async function buildSourceControlHandoff(options: {
  root?: string;
  generatedAt?: string;
  lsRemote?: (repositoryUrl: string) => Promise<LsRemoteResult>;
  freshClone?: (repositoryUrl: string) => Promise<FreshCloneResult>;
  git?: (args: string[], cwd: string) => Promise<GitCommandResult>;
} = {}): Promise<SourceControlHandoffManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const lsRemote = options.lsRemote ?? gitLsRemote;
  const freshClone = options.freshClone ?? gitFreshCloneProbe;
  const git = options.git ?? gitCommand;
  const packageJson = await readJson(path.join(root, "package.json"));
  const localReadme = await readText(path.join(root, "README.md"));
  const parentReadme = await readText(path.join(root, "..", "README.md"));
  const packageRepositoryUrl = repositoryUrlFromPackage(packageJson);
  const referenceText = [packageRepositoryUrl, localReadme, parentReadme].filter(Boolean).join("\n");
  const gitMetadata = await findGitMetadata(root);
  const configuredRemoteUrls = gitMetadata
    ? remoteUrlsFromGitConfig(await readText(path.join(gitMetadata.gitDir, "config")))
    : [];
  const localGit = gitMetadata ? await inspectLocalGit(root, git) : {};
  const remoteProbe = await lsRemote(EXPECTED_REPOSITORY_URL);
  const remoteState = parseLsRemote(remoteProbe.output);
  const freshCloneProbe = await freshClone(EXPECTED_REPOSITORY_URL);
  const remoteDefaultBranchSha = remoteState.defaultBranch ? remoteState.refs.get(`refs/heads/${remoteState.defaultBranch}`) : undefined;
  const localHeadPublished = Boolean(localGit.headSha && remoteDefaultBranchSha && localGit.headSha === remoteDefaultBranchSha);
  const workingTreeStatusLineCount = localGit.statusLines?.length;

  const checks: SourceControlHandoffCheck[] = [
    {
      id: "repository-reference",
      status: /github\.com\/Ayush1298567\/SEEKR/i.test(referenceText) ? "pass" : "blocked",
      details: /github\.com\/Ayush1298567\/SEEKR/i.test(referenceText)
        ? "Package metadata or README documentation names the SEEKR GitHub repository."
        : "Package metadata or README documentation must name https://github.com/Ayush1298567/SEEKR.",
      evidence: ["package.json repository", "README.md", "../README.md"]
    },
    githubLandingReadmeCheck(parentReadme),
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
    },
    freshCloneSmokeCheck(freshCloneProbe),
    {
      id: "local-head-published",
      status: !gitMetadata || !remoteProbe.ok
        ? "warn"
        : localHeadPublished
          ? "pass"
          : "blocked",
      details: !gitMetadata
        ? "No local Git metadata exists, so the published commit cannot be compared to local HEAD."
        : !remoteProbe.ok
          ? `GitHub remote refs could not be inspected, so local HEAD publication could not be proven: ${remoteProbe.error ?? "unknown git ls-remote failure"}.`
          : localHeadPublished
            ? `Local HEAD ${shortSha(localGit.headSha)} on ${localGit.branch ?? "unknown branch"} matches GitHub default branch ${remoteState.defaultBranch}.`
            : localGit.headSha && remoteDefaultBranchSha
              ? `Local HEAD ${shortSha(localGit.headSha)} does not match GitHub ${remoteState.defaultBranch} at ${shortSha(remoteDefaultBranchSha)}.`
              : `Local HEAD or GitHub default branch SHA could not be resolved.${localGit.headError ? ` ${localGit.headError}` : ""}`,
      evidence: [
        localGit.branch ? `branch:${localGit.branch}` : "git branch --show-current",
        localGit.headSha ? `HEAD:${localGit.headSha}` : "git rev-parse HEAD",
        remoteState.defaultBranch ? `origin/${remoteState.defaultBranch}:${remoteDefaultBranchSha ?? "unknown"}` : "git ls-remote --symref"
      ]
    },
    {
      id: "working-tree-clean",
      status: !gitMetadata
        ? "warn"
        : localGit.statusLines
          ? localGit.statusLines.length === 0 ? "pass" : "blocked"
          : "blocked",
      details: !gitMetadata
        ? "No local Git metadata exists, so the worktree cleanliness cannot be inspected."
        : localGit.statusLines
          ? localGit.statusLines.length === 0
            ? "Local Git worktree has no uncommitted tracked or untracked source changes."
            : `Local Git worktree has ${localGit.statusLines.length} uncommitted status line(s); review, commit, or ignore them before source-control handoff.`
          : `Local Git worktree status could not be inspected.${localGit.statusError ? ` ${localGit.statusError}` : ""}`,
      evidence: localGit.statusLines && localGit.statusLines.length
        ? localGit.statusLines.slice(0, 20)
        : ["git status --porcelain --untracked-files=normal"]
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
    localBranch: localGit.branch,
    localHeadSha: localGit.headSha,
    remoteDefaultBranchSha,
    workingTreeStatusLineCount,
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
  const refs = new Map<string, string>();
  for (const line of lines) {
    const match = /^([0-9a-f]{40})\s+(refs\/[^\s]+|HEAD)$/i.exec(line);
    if (match) refs.set(match[2], match[1]);
  }
  return { defaultBranch, refCount, refs };
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

async function gitCommand(args: string[], cwd: string): Promise<GitCommandResult> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, stdout };
  } catch (error) {
    return {
      ok: false,
      stdout: String((error as { stdout?: unknown }).stdout ?? ""),
      error: [
        String((error as { stderr?: unknown }).stderr ?? "").trim(),
        String((error as { message?: unknown }).message ?? "").trim()
      ].filter(Boolean).join(" ").slice(0, 500)
    };
  }
}

async function gitFreshCloneProbe(repositoryUrl: string): Promise<FreshCloneResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "seekr-fresh-clone-"));
  const cloneDir = path.join(tempDir, "SEEKR");
  try {
    await execFileAsync("git", ["clone", "--depth", "1", repositoryUrl, cloneDir], {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024
    });
    const head = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: cloneDir,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });
    const missingPaths: string[] = [];
    for (const relativePath of REQUIRED_FRESH_CLONE_PATHS) {
      if (!(await pathExists(path.join(cloneDir, relativePath)))) missingPaths.push(relativePath);
    }
    const clonedOperatorQuickstartProblems = missingPaths.includes(`software/${OPERATOR_QUICKSTART_PATH}`)
      ? [`Missing software/${OPERATOR_QUICKSTART_PATH}`]
      : operatorQuickstartProblems(await readText(path.join(cloneDir, "software", OPERATOR_QUICKSTART_PATH)));
    const installDryRun = missingPaths.length
      ? { ok: false, error: "Skipped npm ci --dry-run because required fresh-clone files are missing." }
      : await npmCiDryRun(path.join(cloneDir, "software"));
    return {
      ok: missingPaths.length === 0 && installDryRun.ok && clonedOperatorQuickstartProblems.length === 0,
      cloneSucceeded: true,
      headSha: head.stdout.trim() || undefined,
      checkedPaths: REQUIRED_FRESH_CLONE_PATHS,
      missingPaths,
      installDryRunOk: installDryRun.ok,
      installDryRunError: installDryRun.error,
      operatorQuickstartProblems: clonedOperatorQuickstartProblems
    };
  } catch (error) {
    return {
      ok: false,
      cloneSucceeded: false,
      checkedPaths: REQUIRED_FRESH_CLONE_PATHS,
      missingPaths: REQUIRED_FRESH_CLONE_PATHS,
      error: [
        String((error as { stdout?: unknown }).stdout ?? "").trim(),
        String((error as { stderr?: unknown }).stderr ?? "").trim(),
        String((error as { message?: unknown }).message ?? "").trim()
      ].filter(Boolean).join(" ").slice(0, 500)
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function inspectLocalGit(root: string, git: (args: string[], cwd: string) => Promise<GitCommandResult>): Promise<LocalGitState> {
  const branch = await git(["branch", "--show-current"], root);
  const head = await git(["rev-parse", "HEAD"], root);
  const status = await git(["status", "--porcelain", "--untracked-files=normal"], root);
  return {
    branch: branch.ok ? branch.stdout.trim() || undefined : undefined,
    headSha: head.ok ? head.stdout.trim() || undefined : undefined,
    statusLines: status.ok ? status.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean) : undefined,
    branchError: branch.ok ? undefined : branch.error,
    headError: head.ok ? undefined : head.error,
    statusError: status.ok ? undefined : status.error
  };
}

async function npmCiDryRun(cwd: string) {
  try {
    await execFileAsync("npm", ["ci", "--dry-run", "--ignore-scripts", "--no-audit", "--fund=false", "--prefer-offline"], {
      cwd,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
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
    manifest.localBranch ? `Local branch: ${manifest.localBranch}` : undefined,
    manifest.localHeadSha ? `Local HEAD: ${manifest.localHeadSha}` : undefined,
    `Configured remotes: ${manifest.configuredRemoteUrls.length ? manifest.configuredRemoteUrls.join(", ") : "none"}`,
    `Remote default branch: ${manifest.remoteDefaultBranch ?? "none"}`,
    manifest.remoteDefaultBranchSha ? `Remote default branch SHA: ${manifest.remoteDefaultBranchSha}` : undefined,
    `Remote ref count: ${manifest.remoteRefCount}`,
    typeof manifest.workingTreeStatusLineCount === "number" ? `Working tree status lines: ${manifest.workingTreeStatusLineCount}` : undefined,
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

function githubLandingReadmeCheck(content: string): SourceControlHandoffCheck {
  if (!content) {
    return {
      id: "github-landing-readme",
      status: "blocked",
      details: "The GitHub landing README is missing, so a fresh-clone operator path cannot be proven.",
      evidence: ["../README.md"]
    };
  }
  const problems = githubLandingReadmeProblems(content);
  return {
    id: "github-landing-readme",
    status: problems.length ? "blocked" : "pass",
    details: problems.length
      ? `The GitHub landing README violates fresh-clone plug-and-play guidance: ${problems.join(", ")}.`
      : "The GitHub landing README gives an ordered fresh clone path into SEEKR/software, includes source-control audit before startup, runs bounded smoke before strict local AI smoke before plug-and-play audit guidance, and preserves disabled command/hardware authority.",
    evidence: problems.length ? ["../README.md"] : [
      "../README.md",
      GITHUB_LANDING_README_COMMAND_ORDER_EVIDENCE,
      GITHUB_LANDING_README_AI_READINESS_EVIDENCE
    ]
  };
}

function githubLandingReadmeProblems(content: string) {
  const missing = REQUIRED_GITHUB_LANDING_README_SIGNALS.filter((signal) => !content.includes(signal));
  const problems = [...missing];
  if (content && !missing.length && !githubLandingReadmeCommandOrderOk(content)) {
    problems.push(`command order must be ${REQUIRED_GITHUB_LANDING_README_COMMAND_ORDER.join(" before ")}`);
  }
  return problems;
}

function githubLandingReadmeCommandOrderOk(content: string) {
  let lastIndex = -1;
  for (const command of REQUIRED_GITHUB_LANDING_README_COMMAND_ORDER) {
    const index = content.indexOf(command);
    if (index <= lastIndex) return false;
    lastIndex = index;
  }
  return true;
}

function freshCloneSmokeCheck(result: FreshCloneResult): SourceControlHandoffCheck {
  if (result.ok) {
    return {
      id: "fresh-clone-smoke",
      status: "pass",
      details: `A shallow fresh clone of the GitHub repository succeeded at ${shortSha(result.headSha)}, contains the landing README, software package manifest and lockfile, env template, rehearsal start wrapper, and operator quickstart, passes the shared operator quickstart contract, and passes npm ci --dry-run.`,
      evidence: [
        EXPECTED_REPOSITORY_URL,
        FRESH_CLONE_COMMAND,
        NPM_CI_DRY_RUN_COMMAND,
        "fresh-clone-operator-quickstart-contract",
        ...result.checkedPaths.map((checkedPath) => `fresh-clone:${checkedPath}`)
      ]
    };
  }
  if (result.cloneSucceeded && result.missingPaths.length) {
    return {
      id: "fresh-clone-smoke",
      status: "blocked",
      details: `A shallow fresh clone succeeded but the published repository is missing required plug-and-play file(s): ${result.missingPaths.join(", ")}.`,
      evidence: [
        EXPECTED_REPOSITORY_URL,
        FRESH_CLONE_COMMAND,
        ...result.missingPaths.map((missingPath) => `missing:${missingPath}`)
      ]
    };
  }
  if (result.cloneSucceeded && result.installDryRunOk === false) {
    return {
      id: "fresh-clone-smoke",
      status: "blocked",
      details: `A shallow fresh clone succeeded, but published package install consistency failed npm ci --dry-run: ${result.installDryRunError ?? "unknown npm ci dry-run failure"}.`,
      evidence: [
        EXPECTED_REPOSITORY_URL,
        FRESH_CLONE_COMMAND,
        NPM_CI_DRY_RUN_COMMAND
      ]
    };
  }
  if (result.cloneSucceeded && result.operatorQuickstartProblems?.length) {
    return {
      id: "fresh-clone-smoke",
      status: "blocked",
      details: `A shallow fresh clone succeeded, but the published operator quickstart violates required plug-and-play guidance: ${result.operatorQuickstartProblems.join(", ")}.`,
      evidence: [
        EXPECTED_REPOSITORY_URL,
        FRESH_CLONE_COMMAND,
        `fresh-clone:software/${OPERATOR_QUICKSTART_PATH}`,
        ...result.operatorQuickstartProblems.map((problem) => `operator-quickstart-problem:${problem}`)
      ]
    };
  }
  return {
    id: "fresh-clone-smoke",
    status: "warn",
    details: `A shallow fresh clone could not be completed, so clone-readiness could not be proven in this run: ${result.error ?? "unknown clone failure"}.`,
    evidence: [EXPECTED_REPOSITORY_URL, FRESH_CLONE_COMMAND]
  };
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

  const rawChecks = Array.isArray(manifest.checks) ? manifest.checks : [];
  const checks = rawChecks.filter(isRecord);
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
  if (ready && typeof manifest.localHeadSha !== "string") problems.push("ready source-control handoff must include localHeadSha");
  if (ready && typeof manifest.remoteDefaultBranchSha !== "string") problems.push("ready source-control handoff must include remoteDefaultBranchSha");
  if (ready && typeof manifest.localHeadSha === "string" && typeof manifest.remoteDefaultBranchSha === "string" && manifest.localHeadSha !== manifest.remoteDefaultBranchSha) {
    problems.push("ready source-control handoff must have localHeadSha equal remoteDefaultBranchSha");
  }
  if (ready && !String(manifest.remoteDefaultBranch ?? "")) problems.push("ready source-control handoff must include remoteDefaultBranch");
  if (ready && Number(manifest.remoteRefCount) < 1) problems.push("ready source-control handoff must include at least one GitHub remote ref");
  if (ready && (!Array.isArray(manifest.configuredRemoteUrls) || !manifest.configuredRemoteUrls.some((url) => pointsAtExpectedRepository(String(url))))) {
    problems.push("ready source-control handoff must include a configured remote pointing at Ayush1298567/SEEKR");
  }
  if (ready && manifest.workingTreeStatusLineCount !== 0) problems.push("ready source-control handoff must record a clean working tree");
  if (!Array.isArray(manifest.checks)) {
    problems.push("checks must be an array");
  } else if (rawChecks.length !== checks.length) {
    problems.push("checks must contain only JSON objects");
  }
  if (!sourceControlCheckIdsAreExact(checks)) {
    problems.push("checks must exactly match the required source-control check IDs in order");
  }
  for (const id of REQUIRED_SOURCE_CONTROL_CHECK_IDS) {
    if (!checkIds.has(id)) problems.push(`missing required check ${id}`);
  }
  if (!checks.every((check) => ["pass", "warn", "blocked"].includes(String(check.status)) && typeof check.details === "string")) {
    problems.push("checks must use pass/warn/blocked statuses and include details");
  }
  const freshCloneCheck = checks.find((check) => check.id === "fresh-clone-smoke");
  const githubLandingCheck = checks.find((check) => check.id === "github-landing-readme");
  if (githubLandingCheck?.status === "pass" && !githubLandingPassEvidenceOk(githubLandingCheck)) {
    problems.push("github-landing-readme pass must include ordered landing README command proof plus final AI/readiness proof evidence");
  }
  if (freshCloneCheck?.status === "pass" && !freshClonePassEvidenceOk(freshCloneCheck)) {
    problems.push("fresh-clone-smoke pass must include shallow clone, npm ci dry-run, operator quickstart contract proof, and all required startup-file evidence");
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
  if (blockedCheckIds.includes("github-landing-readme") && !nextActions.some((action) => nextActionClearsWithCommand(action, "github-landing-readme", /README\.md|operatorQuickstartContract/i))) {
    problems.push("nextActionChecklist must include a GitHub landing README repair step when the clone path is missing");
  }
  if (blockedCheckIds.includes("fresh-clone-smoke") && !nextActions.some((action) => nextActionClearsWithCommand(action, "fresh-clone-smoke", /git push|README\.md|package\.json/i))) {
    problems.push("nextActionChecklist must include a fresh-clone repair/publish step when the published clone is incomplete");
  }
  if (blockedCheckIds.includes("github-remote-refs") && !nextActions.some((action) => nextActionClearsWithCommand(action, "github-remote-refs", /git push/i))) {
    problems.push("nextActionChecklist must include a manual publish step when GitHub has no refs");
  }
  if (blockedCheckIds.includes("local-head-published") && !nextActions.some((action) => nextActionClearsWithCommand(action, "local-head-published", /git push/i))) {
    problems.push("nextActionChecklist must include a push step when local HEAD is not published");
  }
  if (blockedCheckIds.includes("working-tree-clean") && !nextActions.some((action) => nextActionClearsWithCommand(action, "working-tree-clean", /git status|git diff|git commit/i))) {
    problems.push("nextActionChecklist must include a worktree cleanup/review step when local changes are present");
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

function freshClonePassEvidenceOk(check: Record<string, unknown>) {
  const evidence = Array.isArray(check.evidence) ? check.evidence.map(String) : [];
  return evidence.includes(EXPECTED_REPOSITORY_URL) &&
    evidence.includes(FRESH_CLONE_COMMAND) &&
    evidence.includes(NPM_CI_DRY_RUN_COMMAND) &&
    evidence.includes("fresh-clone-operator-quickstart-contract") &&
    REQUIRED_FRESH_CLONE_PATHS.every((relativePath) => evidence.includes(`fresh-clone:${relativePath}`));
}

function githubLandingPassEvidenceOk(check: Record<string, unknown>) {
  const evidence = Array.isArray(check.evidence) ? check.evidence.map(String) : [];
  return evidence.includes("../README.md") &&
    evidence.includes(GITHUB_LANDING_README_COMMAND_ORDER_EVIDENCE) &&
    evidence.includes(GITHUB_LANDING_README_AI_READINESS_EVIDENCE);
}

function sourceControlNextActions(checks: SourceControlHandoffCheck[]): SourceControlHandoffNextAction[] {
  const statusFor = (id: string) => checks.find((check) => check.id === id)?.status;
  const localGitMissing = statusFor("local-git-metadata") === "blocked";
  const githubLandingReadmeMissing = statusFor("github-landing-readme") === "blocked";
  const remoteMissing = statusFor("configured-github-remote") === "blocked" || statusFor("configured-github-remote") === "warn";
  const remoteRefsMissing = statusFor("github-remote-refs") === "blocked";
  const freshCloneIncomplete = statusFor("fresh-clone-smoke") === "blocked";
  const localHeadUnpublished = statusFor("local-head-published") === "blocked";
  const worktreeDirty = statusFor("working-tree-clean") === "blocked";
  const actions: SourceControlHandoffNextAction[] = [];

  if (githubLandingReadmeMissing) {
    actions.push({
      id: "repair-github-landing-readme",
      status: "required",
      details: "Restore the GitHub landing README fresh-clone path before source-control handoff is considered plug-and-play ready.",
      commands: [
        "git diff -- README.md",
        "npm run test -- operatorQuickstartContract acceptanceScripts",
        "npm run audit:source-control"
      ],
      clearsCheckIds: ["github-landing-readme"]
    });
  }

  if (freshCloneIncomplete) {
    actions.push({
      id: "repair-published-fresh-clone",
      status: "required",
      details: "Repair the published repository contents so a fresh clone contains the landing README, package manifest and lockfile, env template, rehearsal start wrapper, and operator quickstart satisfying the shared quickstart contract.",
      commands: [
        "git status --short --branch",
        "git diff -- README.md software/package.json software/package-lock.json software/.env.example software/scripts/rehearsal-start.sh software/docs/OPERATOR_QUICKSTART.md",
        "npm run test -- operatorQuickstartContract sourceControlHandoff acceptanceScripts",
        "git push origin HEAD:main",
        "npm run audit:source-control"
      ],
      clearsCheckIds: ["fresh-clone-smoke"]
    });
  }

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

  if (worktreeDirty) {
    actions.push({
      id: "review-and-clear-local-worktree",
      status: "required",
      details: "Review uncommitted source changes and either commit intentional work or remove/ignore generated files before publication handoff.",
      commands: [
        "git status --short",
        "git diff --stat",
        "git add <reviewed-files>",
        "git commit -m \"Describe reviewed source-control update\""
      ],
      clearsCheckIds: ["working-tree-clean"]
    });
  }

  if (localHeadUnpublished) {
    actions.push({
      id: "publish-current-local-head",
      status: "required",
      details: "Publish the reviewed local HEAD to the GitHub default branch so plug-and-play users fetch the same source that was audited locally.",
      commands: [
        "git log -1 --oneline",
        "git status --short",
        "git push origin HEAD:main",
        "npm run audit:source-control"
      ],
      clearsCheckIds: ["local-head-published", "github-remote-refs"]
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

function sourceControlCheckIdsAreExact(checks: Record<string, unknown>[]) {
  return checks.length === REQUIRED_SOURCE_CONTROL_CHECK_IDS.length &&
    checks.every((check, index) => check.id === REQUIRED_SOURCE_CONTROL_CHECK_IDS[index]);
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

function shortSha(value: string | undefined) {
  return value ? value.slice(0, 12) : "unknown";
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
