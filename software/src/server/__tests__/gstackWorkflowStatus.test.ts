import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGstackWorkflowStatus, writeGstackWorkflowStatus } from "../../../scripts/gstack-workflow-status";

const GENERATED_AT = "2026-05-09T21:00:00.000Z";
const qaHomeScreenshotPath = ".gstack/qa-reports/screenshots/seekr-qa-2026-05-09T20-55-00Z-clean-home.png";
const qaMobileScreenshotPath = ".gstack/qa-reports/screenshots/seekr-qa-2026-05-09T20-55-00Z-clean-mobile.png";

describe("gstack workflow status", () => {
  let root: string;
  let skillRoot: string;
  let healthHistoryPath: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-gstack-workflow-test-${process.pid}-${Date.now()}`);
    skillRoot = path.join(root, ".skills");
    healthHistoryPath = path.join(root, ".gstack/projects/software/health-history.jsonl");
    await seedRoot(root, skillRoot);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes machine-readable workflow status while recording git review as workspace-blocked", async () => {
    const result = await writeGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: false,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(result.manifest.status).toBe("pass-with-limitations");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.gstackAvailable).toBe(true);
    expect(result.manifest.gstackCliAvailable).toBe(false);
    expect(result.manifest.healthHistory).toMatchObject({
      status: "pass",
      path: healthHistoryPath.split(path.sep).join("/"),
      commandUploadEnabled: false,
      latestEntry: {
        score: 10,
        typecheck: 10,
        test: 10
      }
    });
    expect(result.manifest.workflows.find((item) => item.id === "health")).toMatchObject({
      status: "pass",
      evidence: expect.arrayContaining([healthHistoryPath.split(path.sep).join("/")])
    });
    expect(result.manifest.qaReport).toMatchObject({
      status: "pass",
      path: ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md",
      screenshotPaths: [qaHomeScreenshotPath, qaMobileScreenshotPath],
      commandUploadEnabled: false
    });
    expect(result.manifest.workflows.find((item) => item.id === "review")).toMatchObject({
      status: "blocked-by-workspace",
      skillAvailable: true
    });
    expect(result.manifest.workflows.find((item) => item.id === "qa")).toMatchObject({
      status: "pass",
      evidence: expect.arrayContaining([".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md"])
    });
    expect(result.manifest.perspectives.map((item) => item.id)).toEqual([
      "operator",
      "safety",
      "dx",
      "replay",
      "demo-readiness"
    ]);
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("GStack Workflow Status");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("GStack CLI available: false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Local GStack QA Report");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
  });

  it("records the gstack CLI path when it is explicitly available", async () => {
    const cliPath = path.join(root, "bin/gstack");
    await mkdir(path.dirname(cliPath), { recursive: true });
    await writeFile(cliPath, "#!/bin/sh\n", "utf8");

    const manifest = await buildGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: cliPath,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(manifest.gstackCliAvailable).toBe(true);
    expect(manifest.gstackCliPath).toBe(cliPath);
    expect(manifest.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining("gstack CLI was found")
    ]));
  });

  it("records local gstack helper tools separately from the umbrella CLI", async () => {
    const toolRoot = path.join(root, "gstack-bin");
    const toolPath = path.join(toolRoot, "gstack-slug");
    await mkdir(toolRoot, { recursive: true });
    await writeFile(toolPath, "#!/bin/sh\n", "utf8");
    await chmod(toolPath, 0o755);

    const result = await writeGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: false,
      gstackToolRoot: toolRoot,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(result.manifest.gstackCliAvailable).toBe(false);
    expect(result.manifest.gstackToolRoot).toBe(toolRoot.split(path.sep).join("/"));
    expect(result.manifest.gstackToolCount).toBe(1);
    expect(result.manifest.gstackToolNames).toEqual(["gstack-slug"]);
    expect(result.manifest.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining("1 gstack helper tools")
    ]));
    expect(result.manifest.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining("local gstack helper tools are installed")
    ]));
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("GStack helper tool count: 1");
  });

  it("detects Git metadata from a parent repository root", async () => {
    const workspaceRoot = path.join(os.tmpdir(), `seekr-gstack-parent-git-${process.pid}-${Date.now()}`);
    const softwareRoot = path.join(workspaceRoot, "software");
    const parentSkillRoot = path.join(workspaceRoot, ".skills");
    const parentHealthHistoryPath = path.join(workspaceRoot, ".gstack/projects/software/health-history.jsonl");
    await mkdir(path.join(workspaceRoot, ".git"), { recursive: true });
    await seedRoot(softwareRoot, parentSkillRoot, parentHealthHistoryPath);

    try {
      const manifest = await buildGstackWorkflowStatus({
        root: softwareRoot,
        skillRoot: parentSkillRoot,
        gstackCliPath: false,
        healthHistoryPath: parentHealthHistoryPath,
        generatedAt: GENERATED_AT
      });

      expect(manifest.gitMetadataPath).toBe("../.git");
      expect(manifest.workflows.find((item) => item.id === "review")).toMatchObject({
        status: "pass",
        evidence: expect.arrayContaining(["../.git"]),
        details: expect.stringContaining("../.git"),
        limitations: []
      });
      expect(manifest.limitations).toEqual(expect.arrayContaining([
        expect.stringContaining("Git metadata is present at ../.git")
      ]));
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("records stale browser QA reports as limitations when they predate acceptance", async () => {
    await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
      ok: true,
      generatedAt: Date.parse("2026-05-09T21:10:00.000Z"),
      commandUploadEnabled: false
    }), "utf8");

    const manifest = await buildGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: false,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(manifest.qaReport).toMatchObject({
      status: "stale",
      path: ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md",
      commandUploadEnabled: false,
      limitations: expect.arrayContaining(["QA report predates the latest acceptance record."])
    });
    expect(manifest.workflows.find((item) => item.id === "qa")).toMatchObject({
      status: "pass-with-limitations",
      limitations: expect.arrayContaining(["local gstack browser QA report predates the latest acceptance record"])
    });
    expect(manifest.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining("gstack browser QA report predates")
    ]));
  });

  it("records health history without a parseable timestamp as stale evidence", async () => {
    await writeFile(path.join(root, ".gstack/projects/software/health-history.jsonl"), [
      JSON.stringify({
        branch: "no-git-repo",
        score: 10,
        typecheck: 10,
        lint: null,
        test: 10,
        deadcode: null,
        shell: null,
        gbrain: null,
        duration_s: 9
      }),
      ""
    ].join("\n"), "utf8");

    const manifest = await buildGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: false,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(manifest.healthHistory).toMatchObject({
      status: "stale",
      path: healthHistoryPath.split(path.sep).join("/"),
      commandUploadEnabled: false,
      limitations: expect.arrayContaining(["Latest health-history entry is missing a parseable timestamp."])
    });
    expect(manifest.workflows.find((item) => item.id === "health")).toMatchObject({
      status: "pass-with-limitations",
      limitations: expect.arrayContaining(["gstack health history freshness cannot be proven"])
    });
  });

  it("accepts health history entries that use timestamp instead of ts", async () => {
    await writeFile(path.join(root, ".gstack/projects/software/health-history.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-09T21:00:00.000Z",
        branch: "no-git-repo",
        score: 9,
        typecheck: 10,
        lint: null,
        test: 10,
        deadcode: null,
        shell: null,
        gbrain: null,
        duration_s: 11
      }),
      ""
    ].join("\n"), "utf8");

    const manifest = await buildGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: false,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(manifest.healthHistory).toMatchObject({
      status: "pass",
      latestEntry: {
        ts: "2026-05-09T21:00:00.000Z",
        score: 9,
        typecheck: 10,
        test: 10
      },
      limitations: []
    });
    expect(manifest.workflows.find((item) => item.id === "health")).toMatchObject({
      status: "pass"
    });
  });

  it("fails when the demo package is missing required perspective critiques", async () => {
    await writeFile(path.join(root, ".tmp/demo-readiness/seekr-demo-readiness-test.json"), JSON.stringify({
      perspectiveReview: [
        { id: "operator", status: "blocked-real-world" }
      ]
    }), "utf8");

    const manifest = await buildGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: false,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.workflows.find((item) => item.id === "planning")).toMatchObject({
      status: "fail",
      limitations: expect.arrayContaining([
        expect.stringContaining("demo package missing perspectives")
      ])
    });
  });

  it("fails when the latest local gstack QA report does not prove command upload stayed false", async () => {
    await writeFile(path.join(root, ".gstack/qa-reports/seekr-qa-2026-05-09T21-30-00Z.md"), [
      "# SEEKR QA Report",
      "",
      "Generated: 2026-05-09T21:30:00Z",
      "",
      "## Verdict",
      "",
      "Pass for local internal-alpha browser/API QA.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: false,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.qaReport).toMatchObject({
      status: "fail",
      commandUploadEnabled: false,
      limitations: expect.arrayContaining(["QA report does not prove commandUploadEnabled false."])
    });
    expect(manifest.workflows.find((item) => item.id === "qa")).toMatchObject({
      status: "fail",
      limitations: expect.arrayContaining(["local gstack browser QA report did not prove passing command-safe QA"])
    });
  });

  it("fails when a local gstack QA report has a failing check row", async () => {
    await writeFile(path.join(root, ".gstack/qa-reports/seekr-qa-2026-05-09T21-45-00Z.md"), [
      "# SEEKR QA Report",
      "",
      "Generated: 2026-05-09T21:45:00Z",
      "",
      "## Verdict",
      "",
      "Pass for local internal-alpha browser/API QA.",
      "",
      "`commandUploadEnabled` stayed `false`.",
      "",
      "## Checks",
      "",
      "| Check | Result | Evidence |",
      "| --- | --- | --- |",
      "| App shell loads | Pass | SEEKR GCS rendered |",
      "| Readiness API | Fail | /api/readiness returned a failure |",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: false,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.qaReport).toMatchObject({
      status: "fail",
      commandUploadEnabled: false,
      limitations: expect.arrayContaining([
        expect.stringContaining("QA report includes failing check row: Readiness API | Fail")
      ])
    });
    expect(manifest.workflows.find((item) => item.id === "qa")).toMatchObject({
      status: "fail",
      limitations: expect.arrayContaining(["local gstack browser QA report did not prove passing command-safe QA"])
    });
  });

  it("fails when a local gstack QA report references a missing screenshot artifact", async () => {
    await writeFile(path.join(root, ".gstack/qa-reports/seekr-qa-2026-05-09T21-50-00Z.md"), [
      "# SEEKR QA Report",
      "",
      "Generated: 2026-05-09T21:50:00Z",
      "",
      "## Verdict",
      "",
      "Pass for local internal-alpha browser/API QA.",
      "",
      "`commandUploadEnabled` stayed `false`.",
      "",
      "## Scope",
      "",
      "- Screenshots:",
      "  - `.gstack/qa-reports/screenshots/seekr-qa-2026-05-09T21-50-00Z-clean-home.png`",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildGstackWorkflowStatus({
      root,
      skillRoot,
      gstackCliPath: false,
      healthHistoryPath,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.qaReport).toMatchObject({
      status: "fail",
      screenshotPaths: [".gstack/qa-reports/screenshots/seekr-qa-2026-05-09T21-50-00Z-clean-home.png"],
      limitations: expect.arrayContaining([
        expect.stringContaining("missing screenshot artifact")
      ])
    });
  });
});

async function seedRoot(root: string, skillRoot: string, healthHistoryOverride?: string) {
  const seededHealthHistoryPath = healthHistoryOverride ?? path.join(root, ".gstack/projects/software/health-history.jsonl");
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, ".tmp/demo-readiness"), { recursive: true });
  await mkdir(path.join(root, ".gstack/qa-reports/screenshots"), { recursive: true });
  await mkdir(path.dirname(seededHealthHistoryPath), { recursive: true });
  for (const skill of ["gstack-health", "gstack-review", "gstack-autoplan", "gstack-qa"]) {
    await mkdir(path.join(skillRoot, skill), { recursive: true });
    await writeFile(path.join(skillRoot, skill, "SKILL.md"), `${skill}\n`, "utf8");
  }
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      typecheck: "tsc --noEmit",
      test: "vitest run",
      "test:ui": "playwright test",
      "audit:completion": "tsx scripts/completion-audit.ts",
      "audit:goal": "tsx scripts/goal-audit.ts"
    }
  }), "utf8");
  await writeFile(path.join(root, "docs/goal.md"), [
    "# Goal",
    "## GStack Workflow Status",
    "Health: gstack health workflow uses npm run typecheck and npm run test.",
    "Review: diff-based review is unavailable when Git metadata is absent.",
    "Planning: docs/goal.md and audit:goal map operator, safety, DX, replay, and demo-readiness evidence.",
    "QA: Playwright covers operator shell workflows.",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md"), [
    "# SEEKR QA Report",
    "",
    "Generated: 2026-05-09T20:55:00Z",
    "",
    "## Verdict",
    "",
    "Pass for local internal-alpha browser/API QA.",
    "",
    "`commandUploadEnabled` stayed `false`.",
    "",
    "## Scope",
    "",
    "- Screenshots:",
    `  - \`${qaHomeScreenshotPath}\``,
    `  - \`${qaMobileScreenshotPath}\``,
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, qaHomeScreenshotPath), "home screenshot", "utf8");
  await writeFile(path.join(root, qaMobileScreenshotPath), "mobile screenshot", "utf8");
  await writeFile(seededHealthHistoryPath, [
    JSON.stringify({
      ts: "2026-05-09T21:00:00.000Z",
      branch: "no-git-repo",
      score: 10,
      typecheck: 10,
      lint: null,
      test: 10,
      deadcode: null,
      shell: null,
      gbrain: null,
      duration_s: 9
    }),
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, ".tmp/demo-readiness/seekr-demo-readiness-test.json"), JSON.stringify({
    perspectiveReview: [
      { id: "operator", status: "blocked-real-world", score: 7, nextAction: "fresh operator run" },
      { id: "safety", status: "blocked-real-world", score: 8, nextAction: "HIL evidence" },
      { id: "dx", status: "ready-local-alpha", score: 8, nextAction: "git checkout review" },
      { id: "replay", status: "ready-local-alpha", score: 9, nextAction: "keep probe current" },
      { id: "demo-readiness", status: "blocked-real-world", score: 8, nextAction: "bench evidence packet" }
    ]
  }), "utf8");
}
