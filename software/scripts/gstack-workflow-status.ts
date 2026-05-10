import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";

type WorkflowStatus = "pass" | "pass-with-limitations" | "blocked-by-workspace" | "fail";

export interface GstackWorkflowItem {
  id: "health" | "review" | "planning" | "qa";
  status: WorkflowStatus;
  skillAvailable: boolean;
  details: string;
  evidence: string[];
  limitations: string[];
}

export interface GstackPerspectiveItem {
  id: "operator" | "safety" | "dx" | "replay" | "demo-readiness";
  status: string;
  score?: number;
  nextAction?: string;
}

export interface GstackQaReportEvidence {
  status: "pass" | "stale" | "missing" | "fail";
  path?: string;
  generatedAt?: string;
  screenshotPaths: string[];
  commandUploadEnabled: false;
  details: string;
  limitations: string[];
}

export interface GstackHealthHistoryEvidence {
  status: "pass" | "stale" | "missing" | "fail";
  path?: string;
  latestEntry?: {
    ts?: string;
    branch?: string;
    score?: number;
    typecheck?: number | null;
    test?: number | null;
    lint?: number | null;
    deadcode?: number | null;
    shell?: number | null;
    gbrain?: number | null;
  };
  commandUploadEnabled: false;
  details: string;
  limitations: string[];
}

export interface GstackWorkflowStatusManifest {
  schemaVersion: 1;
  generatedAt: string;
  status: "pass" | "pass-with-limitations" | "fail";
  commandUploadEnabled: false;
  gstackAvailable: boolean;
  gstackCliAvailable: boolean;
  gstackCliPath?: string;
  workflows: GstackWorkflowItem[];
  perspectives: GstackPerspectiveItem[];
  qaReport: GstackQaReportEvidence;
  healthHistory: GstackHealthHistoryEvidence;
  evidence: string[];
  limitations: string[];
}

const DEFAULT_OUT_DIR = ".tmp/gstack-workflow-status";
const REQUIRED_PERSPECTIVES = ["operator", "safety", "dx", "replay", "demo-readiness"] as const;
const REQUIRED_SKILLS = {
  health: "gstack-health/SKILL.md",
  review: "gstack-review/SKILL.md",
  planning: "gstack-autoplan/SKILL.md",
  qa: "gstack-qa/SKILL.md"
} as const;

