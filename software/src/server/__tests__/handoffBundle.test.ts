import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeHandoffBundle } from "../../../scripts/handoff-bundle";
import { writeHandoffBundleVerification } from "../../../scripts/handoff-bundle-verify";
import { REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS } from "../../../scripts/rehearsal-start-smoke";
import { REQUIRED_STRICT_AI_SMOKE_CASES } from "../ai/localAiEvidence";

describe("handoff bundle", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-handoff-bundle-test-${process.pid}-${Date.now()}`);
    await mkdir(path.join(root, ".tmp/handoff-index"), { recursive: true });
    await mkdir(path.join(root, ".tmp/api-probe"), { recursive: true });
    await mkdir(path.join(root, ".tmp/demo-readiness"), { recursive: true });
    await mkdir(path.join(root, ".tmp/bench-evidence-packet"), { recursive: true });
    await mkdir(path.join(root, ".tmp/gstack-workflow-status"), { recursive: true });
    await mkdir(path.join(root, ".tmp/todo-audit"), { recursive: true });
    await mkdir(path.join(root, ".tmp/source-control-handoff"), { recursive: true });
    await mkdir(path.join(root, ".tmp/plug-and-play-setup"), { recursive: true });
    await mkdir(path.join(root, ".tmp/plug-and-play-doctor"), { recursive: true });
    await mkdir(path.join(root, ".tmp/rehearsal-start-smoke"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await seedBundleEvidence(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("copies a verified handoff index and linked artifacts into a review bundle without hardware claims", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      status: "ready-local-alpha-review-bundle",
      commandUploadEnabled: false,
      sourceIndexPath: indexPath,
      sourceIndexComplete: false,
      gstackWorkflowStatusPath: workflowPath,
      gstackWorkflowStatus: "pass-with-limitations",
      gstackQaReportPath: qaReportPath,
      gstackQaReportStatus: "pass",
      gstackQaScreenshotPaths: [qaHomeScreenshotPath, qaMobileScreenshotPath],
      todoAuditPath: todoPath,
      todoAuditStatus: "pass-real-world-blockers-tracked",
      sourceControlHandoffPath: sourceControlPath,
      sourceControlHandoffStatus: "blocked-source-control-handoff",
      sourceControlHandoffReady: false,
      plugAndPlaySetupPath: setupPath,
      plugAndPlaySetupStatus: "ready-local-setup",
      plugAndPlayDoctorPath: doctorPath,
      plugAndPlayDoctorStatus: "ready-local-start",
      rehearsalStartSmokePath: rehearsalStartSmokePath,
      rehearsalStartSmokeStatus: "pass",
      operatorQuickstartPath,
      copiedFileCount: 22,
      safetyBoundary: {
        realAircraftCommandUpload: false,
        hardwareActuationEnabled: false,
        runtimePolicyInstalled: false
      },
      hardwareClaims: falseClaims(),
      validation: {
        ok: true,
        blockers: []
      },
      realWorldBlockers: ["No actual Jetson/Pi hardware evidence."]
    });
    expect(result.manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: indexPath }),
      expect.objectContaining({ sourcePath: indexPath.replace(/\.json$/, ".md") }),
      expect.objectContaining({ sourcePath: acceptancePath }),
      expect.objectContaining({ sourcePath: apiProbePath }),
      expect.objectContaining({ sourcePath: demoPath }),
      expect.objectContaining({ sourcePath: benchPath }),
      expect.objectContaining({ sourcePath: workflowPath }),
      expect.objectContaining({ sourcePath: workflowPath.replace(/\.json$/, ".md") }),
      expect.objectContaining({ sourcePath: qaReportPath }),
      expect.objectContaining({ sourcePath: qaHomeScreenshotPath }),
      expect.objectContaining({ sourcePath: qaMobileScreenshotPath }),
      expect.objectContaining({ sourcePath: todoPath }),
      expect.objectContaining({ sourcePath: todoPath.replace(/\.json$/, ".md") }),
      expect.objectContaining({ sourcePath: sourceControlPath }),
      expect.objectContaining({ sourcePath: sourceControlPath.replace(/\.json$/, ".md") }),
      expect.objectContaining({ sourcePath: setupPath }),
      expect.objectContaining({ sourcePath: setupPath.replace(/\.json$/, ".md") }),
      expect.objectContaining({ sourcePath: doctorPath }),
      expect.objectContaining({ sourcePath: doctorPath.replace(/\.json$/, ".md") }),
      expect.objectContaining({ sourcePath: rehearsalStartSmokePath }),
      expect.objectContaining({ sourcePath: rehearsalStartSmokePath.replace(/\.json$/, ".md") }),
      expect.objectContaining({ sourcePath: operatorQuickstartPath })
    ]));
    const copiedAcceptance = JSON.parse(await readFile(path.join(result.bundleDirectory, "artifacts", acceptancePath), "utf8"));
    expect(copiedAcceptance.commandUploadEnabled).toBe(false);
    expect(copiedAcceptance.strictLocalAi.caseNames).toEqual(REQUIRED_STRICT_AI_SMOKE_CASES);
    const copiedApiProbe = JSON.parse(await readFile(path.join(result.bundleDirectory, "artifacts", apiProbePath), "utf8"));
    expect(copiedApiProbe.sessionAcceptance.strictLocalAi.caseNames).toEqual(REQUIRED_STRICT_AI_SMOKE_CASES);
    const copiedWorkflow = JSON.parse(await readFile(path.join(result.bundleDirectory, "artifacts", workflowPath), "utf8"));
    expect(copiedWorkflow.commandUploadEnabled).toBe(false);
    const copiedTodoAudit = JSON.parse(await readFile(path.join(result.bundleDirectory, "artifacts", todoPath), "utf8"));
    expect(copiedTodoAudit.commandUploadEnabled).toBe(false);
    const copiedSourceControl = JSON.parse(await readFile(path.join(result.bundleDirectory, "artifacts", sourceControlPath), "utf8"));
    expect(copiedSourceControl.commandUploadEnabled).toBe(false);
    expect(copiedSourceControl.repositoryUrl).toBe("https://github.com/Ayush1298567/SEEKR");
    const copiedSetup = JSON.parse(await readFile(path.join(result.bundleDirectory, "artifacts", setupPath), "utf8"));
    expect(copiedSetup.commandUploadEnabled).toBe(false);
    const copiedDoctor = JSON.parse(await readFile(path.join(result.bundleDirectory, "artifacts", doctorPath), "utf8"));
    expect(copiedDoctor.commandUploadEnabled).toBe(false);
    const copiedRehearsalStartSmoke = JSON.parse(await readFile(path.join(result.bundleDirectory, "artifacts", rehearsalStartSmokePath), "utf8"));
    expect(copiedRehearsalStartSmoke.commandUploadEnabled).toBe(false);
    const copiedQuickstart = await readFile(path.join(result.bundleDirectory, "artifacts", operatorQuickstartPath), "utf8");
    expect(copiedQuickstart).toContain("npm run rehearsal:start");
    expect(copiedQuickstart).toContain("command upload");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("GStack workflow status");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("TODO audit");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Source-control handoff");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Plug-and-play setup");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Plug-and-play doctor");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Rehearsal-start smoke");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Operator quickstart");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("does not validate Jetson/Pi hardware");

    const verification = await writeHandoffBundleVerification({
      root,
      generatedAt: "2026-05-09T21:05:00.000Z"
    });
    expect(verification.manifest).toMatchObject({
      status: "pass",
      commandUploadEnabled: false,
      sourceBundlePath: path.relative(root, result.jsonPath).split(path.sep).join("/"),
      sourceIndexPath: indexPath,
      gstackWorkflowStatusPath: workflowPath,
      gstackQaReportPath: qaReportPath,
      gstackQaScreenshotPaths: [qaHomeScreenshotPath, qaMobileScreenshotPath],
      todoAuditPath: todoPath,
      sourceControlHandoffPath: sourceControlPath,
      plugAndPlaySetupPath: setupPath,
      plugAndPlayDoctorPath: doctorPath,
      rehearsalStartSmokePath,
      operatorQuickstartPath,
      checkedFileCount: 22,
      validation: {
        ok: true,
        blockers: []
      }
    });
    expect(verification.manifest.files.every((file) => file.status === "pass")).toBe(true);
    await expect(readFile(verification.markdownPath, "utf8")).resolves.toContain("does not validate Jetson/Pi hardware");
  });

  it("blocks bundling when a linked artifact no longer matches the handoff digest table", async () => {
    await writeFile(path.join(root, demoPath), JSON.stringify({ changed: true }), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("File bytes or SHA-256 no longer match the handoff index")
    ]));
  });

  it("blocks bundling when gstack workflow status has not been generated", async () => {
    await rm(path.join(root, ".tmp/gstack-workflow-status"), { recursive: true, force: true });

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("run npm run audit:gstack")
    ]));
  });

  it("blocks bundling when gstack workflow status omits health history metadata", async () => {
    await writeFile(path.join(root, workflowPath), JSON.stringify({
      status: "pass-with-limitations",
      commandUploadEnabled: false,
      gstackAvailable: true,
      gstackCliAvailable: false,
      workflows: [
        { id: "health", status: "pass" },
        { id: "review", status: "blocked-by-workspace" },
        { id: "planning", status: "pass" },
        { id: "qa", status: "pass" }
      ],
      perspectives: [
        { id: "operator", status: "blocked-real-world" },
        { id: "safety", status: "blocked-real-world" },
        { id: "dx", status: "ready-local-alpha" },
        { id: "replay", status: "ready-local-alpha" },
        { id: "demo-readiness", status: "blocked-real-world" }
      ],
      qaReport: {
        status: "pass",
        path: qaReportPath,
        generatedAt: "2026-05-09T20:55:00Z",
        commandUploadEnabled: false
      }
    }), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("GStack workflow status artifact must pass")
    ]));
  });

  it("blocks bundling when gstack workflow status claims passing health history without a path", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    delete workflow.healthHistory.path;
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("GStack workflow status artifact must pass")
    ]));
  });

  it("blocks bundling when gstack workflow status omits QA report metadata", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    delete workflow.qaReport;
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("GStack workflow status artifact must pass")
    ]));
  });

  it("blocks bundling when gstack workflow status drops QA screenshot paths referenced by the report", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    workflow.qaReport.screenshotPaths = [];
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("GStack workflow status artifact must pass")
    ]));
  });

  it("blocks bundling when gstack workflow status claims passing QA without a report path", async () => {
    await writeFile(path.join(root, workflowPath), JSON.stringify({
      status: "pass-with-limitations",
      commandUploadEnabled: false,
      gstackAvailable: true,
      gstackCliAvailable: false,
      workflows: [
        { id: "health", status: "pass" },
        { id: "review", status: "blocked-by-workspace" },
        { id: "planning", status: "pass" },
        { id: "qa", status: "pass" }
      ],
      perspectives: [
        { id: "operator", status: "blocked-real-world" },
        { id: "safety", status: "blocked-real-world" },
        { id: "dx", status: "ready-local-alpha" },
        { id: "replay", status: "ready-local-alpha" },
        { id: "demo-readiness", status: "blocked-real-world" }
      ],
      healthHistory: {
        status: "pass",
        path: "~/.gstack/projects/software/health-history.jsonl",
        commandUploadEnabled: false
      },
      qaReport: {
        status: "pass",
        generatedAt: "2026-05-09T20:55:00Z",
        commandUploadEnabled: false
      }
    }), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("GStack workflow status artifact must pass")
    ]));
  });

  it("blocks bundling when gstack workflow status does not preserve installed skill availability", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    workflow.gstackAvailable = false;
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("record gstack availability")
    ]));
  });

  it("blocks bundling when a required gstack workflow omits installed skill availability", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    workflow.workflows.find((item: { id: string }) => item.id === "qa").skillAvailable = false;
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("GStack workflow status artifact must pass")
    ]));
  });

  it("blocks bundling when gstack workflow rows are reordered", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    [workflow.workflows[0], workflow.workflows[1]] = [workflow.workflows[1], workflow.workflows[0]];
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("GStack workflow status artifact must pass")
    ]));
  });

  it("blocks bundling when gstack perspective rows are reordered", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    [workflow.perspectives[0], workflow.perspectives[1]] = [workflow.perspectives[1], workflow.perspectives[0]];
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("GStack workflow status artifact must pass")
    ]));
  });

  it("blocks bundling when the no-git review workflow is overclaimed as pass", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    const review = workflow.workflows.find((item: { id: string }) => item.id === "review");
    review.status = "pass";
    review.details = "Review workflow completed.";
    review.limitations = [];
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("no-Git workspace limitations")
    ]));
  });

  it("blocks bundling when the top-level workflow status hides limitation-only evidence", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    workflow.status = "pass";
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("pass-with-limitations for limitation-only evidence")
    ]));
  });

  it("blocks bundling when gstack workflow status drops manifest-level limitation details", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    workflow.limitations = [];
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("manifest-level limitation details")
    ]));
  });

  it("blocks bundling when unavailable gstack CLI is not documented in manifest-level limitations", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    workflow.limitations = ["No .git metadata is present in this workspace."];
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("manifest-level limitation details")
    ]));
  });

  it("blocks bundling when gstack workflow perspectives drop review details", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    delete workflow.perspectives[0].score;
    workflow.perspectives[1].nextAction = "";
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("perspective status/score/nextAction")
    ]));
  });

  it("blocks bundling when stale gstack QA evidence drops limitation details", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    workflow.qaReport.status = "stale";
    workflow.qaReport.limitations = [];
    const qaWorkflow = workflow.workflows.find((item: { id: string }) => item.id === "qa")!;
    qaWorkflow.status = "pass-with-limitations";
    qaWorkflow.limitations = [];
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("preserve limitation details")
    ]));
  });

  it("allows stale gstack QA reports when the report path is preserved for review", async () => {
    const workflow = JSON.parse(await readFile(path.join(root, workflowPath), "utf8"));
    workflow.qaReport.status = "stale";
    workflow.qaReport.limitations = ["QA report predates the latest acceptance record."];
    workflow.limitations.push("The latest local gstack browser QA report predates the latest acceptance record.");
    await writeFile(path.join(root, workflowPath), JSON.stringify(workflow), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("ready-local-alpha-review-bundle");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.gstackQaReportStatus).toBe("stale");
    expect(result.manifest.gstackQaReportPath).toBe(qaReportPath);

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("pass");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.gstackQaReportPath).toBe(qaReportPath);
  });

  it("blocks bundling when todo audit has not been generated", async () => {
    await rm(path.join(root, ".tmp/todo-audit"), { recursive: true, force: true });

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("run npm run audit:todo")
    ]));
  });

  it("blocks bundling when source-control handoff has not been generated", async () => {
    await rm(path.join(root, ".tmp/source-control-handoff"), { recursive: true, force: true });

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("run npm run audit:source-control")
    ]));
  });

  it("blocks bundling when source-control handoff enables command upload", async () => {
    const sourceControl = JSON.parse(await readFile(path.join(root, sourceControlPath), "utf8"));
    sourceControl.commandUploadEnabled = true;
    await writeFile(path.join(root, sourceControlPath), JSON.stringify(sourceControl), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Source-control handoff artifact must be read-only")
    ]));
  });

  it("blocks bundling when ready source-control handoff predates acceptance", async () => {
    const staleSourceControlPath = ".tmp/source-control-handoff/seekr-source-control-handoff-zz-stale.json";
    const sourceControl = JSON.parse(await readFile(path.join(root, sourceControlPath), "utf8"));
    markSourceControlReady(sourceControl);
    sourceControl.generatedAt = "2026-05-09T20:56:00.000Z";
    await writeFile(path.join(root, staleSourceControlPath), JSON.stringify(sourceControl), "utf8");
    await writeFile(path.join(root, staleSourceControlPath.replace(/\.json$/, ".md")), "# Source Control Handoff\n", "utf8");
    const doctor = JSON.parse(await readFile(path.join(root, doctorPath), "utf8"));
    const sourceControlCheck = doctor.checks.find((check: { id: string }) => check.id === "source-control-handoff");
    sourceControlCheck.evidence = [staleSourceControlPath];
    sourceControlCheck.details = `Source-control handoff artifact ${staleSourceControlPath} is ready.`;
    await writeFile(path.join(root, doctorPath), JSON.stringify(doctor), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("newer than or equal to the latest acceptance record")
    ]));
  });

  it("blocks bundling when plug-and-play doctor has not been generated", async () => {
    await rm(path.join(root, ".tmp/plug-and-play-doctor"), { recursive: true, force: true });

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("run npm run doctor")
    ]));
  });

  it("does not package rehearsal-start smoke doctor artifacts as the operator doctor", async () => {
    const smokeDoctor = JSON.parse(await readFile(path.join(root, doctorPath), "utf8"));
    smokeDoctor.profile = "rehearsal-start-smoke";
    smokeDoctor.generatedAt = "2026-05-09T21:02:00.000Z";
    smokeDoctor.ports = {
      api: 49111,
      client: 49112
    };
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-zz-smoke.json"), JSON.stringify(smokeDoctor), "utf8");
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-zz-smoke.md"), "# Smoke Doctor\n", "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:03:00.000Z"
    });

    expect(result.manifest.status).toBe("ready-local-alpha-review-bundle");
    expect(result.manifest.plugAndPlayDoctorPath).toBe(doctorPath);
    expect(result.manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: doctorPath })
    ]));
    expect(result.manifest.files).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-zz-smoke.json" })
    ]));
  });

  it("blocks bundling when the operator doctor references an older source-control handoff", async () => {
    const newerSourceControlPath = ".tmp/source-control-handoff/seekr-source-control-handoff-zz-newer.json";
    const sourceControl = JSON.parse(await readFile(path.join(root, sourceControlPath), "utf8"));
    sourceControl.generatedAt = "2026-05-09T21:02:00.000Z";
    await writeFile(path.join(root, newerSourceControlPath), JSON.stringify(sourceControl), "utf8");
    await writeFile(path.join(root, newerSourceControlPath.replace(/\.json$/, ".md")), "# Source Control Handoff\n", "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:03:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("matching source-control handoff")
    ]));
  });

  it("blocks bundling when plug-and-play setup has not been generated", async () => {
    await rm(path.join(root, ".tmp/plug-and-play-setup"), { recursive: true, force: true });

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("run npm run setup:local")
    ]));
  });

  it("blocks bundling when rehearsal-start smoke has not been generated", async () => {
    await rm(path.join(root, ".tmp/rehearsal-start-smoke"), { recursive: true, force: true });

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("run npm run smoke:rehearsal:start")
    ]));
  });

  it("blocks bundling when rehearsal-start smoke failed", async () => {
    const smoke = JSON.parse(await readFile(path.join(root, rehearsalStartSmokePath), "utf8"));
    smoke.ok = false;
    smoke.status = "fail";
    smoke.checks.find((check: { id: string }) => check.id === "runtime-config").status = "fail";
    await writeFile(path.join(root, rehearsalStartSmokePath), JSON.stringify(smoke), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Rehearsal-start smoke artifact must pass")
    ]));
  });

  it("blocks bundling when rehearsal-start smoke check rows are not exact", async () => {
    const smoke = JSON.parse(await readFile(path.join(root, rehearsalStartSmokePath), "utf8"));
    smoke.checked = [...REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS, "unreviewed-extra-smoke-check"];
    smoke.checks = [
      ...smoke.checks,
      {
        id: "unreviewed-extra-smoke-check",
        status: "pass",
        details: "Unreviewed extra smoke check passed.",
        evidence: ["unreviewed-extra-smoke-check"]
      }
    ];
    await writeFile(path.join(root, rehearsalStartSmokePath), JSON.stringify(smoke), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Rehearsal-start smoke artifact must pass")
    ]));
  });

  it("blocks bundling when the operator quickstart omits plug-and-play setup or safety guidance", async () => {
    await writeFile(path.join(root, operatorQuickstartPath), "# SEEKR Operator Quickstart\n\nOpen the app.\n", "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Operator quickstart")
    ]));
  });

  it("blocks bundling when the operator quickstart omits the source-control audit step", async () => {
    await writeFile(path.join(root, operatorQuickstartPath), [
      "# SEEKR Operator Quickstart",
      "",
      "## Setup",
      "",
      "```bash",
      "npm ci",
      "npm run setup:local",
      "npm run doctor",
      "npm run rehearsal:start",
      "```",
      "",
      "Local AI uses Ollama with llama3.2:latest.",
      "AI output is advisory. It can help select from validated candidate plans, but it cannot create command payloads or bypass operator validation.",
      "Check /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays before handoff.",
      "real-world blockers remain until physical evidence exists.",
      "No command upload or hardware actuation is allowed.",
      "No AI-created command payloads.",
      "No operator answer bypassing validation.",
      ""
    ].join("\n"), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("source-control audit")
    ]));
  });

  it("blocks bundling when the operator quickstart omits advisory AI command-safety guidance", async () => {
    await writeFile(path.join(root, operatorQuickstartPath), [
      "# SEEKR Operator Quickstart",
      "",
      "## Setup",
      "",
      "```bash",
      "npm ci",
      "npm run setup:local",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run rehearsal:start",
      "```",
      "",
      "Local AI uses Ollama with llama3.2:latest.",
      "Check /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays before handoff.",
      "real-world blockers remain until physical evidence exists.",
      "No command upload or hardware actuation is allowed.",
      ""
    ].join("\n"), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("advisory-only Ollama AI")
    ]));
  });

  it("blocks bundling when plug-and-play setup has a failing safety check", async () => {
    const setup = JSON.parse(await readFile(path.join(root, setupPath), "utf8"));
    setup.ok = false;
    setup.status = "blocked-local-setup";
    setup.checks.find((check: { id: string }) => check.id === "safety-boundary").status = "fail";
    await writeFile(path.join(root, setupPath), JSON.stringify(setup), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Plug-and-play setup artifact must pass")
    ]));
  });

  it("blocks bundling when plug-and-play doctor has a failing local AI check", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, doctorPath), "utf8"));
    doctor.ok = false;
    doctor.ai.status = "fail";
    doctor.summary.fail = 1;
    doctor.checks.find((check: { id: string }) => check.id === "local-ai").status = "fail";
    await writeFile(path.join(root, doctorPath), JSON.stringify(doctor), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Plug-and-play doctor artifact must pass")
    ]));
  });

  it("blocks bundling when plug-and-play doctor omits the start-wrapper check", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, doctorPath), "utf8"));
    doctor.checks = doctor.checks.filter((check: { id: string }) => check.id !== "operator-start");
    await writeFile(path.join(root, doctorPath), JSON.stringify(doctor), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("start-wrapper validation")
    ]));
  });

  it("blocks bundling when a critical plug-and-play doctor check is only warning", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, doctorPath), "utf8"));
    doctor.checks.find((check: { id: string }) => check.id === "operator-start").status = "warn";
    await writeFile(path.join(root, doctorPath), JSON.stringify(doctor), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("start-wrapper validation")
    ]));
  });

  it("allows bundling when only soft plug-and-play doctor checks are warnings", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, doctorPath), "utf8"));
    doctor.summary.pass = 7;
    doctor.summary.warn = 3;
    doctor.checks.find((check: { id: string }) => check.id === "source-control-handoff").status = "warn";
    doctor.checks.find((check: { id: string }) => check.id === "local-ports").status = "warn";
    doctor.checks.find((check: { id: string }) => check.id === "data-dir").status = "warn";
    await writeFile(path.join(root, doctorPath), JSON.stringify(doctor), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("ready-local-alpha-review-bundle");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBeGreaterThan(0);
  });

  it("blocks bundling when plug-and-play doctor predates acceptance", async () => {
    const acceptance = JSON.parse(await readFile(path.join(root, acceptancePath), "utf8"));
    acceptance.generatedAt = Date.parse("2026-05-09T21:01:00.000Z");
    await writeFile(path.join(root, acceptancePath), JSON.stringify(acceptance), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:02:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("freshness against acceptance")
    ]));
  });

  it("blocks bundling when gstack workflow status has a failing workflow", async () => {
    await writeFile(path.join(root, workflowPath), JSON.stringify({
      status: "fail",
      commandUploadEnabled: false,
      gstackCliAvailable: false,
      workflows: [
        { id: "health", status: "fail" },
        { id: "review", status: "blocked-by-workspace" },
        { id: "planning", status: "pass" },
        { id: "qa", status: "pass" }
      ],
      perspectives: [
        { id: "operator", status: "blocked-real-world" },
        { id: "safety", status: "blocked-real-world" },
        { id: "dx", status: "ready-local-alpha" },
        { id: "replay", status: "ready-local-alpha" },
        { id: "demo-readiness", status: "blocked-real-world" }
      ]
    }), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("GStack workflow status artifact must pass")
    ]));
  });

  it("blocks bundling when todo audit has a failing category", async () => {
    await writeFile(path.join(root, todoPath), JSON.stringify({
      status: "fail",
      commandUploadEnabled: false,
      uncheckedTodoCount: 8,
      completionAudit: { commandUploadEnabled: false },
      validation: { ok: false, blockers: ["MAVLink TODO missing"], warnings: [] },
      categories: [
        { id: "real-mavlink-telemetry", status: "fail" }
      ]
    }), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("TODO audit artifact must pass")
    ]));
  });

  it("blocks bundling when todo audit omits a required blocker category", async () => {
    const todoAudit = JSON.parse(await readFile(path.join(root, todoPath), "utf8"));
    todoAudit.categories = todoAudit.categories.filter((category: { id: string }) => category.id !== "real-ros2-topics");
    await writeFile(path.join(root, todoPath), JSON.stringify(todoAudit), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("TODO audit artifact must pass")
    ]));
  });

  it("blocks bundling when todo audit blocker categories are reordered", async () => {
    const todoAudit = JSON.parse(await readFile(path.join(root, todoPath), "utf8"));
    [todoAudit.categories[0], todoAudit.categories[1]] = [todoAudit.categories[1], todoAudit.categories[0]];
    await writeFile(path.join(root, todoPath), JSON.stringify(todoAudit), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("TODO audit artifact must pass")
    ]));
  });

  it("blocks bundling when todo audit blocker count does not match blocked categories", async () => {
    const todoAudit = JSON.parse(await readFile(path.join(root, todoPath), "utf8"));
    todoAudit.completionAudit.realWorldBlockerCount = 7;
    await writeFile(path.join(root, todoPath), JSON.stringify(todoAudit), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("TODO audit artifact must pass")
    ]));
  });

  it("blocks bundling when todo audit top-level summary counts are stale", async () => {
    const todoAudit = JSON.parse(await readFile(path.join(root, todoPath), "utf8"));
    todoAudit.blockedCategoryCount = 7;
    await writeFile(path.join(root, todoPath), JSON.stringify(todoAudit), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("TODO audit artifact must pass")
    ]));
  });

  it("blocks bundling when todo audit category status lacks supporting evidence", async () => {
    const todoAudit = JSON.parse(await readFile(path.join(root, todoPath), "utf8"));
    todoAudit.categories[0].todoMatches = [];
    await writeFile(path.join(root, todoPath), JSON.stringify(todoAudit), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("TODO audit artifact must pass")
    ]));
  });

  it("blocks bundling when todo audit category support evidence is malformed", async () => {
    const todoAudit = JSON.parse(await readFile(path.join(root, todoPath), "utf8"));
    todoAudit.categories[0].todoMatches = [{ sourcePath: "", line: 0, text: "" }];
    await writeFile(path.join(root, todoPath), JSON.stringify(todoAudit), "utf8");

    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.manifest.status).toBe("blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.copiedFileCount).toBe(0);
    expect(result.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("TODO audit artifact must pass")
    ]));
  });

  it("fails bundle verification when a copied review artifact is tampered", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    await writeFile(path.join(result.bundleDirectory, "artifacts", demoPath), JSON.stringify({ changed: true }), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied file bytes or SHA-256 no longer match the bundle manifest")
    ]));
    expect(verification.manifest.files.find((file) => file.sourcePath === demoPath)).toMatchObject({
      status: "fail"
    });
    expect(verification.manifest.secretScan).toMatchObject({
      status: "pass",
      expectedFileCount: 22,
      scannedFileCount: 22,
      findingCount: 0
    });
  });

  it("fails bundle verification when copied API probe strict AI scenarios drift from copied acceptance", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedApiProbePath = path.join(result.bundleDirectory, "artifacts", apiProbePath);
    const copiedApiProbe = JSON.parse(await readFile(copiedApiProbePath, "utf8"));
    copiedApiProbe.sessionAcceptance.strictLocalAi.caseNames = REQUIRED_STRICT_AI_SMOKE_CASES.filter((name) => name !== "prompt-injection-spatial-metadata");
    const content = JSON.stringify(copiedApiProbe);
    await writeFile(copiedApiProbePath, content, "utf8");
    await updateBundleManifestDigest(result.jsonPath, apiProbePath, content);

    const verification = await writeHandoffBundleVerification({
      root,
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied API probe must read back the copied acceptance")
    ]));
  });

  it("fails bundle verification when copied acceptance has extra strict AI scenarios", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedAcceptancePath = path.join(result.bundleDirectory, "artifacts", acceptancePath);
    const copiedApiProbePath = path.join(result.bundleDirectory, "artifacts", apiProbePath);
    const copiedAcceptance = JSON.parse(await readFile(copiedAcceptancePath, "utf8"));
    const copiedApiProbe = JSON.parse(await readFile(copiedApiProbePath, "utf8"));
    copiedAcceptance.strictLocalAi.caseNames = [...REQUIRED_STRICT_AI_SMOKE_CASES, "untracked-extra-ai-scenario"];
    copiedAcceptance.strictLocalAi.caseCount = copiedAcceptance.strictLocalAi.caseNames.length;
    copiedApiProbe.sessionAcceptance.strictLocalAi.caseNames = copiedAcceptance.strictLocalAi.caseNames;
    copiedApiProbe.sessionAcceptance.strictLocalAi.caseCount = copiedAcceptance.strictLocalAi.caseCount;
    const acceptanceContent = JSON.stringify(copiedAcceptance);
    const apiProbeContent = JSON.stringify(copiedApiProbe);
    await writeFile(copiedAcceptancePath, acceptanceContent, "utf8");
    await writeFile(copiedApiProbePath, apiProbeContent, "utf8");
    await updateBundleManifestDigest(result.jsonPath, acceptancePath, acceptanceContent);
    await updateBundleManifestDigest(result.jsonPath, apiProbePath, apiProbeContent);

    const verification = await writeHandoffBundleVerification({
      root,
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied acceptance status must pass")
    ]));
  });

  it("fails bundle verification when copied plug-and-play setup is no longer valid", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedSetupPath = path.join(result.bundleDirectory, "artifacts", setupPath);
    const copiedSetup = JSON.parse(await readFile(copiedSetupPath, "utf8"));
    copiedSetup.ok = false;
    copiedSetup.checks.find((check: { id: string }) => check.id === "env-file").status = "fail";
    await writeFile(copiedSetupPath, JSON.stringify(copiedSetup), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied plug-and-play setup must pass")
    ]));
  });

  it("fails bundle verification when copied source-control handoff is no longer safe", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedSourceControlPath = path.join(result.bundleDirectory, "artifacts", sourceControlPath);
    const copiedSourceControl = JSON.parse(await readFile(copiedSourceControlPath, "utf8"));
    copiedSourceControl.commandUploadEnabled = true;
    await writeFile(copiedSourceControlPath, JSON.stringify(copiedSourceControl), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied source-control handoff must be read-only")
    ]));
  });

  it("fails bundle verification when copied ready source-control handoff predates copied acceptance", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedSourceControlPath = path.join(result.bundleDirectory, "artifacts", sourceControlPath);
    const copiedSourceControl = JSON.parse(await readFile(copiedSourceControlPath, "utf8"));
    markSourceControlReady(copiedSourceControl);
    copiedSourceControl.generatedAt = "2026-05-09T20:56:00.000Z";
    const copiedSourceControlText = JSON.stringify(copiedSourceControl);
    await writeFile(copiedSourceControlPath, copiedSourceControlText, "utf8");
    await updateBundleManifestDigest(result.jsonPath, sourceControlPath, copiedSourceControlText);

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("newer than or equal to the copied acceptance record")
    ]));
  });

  it("fails bundle verification when copied rehearsal-start smoke is no longer valid", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedSmokePath = path.join(result.bundleDirectory, "artifacts", rehearsalStartSmokePath);
    const copiedSmoke = JSON.parse(await readFile(copiedSmokePath, "utf8"));
    copiedSmoke.commandUploadEnabled = true;
    await writeFile(copiedSmokePath, JSON.stringify(copiedSmoke), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied rehearsal-start smoke must pass")
    ]));
  });

  it("fails bundle verification when the copied operator quickstart is no longer valid", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    await writeFile(
      path.join(result.bundleDirectory, "artifacts", operatorQuickstartPath),
      "# SEEKR Operator Quickstart\n\nOpen the app.\n",
      "utf8"
    );

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied operator quickstart")
    ]));
  });

  it("fails bundle verification when the copied operator quickstart omits the source-control audit step", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    await writeFile(
      path.join(result.bundleDirectory, "artifacts", operatorQuickstartPath),
      [
        "# SEEKR Operator Quickstart",
        "",
        "## Setup",
        "",
        "```bash",
        "npm ci",
        "npm run setup:local",
        "npm run doctor",
        "npm run rehearsal:start",
        "```",
        "",
        "Local AI uses Ollama with llama3.2:latest.",
        "AI output is advisory. It can help select from validated candidate plans, but it cannot create command payloads or bypass operator validation.",
        "Check /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays before handoff.",
        "real-world blockers remain until physical evidence exists.",
        "No command upload or hardware actuation is allowed.",
        "No AI-created command payloads.",
        "No operator answer bypassing validation.",
        ""
      ].join("\n"),
      "utf8"
    );

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("source-control audit")
    ]));
  });

  it("fails bundle verification when the copied operator quickstart omits advisory AI command-safety guidance", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    await writeFile(
      path.join(result.bundleDirectory, "artifacts", operatorQuickstartPath),
      [
        "# SEEKR Operator Quickstart",
        "",
        "## Setup",
        "",
        "```bash",
        "npm ci",
        "npm run setup:local",
        "npm run audit:source-control",
        "npm run doctor",
        "npm run rehearsal:start",
        "```",
        "",
        "Local AI uses Ollama with llama3.2:latest.",
        "Check /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays before handoff.",
        "real-world blockers remain until physical evidence exists.",
        "No command upload or hardware actuation is allowed.",
        ""
      ].join("\n"),
      "utf8"
    );

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("advisory-only Ollama AI")
    ]));
  });

  it("fails bundle verification when copied workflow claims passing health history without a path", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    delete copiedWorkflow.healthHistory.path;
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied gstack workflow status must pass")
    ]));
  });

  it("fails bundle verification when copied workflow omits QA report metadata", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    delete copiedWorkflow.qaReport;
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied gstack workflow status must pass")
    ]));
  });

  it("fails bundle verification when copied gstack QA report contains a failing check row", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedQaPath = path.join(result.bundleDirectory, "artifacts", qaReportPath);
    await writeFile(copiedQaPath, [
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
      "## Checks",
      "",
      "| Check | Result | Evidence |",
      "| --- | --- | --- |",
      "| App shell loads | Pass | SEEKR GCS rendered |",
      "| Readiness API | Fail | /api/readiness returned a failure |",
      ""
    ].join("\n"), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied gstack browser QA report must contain a passing verdict")
    ]));
  });

  it("fails bundle verification when bundle manifest drops copied QA screenshot paths", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const bundleManifest = JSON.parse(await readFile(result.jsonPath, "utf8"));
    bundleManifest.gstackQaScreenshotPaths = [];
    await writeFile(result.jsonPath, JSON.stringify(bundleManifest), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("gstack QA screenshot paths")
    ]));
  });

  it("fails bundle verification when copied workflow does not preserve installed skill availability", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    copiedWorkflow.gstackAvailable = false;
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("record gstack availability")
    ]));
  });

  it("fails bundle verification when a copied required workflow omits installed skill availability", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    copiedWorkflow.workflows.find((item: { id: string }) => item.id === "planning").skillAvailable = false;
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied gstack workflow status must pass")
    ]));
  });

  it("fails bundle verification when copied gstack workflow rows are reordered", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    [copiedWorkflow.workflows[0], copiedWorkflow.workflows[1]] = [copiedWorkflow.workflows[1], copiedWorkflow.workflows[0]];
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied gstack workflow status must pass")
    ]));
  });

  it("fails bundle verification when copied gstack perspective rows are reordered", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    [copiedWorkflow.perspectives[0], copiedWorkflow.perspectives[1]] = [copiedWorkflow.perspectives[1], copiedWorkflow.perspectives[0]];
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied gstack workflow status must pass")
    ]));
  });

  it("fails bundle verification when a copied no-git review workflow is overclaimed as pass", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    const review = copiedWorkflow.workflows.find((item: { id: string }) => item.id === "review");
    review.status = "pass";
    review.details = "Review workflow completed.";
    review.limitations = [];
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("no-Git workspace limitations")
    ]));
  });

  it("fails bundle verification when copied top-level workflow status hides limitation-only evidence", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    copiedWorkflow.status = "pass";
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("pass-with-limitations for limitation-only evidence")
    ]));
  });

  it("fails bundle verification when copied workflow drops manifest-level limitation details", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    copiedWorkflow.limitations = [];
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("manifest-level limitation details")
    ]));
  });

  it("fails bundle verification when copied workflow hides unavailable gstack CLI limitation details", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    copiedWorkflow.limitations = ["No .git metadata is present in this workspace."];
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("manifest-level limitation details")
    ]));
  });

  it("fails bundle verification when copied workflow perspectives drop review details", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    copiedWorkflow.perspectives[0].status = "missing";
    delete copiedWorkflow.perspectives[1].nextAction;
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("perspective status/score/nextAction")
    ]));
  });

  it("fails bundle verification when copied stale gstack QA evidence drops limitation details", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedWorkflowPath = path.join(result.bundleDirectory, "artifacts", workflowPath);
    const copiedWorkflow = JSON.parse(await readFile(copiedWorkflowPath, "utf8"));
    copiedWorkflow.qaReport.status = "stale";
    copiedWorkflow.qaReport.limitations = [];
    const qaWorkflow = copiedWorkflow.workflows.find((item: { id: string }) => item.id === "qa")!;
    qaWorkflow.status = "pass-with-limitations";
    qaWorkflow.limitations = [];
    await writeFile(copiedWorkflowPath, JSON.stringify(copiedWorkflow), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("preserve limitation details")
    ]));
  });

  it("fails bundle verification when the copied todo audit no longer passes semantic checks", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    await writeFile(path.join(result.bundleDirectory, "artifacts", todoPath), JSON.stringify({
      status: "fail",
      commandUploadEnabled: false,
      uncheckedTodoCount: 8,
      completionAudit: { commandUploadEnabled: false },
      validation: { ok: false, blockers: ["stale"], warnings: [] },
      categories: []
    }), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied TODO audit must pass")
    ]));
  });

  it("fails bundle verification when the copied todo audit omits a required blocker category", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedTodoPath = path.join(result.bundleDirectory, "artifacts", todoPath);
    const copiedTodo = JSON.parse(await readFile(copiedTodoPath, "utf8"));
    copiedTodo.categories = copiedTodo.categories.filter((category: { id: string }) => category.id !== "real-ros2-topics");
    await writeFile(copiedTodoPath, JSON.stringify(copiedTodo), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied TODO audit must pass")
    ]));
  });

  it("fails bundle verification when copied todo audit blocker count is stale", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedTodoPath = path.join(result.bundleDirectory, "artifacts", todoPath);
    const copiedTodo = JSON.parse(await readFile(copiedTodoPath, "utf8"));
    copiedTodo.completionAudit.realWorldBlockerCount = 7;
    await writeFile(copiedTodoPath, JSON.stringify(copiedTodo), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied TODO audit must pass")
    ]));
  });

  it("fails bundle verification when copied todo audit top-level summary counts are stale", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedTodoPath = path.join(result.bundleDirectory, "artifacts", todoPath);
    const copiedTodo = JSON.parse(await readFile(copiedTodoPath, "utf8"));
    copiedTodo.realWorldBlockerCount = 7;
    await writeFile(copiedTodoPath, JSON.stringify(copiedTodo), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied TODO audit must pass")
    ]));
  });

  it("fails bundle verification when copied todo audit blocker categories are reordered", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedTodoPath = path.join(result.bundleDirectory, "artifacts", todoPath);
    const copiedTodo = JSON.parse(await readFile(copiedTodoPath, "utf8"));
    [copiedTodo.categories[0], copiedTodo.categories[1]] = [copiedTodo.categories[1], copiedTodo.categories[0]];
    await writeFile(copiedTodoPath, JSON.stringify(copiedTodo), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied TODO audit must pass")
    ]));
  });

  it("fails bundle verification when copied todo audit category status lacks supporting evidence", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedTodoPath = path.join(result.bundleDirectory, "artifacts", todoPath);
    const copiedTodo = JSON.parse(await readFile(copiedTodoPath, "utf8"));
    copiedTodo.categories[0].completionBlockerMatches = [];
    await writeFile(copiedTodoPath, JSON.stringify(copiedTodo), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied TODO audit must pass")
    ]));
  });

  it("fails bundle verification when copied todo audit category support evidence is malformed", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedTodoPath = path.join(result.bundleDirectory, "artifacts", todoPath);
    const copiedTodo = JSON.parse(await readFile(copiedTodoPath, "utf8"));
    copiedTodo.categories[0].completionBlockerMatches = [""];
    await writeFile(copiedTodoPath, JSON.stringify(copiedTodo), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied TODO audit must pass")
    ]));
  });

  it("fails bundle verification when the copied plug-and-play doctor no longer passes semantic checks", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedDoctorPath = path.join(result.bundleDirectory, "artifacts", doctorPath);
    const copiedDoctor = JSON.parse(await readFile(copiedDoctorPath, "utf8"));
    copiedDoctor.ok = false;
    copiedDoctor.summary.fail = 1;
    copiedDoctor.checks.find((check: { id: string }) => check.id === "safety-boundary").status = "fail";
    await writeFile(copiedDoctorPath, JSON.stringify(copiedDoctor), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied plug-and-play doctor must pass")
    ]));
  });

  it("fails bundle verification when copied doctor source-control evidence does not match the copied source-control handoff", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedDoctorPath = path.join(result.bundleDirectory, "artifacts", doctorPath);
    const copiedDoctor = JSON.parse(await readFile(copiedDoctorPath, "utf8"));
    const sourceControlCheck = copiedDoctor.checks.find((check: { id: string }) => check.id === "source-control-handoff");
    sourceControlCheck.evidence = [".tmp/source-control-handoff/seekr-source-control-handoff-stale.json"];
    sourceControlCheck.details = "Source-control handoff artifact .tmp/source-control-handoff/seekr-source-control-handoff-stale.json is ready.";
    await writeFile(copiedDoctorPath, JSON.stringify(copiedDoctor), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("matching source-control handoff")
    ]));
  });

  it("fails bundle verification when the copied plug-and-play doctor omits the start-wrapper check", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedDoctorPath = path.join(result.bundleDirectory, "artifacts", doctorPath);
    const copiedDoctor = JSON.parse(await readFile(copiedDoctorPath, "utf8"));
    copiedDoctor.checks = copiedDoctor.checks.filter((check: { id: string }) => check.id !== "operator-start");
    await writeFile(copiedDoctorPath, JSON.stringify(copiedDoctor), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("start-wrapper")
    ]));
  });

  it("fails bundle verification when the copied plug-and-play doctor omits runtime dependency evidence", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedDoctorPath = path.join(result.bundleDirectory, "artifacts", doctorPath);
    const copiedDoctor = JSON.parse(await readFile(copiedDoctorPath, "utf8"));
    const runtimeCheck = copiedDoctor.checks.find((check: { id: string }) => check.id === "runtime-dependencies");
    runtimeCheck.details = "Node, package metadata, package-lock.json, and node_modules/.bin/tsx are present.";
    runtimeCheck.evidence = [
      "process.version",
      "package.json engines.node",
      "package.json engines.npm",
      "package.json packageManager",
      "package-lock.json",
      "package-lock.json packages[\"\"].engines",
      "node_modules/.bin/tsx"
    ];
    await writeFile(copiedDoctorPath, JSON.stringify(copiedDoctor), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Copied plug-and-play doctor must pass")
    ]));
  });

  it("fails bundle verification when the copied plug-and-play doctor omits repository safety evidence", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedDoctorPath = path.join(result.bundleDirectory, "artifacts", doctorPath);
    const copiedDoctor = JSON.parse(await readFile(copiedDoctorPath, "utf8"));
    copiedDoctor.checks = copiedDoctor.checks.filter((check: { id: string }) => check.id !== "repository-safety");
    await writeFile(copiedDoctorPath, JSON.stringify(copiedDoctor), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("plug-and-play doctor")
    ]));
  });

  it("fails bundle verification when a copied critical plug-and-play doctor check is only warning", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedDoctorPath = path.join(result.bundleDirectory, "artifacts", doctorPath);
    const copiedDoctor = JSON.parse(await readFile(copiedDoctorPath, "utf8"));
    copiedDoctor.checks.find((check: { id: string }) => check.id === "operator-start").status = "warn";
    await writeFile(copiedDoctorPath, JSON.stringify(copiedDoctor), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("start-wrapper")
    ]));
  });

  it("fails bundle verification when copied plug-and-play doctor predates copied acceptance", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    const copiedAcceptancePath = path.join(result.bundleDirectory, "artifacts", acceptancePath);
    const copiedAcceptance = JSON.parse(await readFile(copiedAcceptancePath, "utf8"));
    copiedAcceptance.generatedAt = Date.parse("2026-05-09T21:01:00.000Z");
    await writeFile(copiedAcceptancePath, JSON.stringify(copiedAcceptance), "utf8");

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("acceptance-freshness")
    ]));
  });

  it("fails bundle verification when a copied review artifact contains a high-confidence secret", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    await writeFile(
      path.join(result.bundleDirectory, "artifacts", demoPath),
      `SEEKR_INTERNAL_${"TOKEN"}=review-secret-token\n`,
      "utf8"
    );

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.secretScan).toMatchObject({
      status: "fail",
      findingCount: 1,
      findings: [
        expect.objectContaining({
          bundlePath: `artifacts/${demoPath}`,
          rule: "seekr-internal-token-assignment"
        })
      ]
    });
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("SEEKR_INTERNAL_TOKEN assignment")
    ]));
  });

  it("fails bundle verification when the secret scan cannot cover every copied artifact", async () => {
    const result = await writeHandoffBundle({
      root,
      label: "review",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });
    await rm(path.join(result.bundleDirectory, "artifacts", demoPath), { force: true });

    const verification = await writeHandoffBundleVerification({
      root,
      bundlePath: path.relative(root, result.jsonPath),
      generatedAt: "2026-05-09T21:05:00.000Z"
    });

    expect(verification.manifest.status).toBe("fail");
    expect(verification.manifest.commandUploadEnabled).toBe(false);
    expect(verification.manifest.secretScan).toMatchObject({
      status: "fail",
      expectedFileCount: 22,
      scannedFileCount: 21,
      findingCount: 0
    });
    expect(verification.manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Handoff bundle secret scan covered 21/22 copied files")
    ]));
  });
});

