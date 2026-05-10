import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArtifactOutDir, safeIsoTimestampForFileName } from "./artifact-paths";
import { buildCompletionAudit, type CompletionAuditManifest } from "./completion-audit";

type TodoAuditStatus = "pass-real-world-blockers-tracked" | "pass-complete-no-blockers" | "fail";
type TodoAuditCategoryStatus = "pass" | "blocked" | "fail";

export interface TodoAuditTodo {
  sourcePath: string;
  line: number;
  text: string;
}

export interface TodoAuditCategory {
  id: string;
  label: string;
  status: TodoAuditCategoryStatus;
  details: string;
  todoMatches: TodoAuditTodo[];
  completionBlockerMatches: string[];
}

export interface TodoAuditManifest {
  schemaVersion: 1;
  generatedAt: string;
  status: TodoAuditStatus;
  commandUploadEnabled: false;
  checkedDocs: string[];
  uncheckedTodoCount: number;
  categoryCount: number;
  realWorldBlockerCount: number;
  blockedCategoryCount: number;
  validationBlockerCount: number;
  uncheckedTodos: TodoAuditTodo[];
  completionAudit: {
    status: string;
    localAlphaOk: boolean;
    complete: boolean;
    commandUploadEnabled: false;
    realWorldBlockerCount: number;
    artifactPath?: string;
  };
  categories: TodoAuditCategory[];
  validation: {
    ok: boolean;
    warnings: string[];
    blockers: string[];
  };
  limitations: string[];
}

interface TodoCategoryDefinition {
  id: string;
  label: string;
  todoPatterns: RegExp[][];
  blockerPatterns: RegExp[][];
}

const DEFAULT_OUT_DIR = ".tmp/todo-audit";
const COMPLETION_AUDIT_DIR = ".tmp/completion-audit";
const TODO_DOCS = [
  "docs/SEEKR_GCS_ALPHA_TODO.md",
  "docs/SEEKR_COMPLETION_PLAN.md"
];

const CATEGORY_DEFINITIONS: TodoCategoryDefinition[] = [
  {
    id: "fresh-operator-field-laptop",
    label: "Fresh-operator field-laptop rehearsal",
    todoPatterns: [[/field-laptop/i, /fresh[- ]operator|rehearsed|rehearsal/i]],
    blockerPatterns: [[/fresh[- ]operator/i, /field-laptop/i], [/rehearsal closeout/i]]
  },
  {
    id: "jetson-orin-nano-readiness",
    label: "Actual Jetson Orin Nano hardware readiness",
    todoPatterns: [[/Jetson Orin Nano/i, /actual|hardware readiness/i]],
    blockerPatterns: [[/jetson-orin-nano|Jetson Orin Nano/i, /hardware evidence|hardware readiness|host-platform pass|probe remains/i]]
  },
  {
    id: "raspberry-pi-5-readiness",
    label: "Actual Raspberry Pi 5 hardware readiness",
    todoPatterns: [[/Raspberry Pi 5/i, /actual|hardware readiness/i]],
    blockerPatterns: [[/raspberry-pi-5|Raspberry Pi 5/i, /hardware evidence|hardware readiness|host-platform pass|probe remains/i]]
  },
  {
    id: "real-mavlink-telemetry",
    label: "Real read-only MAVLink serial/UDP telemetry",
    todoPatterns: [[/MAVLink/i, /serial\/UDP|serial|UDP/i, /telemetry source|bench hardware/i]],
    blockerPatterns: [[/MAVLink/i, /serial\/UDP|serial|UDP/i, /telemetry source/i]]
  },
  {
    id: "real-ros2-topics",
    label: "Real read-only ROS 2 map, pose, detection, LiDAR, and costmap topics",
    todoPatterns: [[/ROS 2/i, /\/map|map/i, /pose/i, /detection/i, /LiDAR|lidar/i, /costmap/i]],
    blockerPatterns: [[/ROS 2/i, /\/map|map/i, /pose/i, /detection/i, /LiDAR|lidar/i, /costmap/i]]
  },
  {
    id: "hil-failsafe-manual-override",
    label: "Real HIL failsafe/manual override logs",
    todoPatterns: [[/HIL/i, /failsafe/i, /manual override/i]],
    blockerPatterns: [[/HIL/i, /failsafe/i, /manual override/i]]
  },
  {
    id: "isaac-sim-jetson-capture",
    label: "Isaac Sim HIL capture from Jetson bench",
    todoPatterns: [[/Isaac Sim/i, /Jetson bench/i]],
    blockerPatterns: [[/Isaac Sim|Isaac/i, /Jetson bench/i]]
  },
  {
    id: "hardware-actuation-policy-review",
    label: "Reviewed hardware-actuation policy package",
    todoPatterns: [[/hardware-actuation/i, /policy/i, /reviewed|specific bench vehicle/i]],
    blockerPatterns: [[/hardware-actuation/i, /policy/i]]
  }
];