export async function buildGstackWorkflowStatus(options: {
  root?: string;
  generatedAt?: string;
  skillRoot?: string;
  gstackCliPath?: string | false;
  healthHistoryPath?: string | false;
} = {}): Promise<GstackWorkflowStatusManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const skillRoot = options.skillRoot ? path.resolve(options.skillRoot) : await detectGstackSkillRoot();
  const gstackCliPath = options.gstackCliPath === false
    ? undefined
    : options.gstackCliPath ? path.resolve(options.gstackCliPath) : await detectExecutable("gstack");
  const gstackCliAvailable = Boolean(gstackCliPath);
  const packageJson = await readJson(path.join(root, "package.json"));
  const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const goalDoc = await readText(path.join(root, "docs/goal.md"));
  const demo = await latestJson(root, ".tmp/demo-readiness", (name) => name.startsWith("seekr-demo-readiness-"));
  const demoManifest = demo ? await readJson(demo.absolutePath) : undefined;
  const acceptanceStatus = await readJson(path.join(root, ".tmp/acceptance-status.json"));
  const acceptanceGeneratedAt = isRecord(acceptanceStatus) && Number.isFinite(Number(acceptanceStatus.generatedAt))
    ? Number(acceptanceStatus.generatedAt)
    : undefined;
  const healthHistory = await buildHealthHistoryEvidence(root, options.healthHistoryPath, acceptanceGeneratedAt);
  const qaReport = await buildQaReportEvidence(root, acceptanceGeneratedAt);
  const perspectiveReview = isRecord(demoManifest) && Array.isArray(demoManifest.perspectiveReview)
    ? demoManifest.perspectiveReview.filter(isRecord)
    : [];
  const perspectives = REQUIRED_PERSPECTIVES.map((id) => {
    const review = perspectiveReview.find((item) => item.id === id);
    return {
      id,
      status: review ? String(review.status ?? "unknown") : "missing",
      score: Number.isFinite(Number(review?.score)) ? Number(review?.score) : undefined,
      nextAction: typeof review?.nextAction === "string" ? review.nextAction : undefined
    };
  });
  const missingPerspectives = perspectives.filter((item) => item.status === "missing").map((item) => item.id);
  const hasGitMetadata = await pathExists(path.join(root, ".git"));
  const skillAvailability = {
    health: await skillExists(skillRoot, REQUIRED_SKILLS.health),
    review: await skillExists(skillRoot, REQUIRED_SKILLS.review),
    planning: await skillExists(skillRoot, REQUIRED_SKILLS.planning),
    qa: await skillExists(skillRoot, REQUIRED_SKILLS.qa)
  };
  const gstackAvailable = Object.values(skillAvailability).some(Boolean);

  const workflows: GstackWorkflowItem[] = [
    healthWorkflowItem({
      id: "health",
      skillAvailable: skillAvailability.health,
      requiredScripts: ["typecheck", "test"],
      scripts,
      evidence: ["package.json scripts.typecheck", "package.json scripts.test", healthHistory.path ?? "~/.gstack/projects/<project>/health-history.jsonl", "docs/goal.md"],
      docSignals: ["gstack health workflow", "npm run typecheck", "npm run test"],
      goalDoc,
      okDetails: "Health workflow is locally mapped to typecheck and Vitest evidence.",
      failDetails: "Health workflow needs gstack availability plus typecheck/test scripts, docs/goal evidence, and parseable health history when present.",
      healthHistory
    }),
    reviewWorkflowItem({
      skillAvailable: skillAvailability.review,
      hasGitMetadata,
      goalDoc
    }),
    workflowItem({
      id: "planning",
      skillAvailable: skillAvailability.planning,
      requiredScripts: ["audit:completion", "audit:goal"],
      scripts,
      evidence: ["package.json scripts.audit:completion", "package.json scripts.audit:goal", demo?.relativePath ?? ".tmp/demo-readiness"],
      docSignals: ["Planning:", "operator", "safety", "DX", "replay", "demo-readiness"],
      goalDoc,
      okDetails: "Planning workflow is mapped to completion/goal audits and the demo perspective review.",
      failDetails: "Planning workflow needs gstack availability, audit scripts, docs/goal perspective signals, and demo perspectives.",
      missingPerspectives
    }),
    qaWorkflowItem({
      id: "qa",
      skillAvailable: skillAvailability.qa,
      requiredScripts: ["test:ui"],
      scripts,
      evidence: ["package.json scripts.test:ui", demo?.relativePath ?? ".tmp/demo-readiness", qaReport.path ?? ".gstack/qa-reports", "docs/goal.md"],
      docSignals: ["QA:", "Playwright"],
      goalDoc,
      okDetails: "QA workflow is mapped to Playwright UI coverage and demo-readiness perspective evidence.",
      failDetails: "QA workflow needs gstack availability, test:ui, docs/goal QA signals, and demo perspectives.",
      missingPerspectives,
      qaReport
    })
  ];
  const hasFail = workflows.some((item) => item.status === "fail");
  const hasLimitations = !gstackCliAvailable ||
    workflows.some((item) => item.status === "blocked-by-workspace" || item.status === "pass-with-limitations");

  return {
    schemaVersion: 1,
    generatedAt,
    status: hasFail ? "fail" : hasLimitations ? "pass-with-limitations" : "pass",
    commandUploadEnabled: false,
    gstackAvailable,
    gstackCliAvailable,
    gstackCliPath,
    workflows,
    perspectives,
    qaReport,
    healthHistory,
    evidence: [
      "docs/goal.md",
      "package.json",
      demo?.relativePath ?? ".tmp/demo-readiness",
      healthHistory.path ?? "~/.gstack/projects/<project>/health-history.jsonl",
      qaReport.path ?? ".gstack/qa-reports",
      ...qaReport.screenshotPaths,
      gstackCliPath ?? "gstack CLI unavailable on PATH",
      skillRoot ? path.relative(root, skillRoot).split(path.sep).join("/") : "gstack skills unavailable"
    ],
    limitations: [
      gstackCliAvailable
        ? `gstack CLI was found at ${gstackCliPath}; local workflow evidence is still recorded through package scripts for reproducibility.`
        : "gstack CLI is not available on PATH; workflow status is recorded from installed skill files and local package-script evidence instead of claiming CLI execution.",
      hasGitMetadata
        ? "Git metadata is present, so a diff review can be run against a base branch."
        : "No .git metadata is present in this workspace, so gstack diff review is recorded as blocked-by-workspace instead of claimed as run.",
      "This artifact records workflow availability and local evidence mapping; it does not validate physical Jetson/Pi hardware or real MAVLink/ROS/HIL evidence.",
      "All aircraft command upload and hardware actuation authority remains disabled."
    ].concat(qaReport.status === "missing" ? ["No local gstack browser QA report was found under .gstack/qa-reports; Playwright remains the local QA fallback."] : [])
      .concat(qaReport.status === "stale" ? ["The latest local gstack browser QA report predates the latest acceptance record; refresh browser QA for current-review evidence."] : [])
      .concat(qaReport.status === "fail" ? ["The latest local gstack browser QA report did not prove a passing command-safe QA run."] : [])
      .concat(healthHistory.status === "missing" ? ["No gstack health history was found; typecheck/test package scripts remain the local health fallback."] : [])
      .concat(healthHistory.status === "stale" ? ["The latest gstack health history entry predates the latest acceptance record; refresh /health for trend accuracy."] : [])
      .concat(healthHistory.status === "fail" ? ["The gstack health history file exists but could not be parsed into a valid latest health entry."] : [])
  };
}