const indexPath = ".tmp/handoff-index/seekr-handoff-index-internal-alpha-2026-05-09T20-00-00-000Z.json";
const acceptancePath = ".tmp/acceptance-status.json";
const apiProbePath = ".tmp/api-probe/seekr-api-probe-test.json";
const demoPath = ".tmp/demo-readiness/seekr-demo-readiness-internal-alpha.json";
const benchPath = ".tmp/bench-evidence-packet/seekr-bench-evidence-packet-jetson-bench.json";
const workflowPath = ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json";
const qaReportPath = ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md";
const qaHomeScreenshotPath = ".gstack/qa-reports/screenshots/seekr-qa-2026-05-09T20-55-00Z-clean-home.png";
const qaMobileScreenshotPath = ".gstack/qa-reports/screenshots/seekr-qa-2026-05-09T20-55-00Z-clean-mobile.png";
const todoPath = ".tmp/todo-audit/seekr-todo-audit-test.json";
const sourceControlPath = ".tmp/source-control-handoff/seekr-source-control-handoff-test.json";
const setupPath = ".tmp/plug-and-play-setup/seekr-local-setup-test.json";
const doctorPath = ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json";
const rehearsalStartSmokePath = ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json";
const operatorQuickstartPath = "docs/OPERATOR_QUICKSTART.md";