export async function buildTodoAudit(options: {
  root?: string;
  generatedAt?: string;
  completionAudit?: CompletionAuditManifest;
} = {}): Promise<TodoAuditManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const completionAudit = options.completionAudit ?? await buildCompletionAudit({ root, generatedAt });
  const latestCompletion = await latestJson(root, COMPLETION_AUDIT_DIR, (name) => name.startsWith("seekr-completion-audit-"));
  const latestCompletionManifest = latestCompletion ? await readJson(latestCompletion.absolutePath) : undefined;
  const docResults = await Promise.all(TODO_DOCS.map((docPath) => readTodoDoc(root, docPath)));
  const uncheckedTodos = docResults.flatMap((result) => result.todos);
  const missingDocs = docResults.filter((result) => result.missing).map((result) => result.sourcePath);
  const categories = CATEGORY_DEFINITIONS.map((definition) =>
    buildCategory(definition, uncheckedTodos, completionAudit)
  );
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (missingDocs.length) blockers.push(`Missing TODO docs: ${missingDocs.join(", ")}.`);
  if (!latestCompletion) {
    blockers.push("No completion audit artifact exists; run npm run audit:completion before npm run audit:todo.");
  } else if (!completionArtifactMatches(latestCompletionManifest, completionAudit)) {
    blockers.push("Latest completion audit artifact must match the current computed completion audit and keep commandUploadEnabled false.");
  }
  if (completionAudit.commandUploadEnabled !== false) {
    blockers.push("Completion audit commandUploadEnabled must remain false.");
  }

  for (const category of categories) {
    if (category.status === "fail") blockers.push(category.details);
  }
  if (!completionAudit.complete && uncheckedTodos.length === 0) {
    blockers.push("No unchecked TODOs remain even though the completion audit still reports real-world blockers.");
  }
  if (!completionAudit.localAlphaOk) {
    warnings.push("Completion audit localAlphaOk is false; TODO tracking is still checked, but the local alpha evidence chain needs repair.");
  }

  const ok = blockers.length === 0;
  const complete = completionAudit.complete && completionAudit.realWorldBlockers.length === 0;
  const status: TodoAuditStatus = ok
    ? complete ? "pass-complete-no-blockers" : "pass-real-world-blockers-tracked"
    : "fail";
  const blockedCategoryCount = categories.filter((category) => category.status === "blocked").length;

  return {
    schemaVersion: 1,
    generatedAt,
    status,
    commandUploadEnabled: false,
    checkedDocs: TODO_DOCS,
    uncheckedTodoCount: uncheckedTodos.length,
    categoryCount: categories.length,
    realWorldBlockerCount: completionAudit.realWorldBlockers.length,
    blockedCategoryCount,
    validationBlockerCount: blockers.length,
    uncheckedTodos,
    completionAudit: {
      status: completionAudit.status,
      localAlphaOk: completionAudit.localAlphaOk,
      complete: completionAudit.complete,
      commandUploadEnabled: false,
      realWorldBlockerCount: completionAudit.realWorldBlockers.length,
      artifactPath: latestCompletion?.relativePath
    },
    categories,
    validation: {
      ok,
      warnings,
      blockers
    },
    limitations: [
      "This audit checks that unchecked planning TODOs still track the completion audit's real-world blocker categories.",
      "It does not validate Jetson/Pi hardware, real MAVLink telemetry, real ROS 2 topics, HIL behavior, Isaac Sim capture, or hardware actuation.",
      "Real aircraft command upload and hardware actuation remain disabled; this artifact only records documentation and audit consistency."
    ]
  };
}