async function buildHealthHistoryEvidence(
  root: string,
  requestedPath: string | false | undefined,
  acceptanceGeneratedAt?: number
): Promise<GstackHealthHistoryEvidence> {
  const filePath = requestedPath === false ? undefined : requestedPath ?? defaultHealthHistoryPath(root);
  const displayPath = requestedPath === false ? undefined : displayHomeRelative(filePath);
  if (!filePath) {
    return {
      status: "missing",
      commandUploadEnabled: false,
      details: "No gstack health history path was configured.",
      limitations: ["Health trend history is not configured for this workflow artifact."]
    };
  }

  const content = await readText(filePath);
  if (!content.trim()) {
    return {
      status: "missing",
      path: displayPath,
      commandUploadEnabled: false,
      details: "No gstack health history entries were found.",
      limitations: ["Run the gstack health workflow to append a health-history entry."]
    };
  }

  const latestLine = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  if (!latestLine) {
    return {
      status: "missing",
      path: displayPath,
      commandUploadEnabled: false,
      details: "No gstack health history entries were found.",
      limitations: ["Run the gstack health workflow to append a health-history entry."]
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(latestLine);
  } catch {
    return {
      status: "fail",
      path: displayPath,
      commandUploadEnabled: false,
      details: "Latest gstack health history entry is not valid JSON.",
      limitations: ["Latest health-history JSONL line must parse as JSON."]
    };
  }
  if (!isRecord(parsed) || !Number.isFinite(Number(parsed.score))) {
    return {
      status: "fail",
      path: displayPath,
      commandUploadEnabled: false,
      details: "Latest gstack health history entry is missing a numeric score.",
      limitations: ["Latest health-history entry must include a numeric score."]
    };
  }

  const ts = healthHistoryTimestamp(parsed);
  const tsMs = ts ? Date.parse(ts) : Number.NaN;
  const timestampMissing = !Number.isFinite(tsMs);
  const stale = timestampMissing ||
    (Number.isFinite(acceptanceGeneratedAt) &&
      typeof acceptanceGeneratedAt === "number" &&
      tsMs < acceptanceGeneratedAt);

  return {
    status: stale ? "stale" : "pass",
    path: displayPath,
    latestEntry: {
      ts,
      branch: typeof parsed.branch === "string" ? parsed.branch : undefined,
      score: Number(parsed.score),
      typecheck: numberOrNull(parsed.typecheck),
      test: numberOrNull(parsed.test),
      lint: numberOrNull(parsed.lint),
      deadcode: numberOrNull(parsed.deadcode),
      shell: numberOrNull(parsed.shell),
      gbrain: numberOrNull(parsed.gbrain)
    },
    commandUploadEnabled: false,
    details: timestampMissing
      ? "Latest gstack health history entry exists but is missing a parseable timestamp, so freshness cannot be proven."
      : stale
      ? "Latest gstack health history entry exists but predates the latest acceptance record."
      : "Latest gstack health history entry is parseable and current relative to the available acceptance record.",
    limitations: [
      ...(timestampMissing ? ["Latest health-history entry is missing a parseable timestamp."] : []),
      ...(stale && !timestampMissing ? ["Latest health-history entry predates the latest acceptance record."] : [])
    ]
  };
}

async function buildQaReportEvidence(root: string, acceptanceGeneratedAt?: number): Promise<GstackQaReportEvidence> {
  const latest = await latestFile(root, ".gstack/qa-reports", (name) => name.startsWith("seekr-qa-") && name.endsWith(".md"));
  if (!latest) {
    return {
      status: "missing",
      screenshotPaths: [],
      commandUploadEnabled: false,
      details: "No local gstack browser QA report was found under .gstack/qa-reports.",
      limitations: ["Run the gstack browser QA workflow when the browser tooling is available; Playwright UI tests remain the local fallback."]
    };
  }

  const content = await readText(latest.absolutePath);
  const generatedAt = /^Generated:\s*(.+)$/m.exec(content)?.[1]?.trim();
  const generatedAtMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const pass = content.includes("Pass for local internal-alpha browser/API QA") ||
    /## Verdict\s+Pass\b/is.test(content) ||
    /Status:\s*pass\b/i.test(content);
  const commandSafe = content.includes("commandUploadEnabled` stayed `false`") ||
    content.includes("commandUploadEnabled: false") ||
    content.includes("Command upload enabled: false");
  const failedCheckRows = qaReportFailedRows(content);
  const checksPass = failedCheckRows.length === 0;
  const screenshotPaths = extractQaScreenshotPaths(content);
  const missingScreenshotPaths = [];
  for (const screenshotPath of screenshotPaths) {
    const absolutePath = path.resolve(root, screenshotPath);
    if (!isInsideRoot(root, absolutePath) || !(await pathExists(absolutePath))) missingScreenshotPaths.push(screenshotPath);
  }
  const screenshotsOk = missingScreenshotPaths.length === 0;
  const stale = pass && commandSafe && checksPass && screenshotsOk &&
    Number.isFinite(generatedAtMs) &&
    Number.isFinite(acceptanceGeneratedAt) &&
    typeof acceptanceGeneratedAt === "number" &&
    generatedAtMs < acceptanceGeneratedAt;
  const status = pass && commandSafe && checksPass && screenshotsOk ? stale ? "stale" : "pass" : "fail";

  return {
    status,
    path: latest.relativePath,
    generatedAt,
    screenshotPaths,
    commandUploadEnabled: false,
    details: status === "pass"
      ? "Latest local gstack browser QA report records a passing internal-alpha browser/API QA run with command upload disabled and is current relative to acceptance."
      : status === "stale"
        ? "Latest local gstack browser QA report records a passing command-safe QA run but predates the latest acceptance record."
      : "Latest local gstack browser QA report must record a passing browser/API QA run and commandUploadEnabled false.",
    limitations: [
      ...(!generatedAt ? ["QA report is missing a Generated timestamp."] : []),
      ...(generatedAt && !Number.isFinite(generatedAtMs) ? ["QA report Generated timestamp is not parseable."] : []),
      ...(stale ? ["QA report predates the latest acceptance record."] : []),
      ...(pass ? [] : ["QA report does not contain a passing verdict."]),
      ...(commandSafe ? [] : ["QA report does not prove commandUploadEnabled false."]),
      ...failedCheckRows.map((row) => `QA report includes failing check row: ${row}.`),
      ...missingScreenshotPaths.map((screenshotPath) => `QA report references a missing screenshot artifact: ${screenshotPath}.`)
    ]
  };
}

function extractQaScreenshotPaths(content: string) {
  const paths = new Set<string>();
  const pattern = /(?:`)?((?:\.gstack\/qa-reports\/screenshots\/)[^`\s)]+\.png)(?:`)?/g;
  for (const match of content.matchAll(pattern)) {
    if (match[1]) paths.add(match[1]);
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function qaReportFailedRows(content: string) {
  return content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2 && cells[0] !== "Check" && !/^[-: ]+$/.test(cells.join("")))
    .filter((cells) => /^fail\b/i.test(cells[1]))
    .map((cells) => cells.slice(0, 3).join(" | "));
}

export async function writeGstackWorkflowStatus(options: Parameters<typeof buildGstackWorkflowStatus>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildGstackWorkflowStatus(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-gstack-workflow-status-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function workflowItem(options: {
  id: GstackWorkflowItem["id"];
  skillAvailable: boolean;
  requiredScripts: string[];
  scripts: Record<string, unknown>;
  evidence: string[];
  docSignals: string[];
  goalDoc: string;
  okDetails: string;
  failDetails: string;
  missingPerspectives?: string[];
}): GstackWorkflowItem {
  const missingScripts = options.requiredScripts.filter((script) => typeof options.scripts[script] !== "string");
  const missingDocSignals = options.docSignals.filter((signal) => !options.goalDoc.includes(signal));
  const limitations: string[] = [];
  if (!options.skillAvailable) limitations.push("gstack skill file was not found locally");
  if (missingScripts.length) limitations.push(`missing package scripts: ${missingScripts.join(", ")}`);
  if (missingDocSignals.length) limitations.push(`docs/goal.md missing workflow signals: ${missingDocSignals.join(", ")}`);
  if (options.missingPerspectives?.length) {
    limitations.push(`demo package missing perspectives: ${options.missingPerspectives.join(", ")}`);
  }

  return {
    id: options.id,
    status: limitations.length ? "fail" : "pass",
    skillAvailable: options.skillAvailable,
    details: limitations.length ? options.failDetails : options.okDetails,
    evidence: options.evidence,
    limitations
  };
}

function healthWorkflowItem(options: Parameters<typeof workflowItem>[0] & {
  healthHistory: GstackHealthHistoryEvidence;
}): GstackWorkflowItem {
  const base = workflowItem(options);
  const limitations = [...base.limitations];
  const timestampMissing = options.healthHistory.limitations.some((item) => item.includes("parseable timestamp"));
  if (options.healthHistory.status === "missing") {
    limitations.push("gstack health history was not found");
  } else if (options.healthHistory.status === "stale") {
    limitations.push(timestampMissing
      ? "gstack health history freshness cannot be proven"
      : "gstack health history predates the latest acceptance record");
  } else if (options.healthHistory.status === "fail") {
    limitations.push("gstack health history is malformed");
  }
  const hardFailure = base.status === "fail" || options.healthHistory.status === "fail";
  return {
    ...base,
    status: hardFailure ? "fail" : limitations.length ? "pass-with-limitations" : "pass",
    details: hardFailure
      ? options.failDetails
      : options.healthHistory.status === "missing"
        ? "Health workflow is mapped to typecheck and Vitest; gstack health history is missing."
        : options.healthHistory.status === "stale"
          ? timestampMissing
            ? "Health workflow is mapped to typecheck and Vitest; gstack health history needs a parseable timestamp for freshness proof."
            : "Health workflow is mapped to typecheck and Vitest; gstack health history needs refresh for trend accuracy."
          : "Health workflow is mapped to typecheck, Vitest, and the latest gstack health history entry.",
    limitations
  };
}

function qaWorkflowItem(options: Parameters<typeof workflowItem>[0] & {
  qaReport: GstackQaReportEvidence;
}): GstackWorkflowItem {
  const base = workflowItem(options);
  const limitations = [...base.limitations];
  if (options.qaReport.status === "missing") {
    limitations.push("local gstack browser QA report was not found");
  } else if (options.qaReport.status === "stale") {
    limitations.push("local gstack browser QA report predates the latest acceptance record");
  } else if (options.qaReport.status === "fail") {
    limitations.push("local gstack browser QA report did not prove passing command-safe QA");
  }
  const hardFailure = base.status === "fail" || options.qaReport.status === "fail";
  return {
    ...base,
    status: hardFailure ? "fail" : limitations.length ? "pass-with-limitations" : "pass",
    details: hardFailure
      ? options.failDetails
      : options.qaReport.status === "missing"
        ? "QA workflow is mapped to Playwright UI coverage; local gstack browser QA report is missing."
        : options.qaReport.status === "stale"
          ? "QA workflow is mapped to Playwright UI coverage; local gstack browser QA report needs refresh for current-review evidence."
          : "QA workflow is mapped to Playwright UI coverage and the latest local gstack browser QA report.",
    limitations
  };
}

function reviewWorkflowItem(options: {
  skillAvailable: boolean;
  hasGitMetadata: boolean;
  goalDoc: string;
}): GstackWorkflowItem {
  const limitations: string[] = [];
  if (!options.skillAvailable) limitations.push("gstack review skill file was not found locally");
  if (!options.goalDoc.includes("Review:")) limitations.push("docs/goal.md missing Review workflow signal");
  if (!options.hasGitMetadata) limitations.push("workspace has no .git metadata for base-branch diff review");

  const hardFailures = limitations.filter((item) => !item.includes("no .git metadata"));
  const status: WorkflowStatus = hardFailures.length
    ? "fail"
    : options.hasGitMetadata ? "pass-with-limitations" : "blocked-by-workspace";

  return {
    id: "review",
    status,
    skillAvailable: options.skillAvailable,
    details: status === "blocked-by-workspace"
      ? "Review workflow is available, but pre-landing diff review is blocked because this workspace has no .git metadata."
      : status === "fail"
        ? "Review workflow needs gstack availability and docs/goal review status."
        : "Review workflow is mapped; run gstack review against a base branch when Git metadata is available.",
    evidence: ["docs/goal.md", ".git"],
    limitations
  };
}

async function detectGstackSkillRoot() {
  const home = process.env.HOME ?? "";
  const candidates = [
    path.join(home, ".gstack/repos/gstack/.agents/skills"),
    path.join(home, ".claude/skills/gstack/.agents/skills"),
    path.join(home, ".codex/skills/gstack")
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

async function detectExecutable(name: string) {
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

async function skillExists(skillRoot: string | undefined, relativePath: string) {
  if (!skillRoot) return false;
  return await pathExists(path.join(skillRoot, relativePath));
}

async function latestJson(root: string, directory: string, predicate: (name: string) => boolean) {
  return await latestFile(root, directory, (name) => name.endsWith(".json") && predicate(name));
}

async function latestFile(root: string, directory: string, predicate: (name: string) => boolean) {
  const absoluteDir = path.join(root, directory);
  try {
    const names = (await readdir(absoluteDir)).filter(predicate).sort();
    const latest = names.at(-1);
    if (!latest) return undefined;
    return {
      absolutePath: path.join(absoluteDir, latest),
      relativePath: path.join(directory, latest).split(path.sep).join("/")
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

function isInsideRoot(root: string, absolutePath: string) {
  return absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`);
}