async function seedBundleEvidence(root: string) {
  const acceptance = JSON.stringify({
    ok: true,
    generatedAt: Date.parse("2026-05-09T20:57:00.000Z"),
    commandUploadEnabled: false,
    completedCommands: ["typecheck", "test"],
    strictLocalAi: {
      ok: true,
      provider: "ollama",
      model: "llama3.2:latest",
      caseCount: REQUIRED_STRICT_AI_SMOKE_CASES.length,
      caseNames: [...REQUIRED_STRICT_AI_SMOKE_CASES]
    },
    releaseChecksum: {
      overallSha256: "a".repeat(64),
      fileCount: 10,
      totalBytes: 1000
    },
    commandBoundaryScan: {
      status: "pass",
      scannedFileCount: 128,
      violationCount: 0,
      allowedFindingCount: 36,
      commandUploadEnabled: false
    }
  });
  const apiProbe = JSON.stringify({
    ok: true,
    commandUploadEnabled: false,
    sessionAcceptance: {
      status: "pass",
      generatedAt: Date.parse("2026-05-09T20:57:00.000Z"),
      commandCount: 2,
      commandUploadEnabled: false,
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest",
        caseCount: REQUIRED_STRICT_AI_SMOKE_CASES.length,
        caseNames: [...REQUIRED_STRICT_AI_SMOKE_CASES]
      },
      releaseChecksum: {
        overallSha256: "a".repeat(64),
        fileCount: 10,
        totalBytes: 1000
      },
      commandBoundaryScan: {
        status: "pass",
        scannedFileCount: 128,
        violationCount: 0,
        allowedFindingCount: 36
      }
    }
  });
  const demo = JSON.stringify({ status: "ready-local-alpha", commandUploadEnabled: false });
  const bench = JSON.stringify({ status: "ready-for-bench-prep", commandUploadEnabled: false });
  const workflow = JSON.stringify({
    status: "pass-with-limitations",
    commandUploadEnabled: false,
    gstackAvailable: true,
    gstackCliAvailable: false,
    workflows: [
      { id: "health", status: "pass", skillAvailable: true },
      {
        id: "review",
        status: "blocked-by-workspace",
        skillAvailable: true,
        details: "Review workflow is available, but pre-landing diff review is blocked because this workspace has no .git metadata.",
        evidence: ["docs/goal.md", ".git"],
        limitations: ["workspace has no .git metadata for base-branch diff review"]
      },
      { id: "planning", status: "pass", skillAvailable: true },
      { id: "qa", status: "pass", skillAvailable: true }
    ],
    perspectives: [
      { id: "operator", status: "blocked-real-world", score: 7, nextAction: "complete fresh-operator closeout" },
      { id: "safety", status: "blocked-real-world", score: 8, nextAction: "collect HIL and policy evidence" },
      { id: "dx", status: "ready-local-alpha", score: 8, nextAction: "run diff review in a Git checkout" },
      { id: "replay", status: "ready-local-alpha", score: 9, nextAction: "keep API probe current" },
      { id: "demo-readiness", status: "blocked-real-world", score: 8, nextAction: "use bench evidence packet" }
    ],
    healthHistory: {
      status: "pass",
      path: "~/.gstack/projects/software/health-history.jsonl",
      latestEntry: {
        ts: "2026-05-09T20:55:00Z",
        score: 10,
        typecheck: 10,
        test: 10
      },
      commandUploadEnabled: false
    },
    qaReport: {
      status: "pass",
      path: qaReportPath,
      generatedAt: "2026-05-09T20:55:00Z",
      screenshotPaths: [qaHomeScreenshotPath, qaMobileScreenshotPath],
      commandUploadEnabled: false
    },
    limitations: [
      "GStack CLI is unavailable in this local test fixture.",
      "No .git metadata is present in this workspace."
    ]
  });
  const todoAudit = JSON.stringify({
    status: "pass-real-world-blockers-tracked",
    commandUploadEnabled: false,
    uncheckedTodoCount: 8,
    categoryCount: 8,
    realWorldBlockerCount: 8,
    blockedCategoryCount: 8,
    validationBlockerCount: 0,
    completionAudit: {
      status: "blocked-real-world-evidence",
      localAlphaOk: true,
      complete: false,
      commandUploadEnabled: false,
      realWorldBlockerCount: 8
    },
    validation: { ok: true, warnings: [], blockers: [] },
    categories: [
      "fresh-operator-field-laptop",
      "jetson-orin-nano-readiness",
      "raspberry-pi-5-readiness",
      "real-mavlink-telemetry",
      "real-ros2-topics",
      "hil-failsafe-manual-override",
      "isaac-sim-jetson-capture",
      "hardware-actuation-policy-review"
    ].map((id, index) => ({
      id,
      status: "blocked",
      todoMatches: [
        {
          sourcePath: index === 0 ? "docs/SEEKR_COMPLETION_PLAN.md" : "docs/SEEKR_GCS_ALPHA_TODO.md",
          line: 10 + index,
          text: `Unchecked TODO for ${id}`
        }
      ],
      completionBlockerMatches: [`Completion blocker for ${id}`]
    }))
  });
  const sourceControl = JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-09T20:57:30.000Z",
    status: "blocked-source-control-handoff",
    ready: false,
    commandUploadEnabled: false,
    repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    configuredRemoteUrls: [],
    remoteRefCount: 0,
    blockedCheckCount: 2,
    warningCheckCount: 3,
    checks: [
      {
        id: "repository-reference",
        status: "pass",
        details: "Package metadata or README documentation names the SEEKR GitHub repository.",
        evidence: ["package.json repository", "README.md"]
      },
      {
        id: "local-git-metadata",
        status: "blocked",
        details: "This workspace is not a Git worktree; local diff review and source-control handoff history are unavailable.",
        evidence: [".git"]
      },
      {
        id: "configured-github-remote",
        status: "warn",
        details: "No local Git metadata exists, so configured remotes cannot be inspected.",
        evidence: [".git/config"]
      },
      {
        id: "github-remote-refs",
        status: "blocked",
        details: "GitHub remote is reachable but has no published refs/default branch yet.",
        evidence: ["https://github.com/Ayush1298567/SEEKR", "git ls-remote --symref"]
      },
      {
        id: "local-head-published",
        status: "warn",
        details: "No local Git metadata exists, so the published commit cannot be compared to local HEAD.",
        evidence: ["git rev-parse HEAD", "git ls-remote --symref"]
      },
      {
        id: "working-tree-clean",
        status: "warn",
        details: "No local Git metadata exists, so the worktree cleanliness cannot be inspected.",
        evidence: ["git status --porcelain --untracked-files=normal"]
      }
    ],
    nextActionChecklist: [
      { id: "restore-or-initialize-local-git", status: "required", details: "Restore or initialize local Git metadata.", commands: ["git init"], clearsCheckIds: ["local-git-metadata"] },
      { id: "configure-github-origin", status: "required", details: "Configure the GitHub origin remote.", commands: ["git remote add origin git@github.com:Ayush1298567/SEEKR.git"], clearsCheckIds: ["configured-github-remote"] },
      { id: "publish-reviewed-main", status: "required", details: "Publish the reviewed main branch.", commands: ["git push -u origin main"], clearsCheckIds: ["github-remote-refs"] },
      { id: "rerun-source-control-audit", status: "verification", details: "Rerun the source-control audit after publication.", commands: ["npm run audit:source-control"], clearsCheckIds: ["repository-reference", "local-git-metadata", "configured-github-remote", "github-remote-refs", "local-head-published", "working-tree-clean"] }
    ],
    limitations: [
      "This audit is read-only and does not initialize Git, commit files, push branches, or change GitHub settings.",
      "Source-control handoff status is separate from aircraft hardware readiness.",
      "Real command upload and hardware actuation remain disabled."
    ]
  });
  const setup = JSON.stringify({
    ok: true,
    generatedAt: "2026-05-09T20:58:00.000Z",
    status: "ready-local-setup",
    commandUploadEnabled: false,
    envFilePath: ".env",
    envCreated: false,
    envAlreadyExisted: true,
    dataDirPath: ".tmp/rehearsal-data",
    checks: [
      { id: "env-example", status: "pass" },
      { id: "env-file", status: "pass" },
      { id: "rehearsal-data-dir", status: "pass" },
      { id: "safety-boundary", status: "pass" }
    ]
  });
  const doctor = JSON.stringify({
    ok: true,
    generatedAt: "2026-05-09T20:58:00.000Z",
    profile: "operator-start",
    status: "ready-local-start",
    commandUploadEnabled: false,
    ai: {
      provider: "ollama",
      model: "llama3.2:latest",
      status: "pass"
    },
    summary: {
      pass: 10,
      warn: 0,
      fail: 0
    },
    checks: [
      "package-scripts",
      "runtime-dependencies",
      "repository-safety",
      "source-control-handoff",
      "operator-start",
      "operator-env",
      "local-ai",
      "local-ports",
      "data-dir",
      "safety-boundary"
    ].map((id) => id === "runtime-dependencies"
      ? {
          id,
          status: "pass",
          details: "Node, package.json engines, packageManager, package-lock.json, node_modules/.bin/tsx, node_modules/.bin/concurrently, and node_modules/.bin/vite are present.",
          evidence: ["process.version", "package.json engines.node", "package.json engines.npm", "package.json packageManager", "package-lock.json", "package-lock.json packages[\"\"].engines", "node_modules/.bin/tsx", "node_modules/.bin/concurrently", "node_modules/.bin/vite"]
        }
      : id === "source-control-handoff"
        ? {
            id,
            status: "pass",
            details: `Source-control handoff artifact ${sourceControlPath} is ready.`,
            evidence: [sourceControlPath]
          }
      : {
          id,
          status: "pass",
          details: `${id} passed.`
        })
  });
  const rehearsalStartSmoke = JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-09T20:59:00.000Z",
    ok: true,
    status: "pass",
    commandUploadEnabled: false,
    command: "npm run rehearsal:start",
    apiPort: 8787,
    clientPort: 5173,
    dataDirPath: ".tmp/rehearsal-start-smoke/run-test/data",
    checked: ["wrapper-started", "api-health", "client-shell", "runtime-config", "source-health", "readiness", "shutdown"],
    checks: ["wrapper-started", "api-health", "client-shell", "runtime-config", "source-health", "readiness", "shutdown"].map((id) => ({
      id,
      status: "pass",
      details: `${id} passed.`,
      evidence: [id]
    })),
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    limitations: [
      "This smoke starts the local rehearsal wrapper only long enough to prove laptop startup.",
      "It does not validate actual Jetson/Pi hardware.",
      "Real command upload and hardware actuation remain disabled."
    ]
  });
  await writeFile(path.join(root, acceptancePath), acceptance, "utf8");
  await writeFile(path.join(root, apiProbePath), apiProbe, "utf8");
  await writeFile(path.join(root, demoPath), demo, "utf8");
  await writeFile(path.join(root, benchPath), bench, "utf8");
  await writeFile(path.join(root, workflowPath), workflow, "utf8");
  await writeFile(path.join(root, workflowPath.replace(/\.json$/, ".md")), "# GStack Workflow Status\n", "utf8");
  await mkdir(path.join(root, ".gstack/qa-reports"), { recursive: true });
  await mkdir(path.join(root, ".gstack/qa-reports/screenshots"), { recursive: true });
  await writeFile(path.join(root, qaReportPath), [
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
  await writeFile(path.join(root, todoPath), todoAudit, "utf8");
  await writeFile(path.join(root, todoPath.replace(/\.json$/, ".md")), "# SEEKR TODO Audit\n", "utf8");
  await writeFile(path.join(root, sourceControlPath), sourceControl, "utf8");
  await writeFile(path.join(root, sourceControlPath.replace(/\.json$/, ".md")), "# SEEKR Source-Control Handoff\n", "utf8");
  await writeFile(path.join(root, setupPath), setup, "utf8");
  await writeFile(path.join(root, setupPath.replace(/\.json$/, ".md")), "# SEEKR Local Setup\n", "utf8");
  await writeFile(path.join(root, doctorPath), doctor, "utf8");
  await writeFile(path.join(root, doctorPath.replace(/\.json$/, ".md")), "# SEEKR Plug-And-Play Doctor\n", "utf8");
  await writeFile(path.join(root, rehearsalStartSmokePath), rehearsalStartSmoke, "utf8");
  await writeFile(path.join(root, rehearsalStartSmokePath.replace(/\.json$/, ".md")), "# SEEKR Rehearsal Start Smoke\n", "utf8");
  await writeFile(path.join(root, operatorQuickstartPath), [
    "# SEEKR Operator Quickstart",
    "",
    "## Setup",
    "",
    "```bash",
    "npm ci",
    "npm run setup:local",
    "npm run audit:source-control",
    "npm run doctor",
    "npm run rehearsal:start",
    "```",
    "",
    "Local AI uses Ollama with llama3.2:latest.",
    "AI output is advisory. It can help select from validated candidate plans, but it cannot create command payloads or bypass operator validation.",
    "Check /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays before handoff.",
    "real-world blockers remain until physical evidence exists.",
    "No command upload or hardware actuation is allowed.",
    "No AI-created command payloads.",
    "No operator answer bypassing validation.",
    ""
  ].join("\n"), "utf8");

  await writeFile(path.join(root, indexPath), JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-09T20:00:00.000Z",
    status: "ready-local-alpha-handoff",
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    validation: { ok: true, warnings: [], blockers: [] },
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    hardwareClaims: falseClaims(),
    realWorldBlockers: ["No actual Jetson/Pi hardware evidence."],
    artifactDigests: [
      digest(acceptancePath, acceptance),
      digest(apiProbePath, apiProbe),
      digest(demoPath, demo),
      digest(benchPath, bench)
    ]
  }), "utf8");
  await writeFile(path.join(root, indexPath.replace(/\.json$/, ".md")), "# SEEKR Handoff Index\n", "utf8");
}