export async function writeTodoAudit(options: Parameters<typeof buildTodoAudit>[0] & {
  outDir?: string;
} = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveArtifactOutDir(root, options.outDir ?? DEFAULT_OUT_DIR);
  const manifest = await buildTodoAudit(options);
  const safeTimestamp = safeIsoTimestampForFileName(manifest.generatedAt);
  const baseName = `seekr-todo-audit-${safeTimestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const markdownPath = path.join(outDir, `${baseName}.md`);

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");

  return { manifest, jsonPath, markdownPath };
}

function buildCategory(
  definition: TodoCategoryDefinition,
  uncheckedTodos: TodoAuditTodo[],
  completionAudit: CompletionAuditManifest
): TodoAuditCategory {
  const todoMatches = uncheckedTodos.filter((todo) => matchesAnyPatternGroup(todo.text, definition.todoPatterns));
  const completionBlockerMatches = completionAudit.realWorldBlockers.filter((blocker) =>
    matchesAnyPatternGroup(blocker, definition.blockerPatterns)
  );
  const complete = completionAudit.complete && completionAudit.realWorldBlockers.length === 0;

  if (complete) {
    const status: TodoAuditCategoryStatus = todoMatches.length ? "fail" : "pass";
    return {
      id: definition.id,
      label: definition.label,
      status,
      details: status === "pass"
        ? `${definition.label} has no current completion blocker and no unchecked TODO remains.`
        : `${definition.label} still has unchecked TODOs even though the completion audit reports complete.`,
      todoMatches,
      completionBlockerMatches
    };
  }

  const hasTodo = todoMatches.length > 0;
  const hasBlocker = completionBlockerMatches.length > 0;

  if (!hasTodo && !hasBlocker) {
    return {
      id: definition.id,
      label: definition.label,
      status: "pass",
      details: `${definition.label} has no current completion blocker and no unchecked TODO remains.`,
      todoMatches,
      completionBlockerMatches
    };
  }

  const status: TodoAuditCategoryStatus = hasTodo && hasBlocker ? "blocked" : "fail";
  const details = hasTodo
    ? `${definition.label} still has unchecked TODOs even though the completion audit no longer reports that blocker.`
    : `${definition.label} is missing unchecked TODO coverage.`;

  return {
    id: definition.id,
    label: definition.label,
    status,
    details: status === "blocked"
      ? `${definition.label} remains tracked by unchecked TODOs and current completion-audit blockers.`
      : details,
    todoMatches,
    completionBlockerMatches
  };
}

async function readTodoDoc(root: string, sourcePath: string) {
  const absolutePath = path.join(root, sourcePath);
  try {
    const content = await readFile(absolutePath, "utf8");
    return {
      sourcePath,
      missing: false,
      todos: extractUncheckedTodos(sourcePath, content)
    };
  } catch {
    return {
      sourcePath,
      missing: true,
      todos: [] as TodoAuditTodo[]
    };
  }
}

function extractUncheckedTodos(sourcePath: string, content: string): TodoAuditTodo[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = /^\s*-\s+\[\s\]\s+(.+?)\s*$/.exec(line);
    if (!match) return [];
    return [{
      sourcePath,
      line: index + 1,
      text: match[1]
    }];
  });
}

function completionArtifactMatches(manifest: unknown, completionAudit: CompletionAuditManifest) {
  if (!isRecord(manifest)) return false;
  const blockers = Array.isArray(manifest.realWorldBlockers)
    ? manifest.realWorldBlockers.map(String)
    : [];
  return manifest.commandUploadEnabled === false &&
    manifest.status === completionAudit.status &&
    manifest.localAlphaOk === completionAudit.localAlphaOk &&
    manifest.complete === completionAudit.complete &&
    sameStringArray(blockers, completionAudit.realWorldBlockers);
}

async function latestJson(root: string, directory: string, predicate: (name: string) => boolean) {
  const absoluteDir = path.join(root, directory);
  try {
    const names = (await readdir(absoluteDir)).filter((name) => name.endsWith(".json") && predicate(name)).sort();
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

function matchesAnyPatternGroup(value: string, patternGroups: RegExp[][]) {
  return patternGroups.some((group) => group.every((pattern) => pattern.test(value)));
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function renderMarkdown(manifest: TodoAuditManifest) {
  const lines = [
    "# SEEKR TODO Audit",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Status: ${manifest.status}`,
    `Command upload enabled: ${manifest.commandUploadEnabled}`,
    `Unchecked TODO count: ${manifest.uncheckedTodoCount}`,
    `Category count: ${manifest.categoryCount}`,
    `Blocked category count: ${manifest.blockedCategoryCount}`,
    `Validation blocker count: ${manifest.validationBlockerCount}`,
    `Completion audit status: ${manifest.completionAudit.status}`,
    `Completion audit complete: ${manifest.completionAudit.complete}`,
    `Completion real-world blocker count: ${manifest.completionAudit.realWorldBlockerCount}`,
    manifest.completionAudit.artifactPath ? `Completion artifact: ${manifest.completionAudit.artifactPath}` : "Completion artifact: missing",
    "",
    "## Category Coverage",
    "",
    "| Category | Status | TODO Matches | Completion Blockers | Details |",
    "| --- | --- | --- | --- | --- |",
    ...manifest.categories.map((category) =>
      `| ${escapeMarkdown(category.label)} | ${category.status} | ${category.todoMatches.length} | ${category.completionBlockerMatches.length} | ${escapeMarkdown(category.details)} |`
    ),
    "",
    "## Unchecked TODOs",
    "",
    ...manifest.uncheckedTodos.map((todo) => `- ${todo.sourcePath}:${todo.line} ${todo.text}`),
    "",
    "## Validation",
    "",
    `- ok: ${manifest.validation.ok}`,
    ...manifest.validation.blockers.map((blocker) => `- blocker: ${blocker}`),
    ...manifest.validation.warnings.map((warning) => `- warning: ${warning}`),
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

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function escapeMarkdown(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  writeTodoAudit()
    .then(({ manifest, jsonPath, markdownPath }) => {
      console.log(JSON.stringify({
        ok: manifest.validation.ok,
        status: manifest.status,
        commandUploadEnabled: manifest.commandUploadEnabled,
        uncheckedTodoCount: manifest.uncheckedTodoCount,
        categoryCount: manifest.categoryCount,
        realWorldBlockerCount: manifest.realWorldBlockerCount,
        blockedCategoryCount: manifest.blockedCategoryCount,
        validationBlockerCount: manifest.validationBlockerCount,
        jsonPath,
        markdownPath
      }, null, 2));
      process.exit(manifest.validation.ok ? 0 : 1);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
