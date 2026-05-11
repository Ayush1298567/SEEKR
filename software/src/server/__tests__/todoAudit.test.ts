import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompletionAuditManifest } from "../../../scripts/completion-audit";
import { buildTodoAudit, writeTodoAudit } from "../../../scripts/todo-audit";

const GENERATED_AT = "2026-05-10T01:00:00.000Z";

describe("todo audit", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-todo-audit-test-${process.pid}-${Date.now()}`);
    await seedRoot(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes machine-readable coverage for unchecked real-world blocker TODOs", async () => {
    const result = await writeTodoAudit({
      root,
      generatedAt: GENERATED_AT,
      completionAudit: blockedCompletionAudit()
    });

    expect(result.manifest.status).toBe("pass-real-world-blockers-tracked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.uncheckedTodoCount).toBe(8);
    expect(result.manifest.categoryCount).toBe(8);
    expect(result.manifest.realWorldBlockerCount).toBe(8);
    expect(result.manifest.blockedCategoryCount).toBe(8);
    expect(result.manifest.validationBlockerCount).toBe(0);
    expect(result.manifest.categories).toHaveLength(8);
    expect(result.manifest.categories.every((category) => category.status === "blocked")).toBe(true);
    expect(result.manifest.categories.find((category) => category.id === "real-ros2-topics")).toMatchObject({
      todoMatches: [expect.objectContaining({ text: expect.stringContaining("LiDAR") })],
      completionBlockerMatches: [expect.stringContaining("ROS 2")]
    });
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Category Coverage");
  });

  it("fails when an unchecked blocker TODO is removed from the planning docs", async () => {
    await writeTodoDocs(root, { omitMavlink: true });

    const manifest = await buildTodoAudit({
      root,
      generatedAt: GENERATED_AT,
      completionAudit: blockedCompletionAudit()
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.validation.blockers.join("\n")).toContain("Real read-only MAVLink serial/UDP telemetry");
    expect(manifest.categories.find((category) => category.id === "real-mavlink-telemetry")).toMatchObject({
      status: "fail",
      todoMatches: []
    });
  });

  it("passes a partially cleared blocker category when its TODO is also checked off", async () => {
    const completion = blockedCompletionAudit();
    completion.summary.blocked = 7;
    completion.realWorldBlockers = completion.realWorldBlockers.filter((blocker) =>
      !blocker.includes("host-platform pass was found for: jetson-orin-nano")
    );
    await writeCompletionArtifact(root, completion);
    await writeTodoDocs(root, { completedJetson: true });

    const manifest = await buildTodoAudit({
      root,
      generatedAt: GENERATED_AT,
      completionAudit: completion
    });

    expect(manifest.status).toBe("pass-real-world-blockers-tracked");
    expect(manifest.validation.ok).toBe(true);
    expect(manifest.completionAudit.realWorldBlockerCount).toBe(7);
    expect(manifest.realWorldBlockerCount).toBe(7);
    expect(manifest.blockedCategoryCount).toBe(7);
    expect(manifest.categories.find((category) => category.id === "jetson-orin-nano-readiness")).toMatchObject({
      status: "pass",
      todoMatches: [],
      completionBlockerMatches: []
    });
    expect(manifest.categories.find((category) => category.id === "raspberry-pi-5-readiness")).toMatchObject({
      status: "blocked"
    });
  });

  it("fails closed when the completion audit artifact is missing", async () => {
    await rm(path.join(root, ".tmp/completion-audit"), { recursive: true, force: true });

    const manifest = await buildTodoAudit({
      root,
      generatedAt: GENERATED_AT,
      completionAudit: blockedCompletionAudit()
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.validation.blockers.join("\n")).toContain("No completion audit artifact exists");
  });

  it("fails closed when the completion audit artifact is stale", async () => {
    const stale = blockedCompletionAudit();
    stale.realWorldBlockers = stale.realWorldBlockers.slice(1);
    await writeCompletionArtifact(root, stale);

    const manifest = await buildTodoAudit({
      root,
      generatedAt: GENERATED_AT,
      completionAudit: blockedCompletionAudit()
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.validation.blockers.join("\n")).toContain("Latest completion audit artifact must match");
  });

  it("requires blocker TODOs to be cleared when completion is complete", async () => {
    const completion = completeCompletionAudit();
    await writeCompletionArtifact(root, completion);
    await writeTodoDocs(root, { completed: true });

    const manifest = await buildTodoAudit({
      root,
      generatedAt: GENERATED_AT,
      completionAudit: completion
    });

    expect(manifest.status).toBe("pass-complete-no-blockers");
    expect(manifest.uncheckedTodoCount).toBe(0);
    expect(manifest.realWorldBlockerCount).toBe(0);
    expect(manifest.blockedCategoryCount).toBe(0);
    expect(manifest.categories.every((category) => category.status === "pass")).toBe(true);
  });
});

async function seedRoot(root: string) {
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, ".tmp/completion-audit"), { recursive: true });
  await writeTodoDocs(root);
  await writeCompletionArtifact(root, blockedCompletionAudit());
}

async function writeTodoDocs(root: string, options: {
  omitMavlink?: boolean;
  completed?: boolean;
  completedJetson?: boolean;
} = {}) {
  const box = options.completed ? "x" : " ";
  const jetsonBox = options.completed || options.completedJetson ? "x" : " ";
  const gcsTodos = [
    "# SEEKR GCS Internal Alpha Todo",
    "",
    "## Drone Integration Prerequisites",
    "",
    `- [${jetsonBox}] Run hardware readiness probe on an actual Jetson Orin Nano.`,
    `- [${box}] Run hardware readiness probe on an actual Raspberry Pi 5.`,
    `- [${box}] Add HIL bench logs for failsafe behavior with manual override evidence.`,
    `- [${box}] Add reviewed hardware-actuation policy file for a specific bench vehicle before any real command enablement.`,
    ...(options.omitMavlink ? [] : [
      `- [${box}] Connect read-only MAVLink bridge to a real serial/UDP telemetry source on bench hardware.`
    ]),
    `- [${box}] Connect read-only ROS 2 bridge to real \`/map\`, pose, detection, LiDAR, and costmap topics on bench hardware.`,
    `- [${box}] Add Isaac Sim HIL fixture capture from Jetson bench run.`,
    ""
  ];
  const completionPlan = [
    "# SEEKR Completion Plan",
    "",
    "## Customer View",
    "",
    `- [${box}] Field-laptop runbook is rehearsed by a fresh operator.`,
    ""
  ];

  await writeFile(path.join(root, "docs/SEEKR_GCS_ALPHA_TODO.md"), gcsTodos.join("\n"), "utf8");
  await writeFile(path.join(root, "docs/SEEKR_COMPLETION_PLAN.md"), completionPlan.join("\n"), "utf8");
}