function digest(filePath: string, content: string) {
  return {
    path: filePath,
    bytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex")
  };
}

async function updateBundleManifestDigest(manifestPath: string, sourcePath: string, content: string) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const file = manifest.files.find((item: { sourcePath: string }) => item.sourcePath === sourcePath);
  file.bytes = Buffer.byteLength(content);
  file.sha256 = createHash("sha256").update(content).digest("hex");
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
}

function markSourceControlReady(manifest: {
  status: string;
  ready: boolean;
  configuredRemoteUrls: string[];
  remoteRefCount: number;
  blockedCheckCount: number;
  warningCheckCount: number;
  checks: Array<{ id: string; status: string; details: string; evidence: string[] }>;
  localHeadSha?: string;
  remoteDefaultBranchSha?: string;
  workingTreeStatusLineCount?: number;
}) {
  manifest.status = "ready-source-control-handoff";
  manifest.ready = true;
  manifest.configuredRemoteUrls = ["https://github.com/Ayush1298567/SEEKR.git"];
  manifest.remoteRefCount = 1;
  manifest.blockedCheckCount = 0;
  manifest.warningCheckCount = 0;
  manifest.localHeadSha = "1551c2f20dd0d51858200be22fde06f7b749f53d";
  manifest.remoteDefaultBranchSha = "1551c2f20dd0d51858200be22fde06f7b749f53d";
  manifest.workingTreeStatusLineCount = 0;
  manifest.checks = manifest.checks.map((check) => ({
    ...check,
    status: "pass",
    details: `${check.id} passed for a published clean source-control handoff.`
  }));
}

function falseClaims() {
  return {
    jetsonOrinNanoValidated: false,
    raspberryPi5Validated: false,
    realMavlinkBenchValidated: false,
    realRos2BenchValidated: false,
    hilFailsafeValidated: false,
    isaacJetsonCaptureValidated: false,
    hardwareActuationAuthorized: false
  };
}