function defaultHealthHistoryPath(root: string) {
  const home = process.env.HOME ?? "";
  const projectName = path.basename(root) || "unknown";
  return path.join(home, ".gstack/projects", projectName, "health-history.jsonl");
}

function displayHomeRelative(filePath: string | undefined) {
  if (!filePath) return undefined;
  const home = process.env.HOME;
  if (home && filePath.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, filePath).split(path.sep).join("/")}`;
  }
  return filePath.split(path.sep).join("/");
}

function numberOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function healthHistoryTimestamp(entry: Record<string, unknown>) {
  if (typeof entry.ts === "string") return entry.ts;
  if (typeof entry.timestamp === "string") return entry.timestamp;
  return undefined;
}

function renderMarkdown(manifest: GstackWorkflowStatusManifest) {
  const lines = [
    "# SEEKR GStack Workflow Status",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `Command upload enabled: ${manifest.commandUploadEnabled}`,
    `GStack available: ${manifest.gstackAvailable}`,
    `GStack CLI available: ${manifest.gstackCliAvailable}`,
    manifest.gstackCliPath ? `GStack CLI path: ${manifest.gstackCliPath}` : undefined,
    "",
    "## Workflows",
    "",
    "| Workflow | Status | Evidence | Details | Limitations |",
    "| --- | --- | --- | --- | --- |",
    ...manifest.workflows.map((workflow) =>
      `| ${workflow.id} | ${workflow.status} | ${escapeMarkdown(workflow.evidence.join(", "))} | ${escapeMarkdown(workflow.details)} | ${escapeMarkdown(workflow.limitations.join("; ") || "none")} |`
    ),
    "",
    "## Perspectives",
    "",
    "| Perspective | Status | Score | Next action |",
    "| --- | --- | --- | --- |",
    ...manifest.perspectives.map((perspective) =>
      `| ${perspective.id} | ${perspective.status} | ${perspective.score ?? ""} | ${escapeMarkdown(perspective.nextAction ?? "")} |`
    ),
    "",
    "## GStack Health History",
    "",
    `Status: ${manifest.healthHistory.status}`,
    manifest.healthHistory.path ? `Path: ${manifest.healthHistory.path}` : undefined,
    manifest.healthHistory.latestEntry?.ts ? `Latest entry: ${manifest.healthHistory.latestEntry.ts}` : undefined,
    typeof manifest.healthHistory.latestEntry?.score === "number" ? `Score: ${manifest.healthHistory.latestEntry.score}` : undefined,
    `Command upload enabled: ${manifest.healthHistory.commandUploadEnabled}`,
    `Details: ${manifest.healthHistory.details}`,
    ...(manifest.healthHistory.limitations.length ? manifest.healthHistory.limitations.map((item) => `- ${item}`) : ["- Limitations: none"]),
    "",
    "## Local GStack QA Report",
    "",
    `Status: ${manifest.qaReport.status}`,
    manifest.qaReport.path ? `Path: ${manifest.qaReport.path}` : undefined,
    manifest.qaReport.generatedAt ? `Generated: ${manifest.qaReport.generatedAt}` : undefined,
    manifest.qaReport.screenshotPaths.length ? "Screenshots:" : undefined,
    ...manifest.qaReport.screenshotPaths.map((screenshotPath) => `- ${screenshotPath}`),
    `Command upload enabled: ${manifest.qaReport.commandUploadEnabled}`,
    `Details: ${manifest.qaReport.details}`,
    ...(manifest.qaReport.limitations.length ? manifest.qaReport.limitations.map((item) => `- ${item}`) : ["- Limitations: none"]),
    "",
    "## Limitations",
    "",
    ...manifest.limitations.map((limitation) => `- ${limitation}`),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeMarkdown(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  writeGstackWorkflowStatus()
    .then(({ manifest, jsonPath, markdownPath }) => {
      console.log(JSON.stringify({
        ok: manifest.status !== "fail",
        status: manifest.status,
        commandUploadEnabled: manifest.commandUploadEnabled,
        gstackAvailable: manifest.gstackAvailable,
        gstackCliAvailable: manifest.gstackCliAvailable,
        gstackCliPath: manifest.gstackCliPath,
        workflowCount: manifest.workflows.length,
        perspectiveCount: manifest.perspectives.length,
        healthHistoryStatus: manifest.healthHistory.status,
        healthHistoryPath: manifest.healthHistory.path,
        qaReportStatus: manifest.qaReport.status,
        qaReportPath: manifest.qaReport.path,
        qaScreenshotPaths: manifest.qaReport.screenshotPaths,
        jsonPath,
        markdownPath
      }, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