async function writeCompletionArtifact(root: string, manifest: CompletionAuditManifest) {
  await mkdir(path.join(root, ".tmp/completion-audit"), { recursive: true });
  await writeFile(
    path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json"),
    JSON.stringify(manifest),
    "utf8"
  );
}

function blockedCompletionAudit(): CompletionAuditManifest {
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    status: "blocked-real-world-evidence",
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    summary: { pass: 9, warn: 0, fail: 0, blocked: 8 },
    items: [],
    realWorldBlockerIds: [
      "actual-jetson-orin-nano-hardware-evidence",
      "actual-raspberry-pi-5-hardware-evidence",
      "fresh-operator-rehearsal",
      "real-mavlink-bench",
      "real-ros2-bench",
      "hil-failsafe-manual-override",
      "isaac-sim-jetson-capture",
      "hardware-actuation-policy-review"
    ],
    realWorldBlockers: [
      "Hardware archives exist, but no actual-target host-platform pass was found for: jetson-orin-nano.",
      "Hardware archives exist, but no actual-target host-platform pass was found for: raspberry-pi-5.",
      "No fresh-operator field-laptop rehearsal closeout with setup, acceptance, export, replay, and shutdown timestamps is present.",
      "No evidence shows a real serial/UDP MAVLink telemetry source connected to the read-only bridge on bench hardware. Actual target-board evidence is missing for: jetson-orin-nano, raspberry-pi-5.",
      "No evidence shows real ROS 2 /map, pose, detection, LiDAR, or costmap topics connected through the read-only bridge. Actual target-board evidence is missing for: jetson-orin-nano, raspberry-pi-5.",
      "No HIL failsafe run with manual override evidence has been archived.",
      "No Isaac Sim HIL fixture output captured from a Jetson bench run has been archived.",
      "Hardware-actuation policy gate evidence exists, but no valid ready-for-human-review artifact with false authorization fields was found."
    ]
  };
}

function completeCompletionAudit(): CompletionAuditManifest {
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    status: "complete",
    localAlphaOk: true,
    complete: true,
    commandUploadEnabled: false,
    summary: { pass: 17, warn: 0, fail: 0, blocked: 0 },
    items: [],
    realWorldBlockerIds: [],
    realWorldBlockers: []
  };
}
