import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCompletionAudit } from "../../../scripts/completion-audit";
import { REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS } from "../../../scripts/fresh-clone-operator-smoke";
import { buildGoalAudit, writeGoalAudit } from "../../../scripts/goal-audit";
import { REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS } from "../../../scripts/rehearsal-start-smoke";
import { writeTodoAudit } from "../../../scripts/todo-audit";
import { REQUIRED_STRICT_AI_SMOKE_CASES } from "../ai/localAiEvidence";

const GENERATED_AT = "2026-05-09T21:00:00.000Z";
const GSTACK_TOOL_ROOT = "~/.gstack/repos/gstack/bin";
const GSTACK_TOOL_COUNT = 2;
const GSTACK_TOOL_NAMES = ["gstack-brain-sync", "gstack-slug"];
const GSTACK_HELPER_TOOL_EVIDENCE = `${GSTACK_TOOL_ROOT} (${GSTACK_TOOL_COUNT} gstack helper tools)`;
const GSTACK_CLI_UNAVAILABLE_LIMITATION = `gstack CLI is not available on PATH; local gstack helper tools are installed under ${GSTACK_TOOL_ROOT} (${GSTACK_TOOL_COUNT} executable helper(s)), so workflow status is recorded from installed skill/tool files and local package-script evidence instead of claiming umbrella CLI execution.`;

describe("goal audit", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-goal-audit-test-${process.pid}-${Date.now()}`);
    await seedRoot(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a prompt-to-artifact audit while keeping real-world blockers explicit", async () => {
    const result = await writeGoalAudit({
      root,
      outDir: ".tmp/goal-audit",
      generatedAt: GENERATED_AT
    });

    expect(result.manifest.localAlphaOk).toBe(true);
    expect(result.manifest.complete).toBe(false);
    expect(result.manifest.status).toBe("local-alpha-ready-real-world-blocked");
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.remainingRealWorldBlockerCount).toBe(8);
    expect(result.manifest.remainingRealWorldBlockers).toEqual(expect.arrayContaining([
      expect.stringContaining("Jetson Orin Nano"),
      expect.stringContaining("Raspberry Pi 5"),
      expect.stringContaining("MAVLink"),
      expect.stringContaining("ROS 2")
    ]));
    expect(result.manifest.promptToArtifactChecklist.find((item) => item.id === "demo-handoff-chain")).toMatchObject({
      status: "pass"
    });
    expect(result.manifest.promptToArtifactChecklist.find((item) => item.id === "todo-blocker-consistency")).toMatchObject({
      status: "pass"
    });
    expect(result.manifest.promptToArtifactChecklist.find((item) => item.id === "real-world-blockers")).toMatchObject({
      status: "blocked"
    });
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"remainingRealWorldBlockerCount\": 8");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Prompt-To-Artifact Checklist");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Count: 8");
  });

  it("can report complete only when the computed completion audit has no real-world blockers", async () => {
    await seedCompletedRealWorldEvidence(root);
    await seedCompletedTodoDocs(root);
    await writeCompletionAuditArtifact(root);
    await writeTodoAudit({ root, generatedAt: GENERATED_AT });
    await seedCompletedHandoffArtifacts(root);

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("complete");
    expect(manifest.localAlphaOk).toBe(true);
    expect(manifest.complete).toBe(true);
    expect(manifest.remainingRealWorldBlockerCount).toBe(0);
    expect(manifest.remainingRealWorldBlockers).toEqual([]);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "completion-audit")).toMatchObject({
      status: "pass",
      details: expect.stringContaining("complete")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "real-world-blockers")).toMatchObject({
      status: "pass"
    });
  });

  it("derives remaining blockers from the current completion audit when one hardware target is already validated", async () => {
    await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-z-jetson-actual.json"), JSON.stringify({
      commandUploadEnabled: false,
      actualHardwareValidationComplete: true,
      hardwareValidationScope: "actual-target",
      reports: [
        hardwareReport("jetson-orin-nano", "pass")
      ]
    }), "utf8");
    await writeJetsonCompletedTodoDocs(root);
    await writeCompletionAuditArtifact(root);
    await writeTodoAudit({ root, generatedAt: GENERATED_AT });
    await writePlugAndPlayReadinessArtifact(root, false);

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.remainingRealWorldBlockers).not.toContain("No actual Jetson Orin Nano hardware readiness archive is present.");
    expect(manifest.remainingRealWorldBlockerCount).toBe(7);
    expect(manifest.remainingRealWorldBlockers).toEqual(expect.arrayContaining([
      "No actual Raspberry Pi 5 hardware readiness archive is present.",
      "No Isaac Sim to Jetson capture from a real bench run is archived."
    ]));
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "real-world-blockers")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("7 real-world blocker")
    });
  });

  it("fails local alpha when API probe readback does not match latest acceptance evidence", async () => {
    const probePath = path.join(root, ".tmp/api-probe/seekr-api-probe-test.json");
    const probe = JSON.parse(await readFile(probePath, "utf8"));
    probe.sessionAcceptance.releaseChecksum.overallSha256 = "b".repeat(64);
    await writeFile(probePath, JSON.stringify(probe), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "api-readback")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("probe release checksum summary does not match acceptance status")
    });
  });

  it("fails local alpha when API probe AI readback does not match latest acceptance evidence", async () => {
    const probePath = path.join(root, ".tmp/api-probe/seekr-api-probe-test.json");
    const probe = JSON.parse(await readFile(probePath, "utf8"));
    probe.sessionAcceptance.strictLocalAi.model = "stale-model:latest";
    await writeFile(probePath, JSON.stringify(probe), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "api-readback")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("probe strict local AI summary does not match acceptance status")
    });
  });

  it("fails local alpha when API probe AI scenario names do not match latest acceptance evidence", async () => {
    const probePath = path.join(root, ".tmp/api-probe/seekr-api-probe-test.json");
    const probe = JSON.parse(await readFile(probePath, "utf8"));
    probe.sessionAcceptance.strictLocalAi.caseNames = REQUIRED_STRICT_AI_SMOKE_CASES.filter((name) => name !== "prompt-injection-spatial-metadata");
    await writeFile(probePath, JSON.stringify(probe), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "api-readback")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("probe strict local AI summary does not match acceptance status")
    });
  });

  it("fails local alpha when acceptance strict AI scenario names include untracked extras", async () => {
    const acceptancePath = path.join(root, ".tmp/acceptance-status.json");
    const probePath = path.join(root, ".tmp/api-probe/seekr-api-probe-test.json");
    const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
    const probe = JSON.parse(await readFile(probePath, "utf8"));
    acceptance.strictLocalAi.caseNames = [...REQUIRED_STRICT_AI_SMOKE_CASES, "untracked-extra-ai-scenario"];
    acceptance.strictLocalAi.caseCount = acceptance.strictLocalAi.caseNames.length;
    probe.sessionAcceptance.strictLocalAi.caseNames = acceptance.strictLocalAi.caseNames;
    probe.sessionAcceptance.strictLocalAi.caseCount = acceptance.strictLocalAi.caseCount;
    await writeFile(acceptancePath, JSON.stringify(acceptance), "utf8");
    await writeFile(probePath, JSON.stringify(probe), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "acceptance-and-release")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("untracked-extra-ai-scenario")
    });
  });

  it("fails local alpha when acceptance strict AI points at a non-loopback Ollama URL", async () => {
    const acceptancePath = path.join(root, ".tmp/acceptance-status.json");
    const probePath = path.join(root, ".tmp/api-probe/seekr-api-probe-test.json");
    const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
    const probe = JSON.parse(await readFile(probePath, "utf8"));
    acceptance.strictLocalAi.ollamaUrl = "https://api.example.com:11434";
    probe.sessionAcceptance.strictLocalAi.ollamaUrl = acceptance.strictLocalAi.ollamaUrl;
    await writeFile(acceptancePath, JSON.stringify(acceptance), "utf8");
    await writeFile(probePath, JSON.stringify(probe), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "acceptance-and-release")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("loopback Ollama URL")
    });
  });

  it("fails local alpha when plug-and-play readiness does not reference the latest setup artifact", async () => {
    await writeFile(path.join(root, ".tmp/plug-and-play-setup/seekr-local-setup-zz-newer.json"), JSON.stringify({
      ok: true,
      status: "ready-local-setup",
      commandUploadEnabled: false,
      envFilePath: ".env",
      dataDirPath: ".tmp/rehearsal-data",
      checks: [
        { id: "env-example", status: "pass" },
        { id: "env-file", status: "pass" },
        { id: "rehearsal-data-dir", status: "pass" },
        { id: "safety-boundary", status: "pass" }
      ]
    }), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest plug-and-play setup")
    });
  });

  it("surfaces plug-and-play readiness warnings without failing local alpha", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    const doctorCheck = readiness.checks.find((check: { id: string }) => check.id === "operator-doctor");
    doctorCheck.status = "warn";
    doctorCheck.details = "Latest operator-start doctor passed with soft warning(s): local-ports occupied.";
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(true);
    expect(manifest.summary.warn).toBe(1);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("local-ports occupied")
    });
  });

  it("fails local alpha when plug-and-play readiness hides operator-start port fallback diagnostics", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.operatorStartPorts.defaultPortsOccupied = false;
    readiness.operatorStartPorts.autoRecoverable = false;
    readiness.operatorStartPorts.listenerDiagnostics = [];
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("operator-start default-port occupancy summary")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")?.details).toContain("listener diagnostics summary");
  });

  it("fails local alpha when plug-and-play readiness hides fresh-clone summary drift", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.freshClone.cloneHeadSha = "stale-clone-head";
    readiness.freshClone.checked = readiness.freshClone.checked.slice(0, -1);
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("fresh-clone clone HEAD summary")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")?.details).toContain("fresh-clone checked-row summary");
  });

  it("fails local alpha when plug-and-play readiness does not reference source-control handoff evidence", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    for (const check of readiness.checks) {
      if (Array.isArray(check.evidence)) {
        check.evidence = check.evidence.filter((item: string) => !item.includes(".tmp/source-control-handoff/"));
      }
    }
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest source-control handoff")
    });
  });

  it("fails local alpha when plug-and-play readiness source-control summary drifts from latest evidence", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.sourceControl.workingTreeClean = false;
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("source-control clean-worktree summary must match")
    });
  });

  it("fails local alpha when plug-and-play readiness source-control repository summary drifts from latest evidence", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.sourceControl.repositoryUrl = "https://github.com/example/not-seekr";
    readiness.sourceControl.remoteDefaultBranch = "release";
    readiness.sourceControl.blockedCheckCount = 99;
    readiness.sourceControl.warningCheckCount = 99;
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("source-control repository URL summary must match")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")?.details).toContain("source-control blocked-check summary must match");
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")?.details).toContain("source-control warning-check summary must match");
  });

  it("fails local alpha when plug-and-play readiness source-control local branch summary drifts from latest evidence", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.sourceControl.localBranch = "release";
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("source-control local branch summary must match")
    });
  });

  it("fails local alpha when plug-and-play readiness review-bundle summary drifts from latest verification", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.reviewBundle.sourceControlHandoffRepositoryUrl = "https://github.com/example/not-seekr";
    readiness.reviewBundle.sourceControlHandoffRemoteDefaultBranch = "release";
    readiness.reviewBundle.sourceControlHandoffLocalHeadSha = "stale-head";
    readiness.reviewBundle.sourceControlHandoffBlockedCheckCount = 99;
    readiness.reviewBundle.sourceControlHandoffWarningCheckCount = 99;
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("review-bundle source-control repository URL summary must match")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")?.details).toContain("review-bundle source-control blocked-check summary must match");
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")?.details).toContain("review-bundle source-control warning-check summary must match");
  });

  it("fails local alpha when plug-and-play readiness review-bundle local branch summary drifts from latest verification", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.reviewBundle.sourceControlHandoffLocalBranch = "release";
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("review-bundle source-control local branch summary must match")
    });
  });

  it("fails local alpha when source-control handoff is not published and clean", async () => {
    const artifactPath = path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json");
    const sourceControl = JSON.parse(await readFile(artifactPath, "utf8"));
    sourceControl.status = "blocked-source-control-handoff";
    sourceControl.ready = false;
    sourceControl.localHeadSha = "local-only";
    sourceControl.remoteDefaultBranchSha = "published";
    sourceControl.workingTreeClean = false;
    sourceControl.workingTreeStatusLineCount = 1;
    sourceControl.blockedCheckCount = 2;
    sourceControl.checks = sourceControl.checks.map((check: { id: string; status: string; details: string }) => {
      if (check.id === "local-head-published") {
        return { ...check, status: "blocked", details: "Local HEAD is not published." };
      }
      if (check.id === "working-tree-clean") {
        return { ...check, status: "blocked", details: "Worktree has source changes." };
      }
      return check;
    });
    await writeFile(artifactPath, JSON.stringify(sourceControl), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "source-control-handoff")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("source-control handoff must be ready")
    });
  });

  it("fails local alpha when plug-and-play readiness does not reference the latest API probe", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    for (const check of readiness.checks) {
      if (Array.isArray(check.evidence)) {
        check.evidence = check.evidence.filter((item: string) => !item.includes(".tmp/api-probe/"));
      }
    }
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest API probe")
    });
  });

  it("fails local alpha when plug-and-play readiness predates the latest acceptance record", async () => {
    const acceptancePath = path.join(root, ".tmp/acceptance-status.json");
    const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
    acceptance.generatedAt = Date.parse("2026-05-09T21:00:01.000Z");
    await writeFile(acceptancePath, JSON.stringify(acceptance), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("newer than or equal to the latest acceptance record")
    });
  });

  it("fails local alpha when plug-and-play readiness omits the operator quickstart reference", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    for (const check of readiness.checks) {
      if (Array.isArray(check.evidence)) {
        check.evidence = check.evidence.filter((item: string) => item !== "docs/OPERATOR_QUICKSTART.md");
      }
    }
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("docs/OPERATOR_QUICKSTART.md")
    });
  });

  it("fails local alpha when plug-and-play readiness blocker count is stale", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.remainingRealWorldBlockerCount = 7;
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("blocker count must match")
    });
  });

  it("fails local alpha when plug-and-play readiness blocker list drifts from the completion audit", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.remainingRealWorldBlockers = [
      "Stale placeholder blocker that is not in the current completion audit.",
      ...readiness.remainingRealWorldBlockers.slice(1)
    ];
    readiness.remainingRealWorldBlockerCount = readiness.remainingRealWorldBlockers.length;
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("blocker list")
    });
  });

  it("fails local alpha when plug-and-play readiness blocker ID list drifts from the completion audit", async () => {
    const readinessPath = path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json");
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    readiness.remainingRealWorldBlockerIds = [
      "stale-placeholder-blocker",
      ...readiness.remainingRealWorldBlockerIds.slice(1)
    ];
    await writeFile(readinessPath, JSON.stringify(readiness), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("blocker ID list")
    });
  });

  it("fails local alpha when persisted completion audit blocker IDs drift from the computed audit", async () => {
    const completionPath = path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.realWorldBlockerIds = [
      "stale-placeholder-blocker",
      ...completion.realWorldBlockerIds.slice(1)
    ];
    await writeFile(completionPath, JSON.stringify(completion), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "completion-audit")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("blocker IDs")
    });
  });

  it("fails local alpha when completion audit is complete but the handoff chain is stale", async () => {
    await seedCompletedRealWorldEvidence(root);
    await seedCompletedTodoDocs(root);
    await writeCompletionAuditArtifact(root);
    await writeTodoAudit({ root, generatedAt: GENERATED_AT });

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.complete).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "demo-handoff-chain")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("complete flag must match")
    });
  });

  it("fails local alpha when the package command surface is incomplete", async () => {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: {
        check: "npm run typecheck && npm run test"
      }
    }), "utf8");
    await writeCompletionAuditArtifact(root);

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.status).toBe("local-alpha-failing");
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "named-commands")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("bridge:spatial")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "named-commands")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("audit:goal")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "named-commands")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("audit:todo")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "named-commands")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("audit:source-control")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "named-commands")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("rehearsal:start")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "named-commands")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("qa:gstack")
    });
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "named-commands")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("health:gstack")
    });
  });

  it("fails local alpha when the final handoff verification is missing", async () => {
    await rm(path.join(root, ".tmp/handoff-index/seekr-handoff-verification-test.json"));

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "critical-safety-rule")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("handoff verification evidence is missing")
    });
  });

  it("fails local alpha when review-bundle verification reports secret findings", async () => {
    await writeFile(path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json"), JSON.stringify({
      status: "pass",
      commandUploadEnabled: false,
      sourceBundlePath: ".tmp/handoff-bundles/seekr-handoff-bundle-internal-alpha-test.json",
      sourceIndexPath: ".tmp/handoff-index/seekr-handoff-index-internal-alpha-test.json",
      gstackWorkflowStatusPath: ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json",
      todoAuditPath: ".tmp/todo-audit/seekr-todo-audit-2026-05-09T21-00-00-000Z.json",
      checkedFileCount: 5,
      secretScan: {
        status: "fail",
        expectedFileCount: 5,
        scannedFileCount: 5,
        findingCount: 1,
        findings: [
          {
            bundlePath: "artifacts/.tmp/demo-readiness/seekr-demo-readiness-internal-alpha-test.json",
            rule: "seekr-internal-token-assignment",
            details: "Copied bundle file appears to contain a SEEKR_INTERNAL_TOKEN assignment."
          }
        ]
      },
      validation: { ok: true, warnings: [], blockers: [] }
    }), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "demo-handoff-chain")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("secret scan")
    });
  });

  it("fails local alpha when review-bundle verification secret scan coverage is incomplete", async () => {
    await writeFile(path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json"), JSON.stringify({
      status: "pass",
      commandUploadEnabled: false,
      sourceBundlePath: ".tmp/handoff-bundles/seekr-handoff-bundle-internal-alpha-test.json",
      sourceIndexPath: ".tmp/handoff-index/seekr-handoff-index-internal-alpha-test.json",
      gstackWorkflowStatusPath: ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json",
      todoAuditPath: ".tmp/todo-audit/seekr-todo-audit-2026-05-09T21-00-00-000Z.json",
      checkedFileCount: 5,
      secretScan: {
        status: "pass",
        expectedFileCount: 5,
        scannedFileCount: 4,
        findingCount: 0,
        findings: []
      },
      validation: { ok: true, warnings: [], blockers: [] }
    }), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "demo-handoff-chain")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("cover every checked copied file")
    });
  });

  it("fails local alpha when review-bundle verification omits strict local AI smoke status", async () => {
    const bundleVerificationPath = path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json");
    const verification = JSON.parse(await readFile(bundleVerificationPath, "utf8"));
    delete verification.strictAiSmokeStatusPath;
    await writeFile(bundleVerificationPath, JSON.stringify(verification), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "demo-handoff-chain")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("strict local AI smoke status")
    });
  });

  it("fails local alpha when the review bundle does not include the latest gstack workflow status", async () => {
    await writeFile(path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-zz-newer.json"), JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-09T22:00:00.000Z",
      status: "pass-with-limitations",
      commandUploadEnabled: false,
      gstackAvailable: true,
      gstackCliAvailable: false,
      gstackToolRoot: GSTACK_TOOL_ROOT,
      gstackToolCount: GSTACK_TOOL_COUNT,
      gstackToolNames: GSTACK_TOOL_NAMES,
      workflows: [
        { id: "health", status: "pass", skillAvailable: true, details: "health ok", evidence: [], limitations: [] },
        { id: "review", status: "blocked-by-workspace", skillAvailable: true, details: "no git", evidence: [], limitations: ["workspace has no .git metadata for base-branch diff review"] },
        { id: "planning", status: "pass", skillAvailable: true, details: "planning ok", evidence: [], limitations: [] },
        { id: "qa", status: "pass", skillAvailable: true, details: "qa ok", evidence: [], limitations: [] }
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
        latestEntry: {
          ts: "2026-05-09T22:00:00.000Z",
          score: 10,
          typecheck: 10,
          test: 10
        },
        commandUploadEnabled: false
      },
      qaReport: {
        status: "pass",
        path: ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md",
        generatedAt: "2026-05-09T20:55:00Z",
        commandUploadEnabled: false
      },
      evidence: ["docs/goal.md", GSTACK_HELPER_TOOL_EVIDENCE, ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md"],
      limitations: [
        GSTACK_CLI_UNAVAILABLE_LIMITATION,
        "No .git metadata is present in this workspace."
      ]
    }), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "demo-handoff-chain")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest gstack workflow status artifact")
    });
  });

  it("fails local alpha when the review bundle omits gstack QA screenshots", async () => {
    const bundlePath = path.join(root, ".tmp/handoff-bundles/seekr-handoff-bundle-internal-alpha-test.json");
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    bundle.gstackQaScreenshotPaths = [];
    await writeFile(bundlePath, JSON.stringify(bundle), "utf8");

    const bundleVerificationPath = path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json");
    const verification = JSON.parse(await readFile(bundleVerificationPath, "utf8"));
    verification.gstackQaScreenshotPaths = [];
    await writeFile(bundleVerificationPath, JSON.stringify(verification), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "demo-handoff-chain")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("gstack QA screenshots")
    });
  });

  it("fails local alpha when gstack workflow status is not documented", async () => {
    await writeFile(path.join(root, "docs/goal.md"), [
      "# Goal",
      "## Prompt-To-Artifact",
      "## Acceptance Expectations",
      "## Latest Verification",
      "## Real-World Blockers",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("GStack Workflow Status")
    });
  });

  it("fails local alpha when gstack workflow artifact is missing", async () => {
    await rm(path.join(root, ".tmp/gstack-workflow-status"), { recursive: true, force: true });

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("gstack workflow status artifact is missing")
    });
  });

  it("fails local alpha when a required gstack workflow omits installed skill availability", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as {
      workflows: Array<{ id: string; skillAvailable?: boolean; status?: string; details?: string; limitations?: string[] }>;
    };
    workflow.workflows.find((item) => item.id === "planning")!.skillAvailable = false;
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("installed skill availability")
    });
  });

  it("fails local alpha when gstack workflow rows are reordered", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as {
      workflows: Array<{ id: string }>;
    };
    [workflow.workflows[0], workflow.workflows[1]] = [workflow.workflows[1], workflow.workflows[0]];
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("all workflows")
    });
  });

  it("fails local alpha when the no-git review workflow is overclaimed as pass", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as {
      workflows: Array<{ id: string; status?: string; details?: string; limitations?: string[] }>;
    };
    const review = workflow.workflows.find((item) => item.id === "review")!;
    review.status = "pass";
    review.details = "Review workflow completed.";
    review.limitations = [];
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("no-Git review limitations")
    });
  });

  it("fails local alpha when top-level gstack workflow status hides limitation-only evidence", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as { status: string };
    workflow.status = "pass";
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("pass-with-limitations for limitation-only evidence")
    });
  });

  it("fails local alpha when gstack workflow status drops manifest-level limitation details", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as { limitations?: string[] };
    workflow.limitations = [];
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("manifest-level limitation details")
    });
  });

  it("fails local alpha when unavailable gstack CLI is not documented in manifest-level limitations", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as { limitations?: string[] };
    workflow.limitations = ["No .git metadata is present in this workspace."];
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("manifest-level limitation details")
    });
  });

  it("fails local alpha when unavailable gstack CLI helper-tool evidence is not preserved", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as { gstackToolNames?: string[] };
    delete workflow.gstackToolNames;
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("helper-tool evidence")
    });
  });

  it("fails local alpha when gstack workflow perspectives drop review details", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as {
      perspectives: Array<{ id: string; status?: string; score?: number; nextAction?: string }>;
    };
    workflow.perspectives[0].score = undefined;
    workflow.perspectives[1].nextAction = "";
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("perspective status/score/nextAction")
    });
  });

  it("fails local alpha when gstack perspective rows are reordered", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as {
      perspectives: Array<{ id: string; status?: string; score?: number; nextAction?: string }>;
    };
    [workflow.perspectives[0], workflow.perspectives[1]] = [workflow.perspectives[1], workflow.perspectives[0]];
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("perspective status/score/nextAction")
    });
  });

  it("fails local alpha when stale gstack QA evidence drops limitation details", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as {
      qaReport: { status: string; limitations?: string[] };
      workflows: Array<{ id: string; status?: string; limitations?: string[] }>;
    };
    workflow.qaReport.status = "stale";
    workflow.qaReport.limitations = [];
    const qaWorkflow = workflow.workflows.find((item) => item.id === "qa")!;
    qaWorkflow.status = "pass-with-limitations";
    qaWorkflow.limitations = [];
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("preserve limitation details")
    });
  });

  it("fails local alpha when the todo audit artifact is missing", async () => {
    await rm(path.join(root, ".tmp/todo-audit"), { recursive: true, force: true });

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "todo-blocker-consistency")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("todo audit artifact is missing")
    });
  });

  it("fails local alpha when the todo audit artifact is stale against the planning docs", async () => {
    await writeFile(path.join(root, "docs/SEEKR_GCS_ALPHA_TODO.md"), [
      "# SEEKR GCS Internal Alpha Todo",
      "",
      "## Drone Integration Prerequisites",
      "",
      "- [ ] Run hardware readiness probe on an actual Jetson Orin Nano.",
      "- [ ] Run hardware readiness probe on an actual Raspberry Pi 5.",
      "- [ ] Add HIL bench logs for failsafe behavior with manual override evidence.",
      "- [ ] Add reviewed hardware-actuation policy file for a specific bench vehicle before any real command enablement.",
      "- [ ] Connect read-only ROS 2 bridge to real `/map`, pose, detection, LiDAR, and costmap topics on bench hardware.",
      "- [ ] Add Isaac Sim HIL fixture capture from Jetson bench run.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "todo-blocker-consistency")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("MAVLink")
    });
  });

  it("fails local alpha when gstack workflow status omits health history metadata", async () => {
    await writeFile(path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-zz-no-health.json"), JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-09T22:30:00.000Z",
      status: "pass-with-limitations",
      commandUploadEnabled: false,
      gstackAvailable: true,
      gstackCliAvailable: false,
      workflows: [
        { id: "health", status: "pass", skillAvailable: true, details: "health ok", evidence: [], limitations: [] },
        { id: "review", status: "blocked-by-workspace", skillAvailable: true, details: "no git", evidence: [], limitations: ["workspace has no .git metadata for base-branch diff review"] },
        { id: "planning", status: "pass", skillAvailable: true, details: "planning ok", evidence: [], limitations: [] },
        { id: "qa", status: "pass", skillAvailable: true, details: "qa ok", evidence: [], limitations: [] }
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
        path: ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md",
        generatedAt: "2026-05-09T20:55:00Z",
        commandUploadEnabled: false
      },
      evidence: ["docs/goal.md", ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md"],
      limitations: [
        "gstack CLI is not available on PATH; workflow status is recorded from installed skill files and local package-script evidence instead of claiming CLI execution.",
        "No .git metadata is present in this workspace."
      ]
    }), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("health history status")
    });
  });

  it("fails local alpha when gstack workflow status claims passing health history without a path", async () => {
    await writeFile(path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-zz-health-no-path.json"), JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-09T22:35:00.000Z",
      status: "pass-with-limitations",
      commandUploadEnabled: false,
      gstackAvailable: true,
      gstackCliAvailable: false,
      workflows: [
        { id: "health", status: "pass", skillAvailable: true, details: "health ok", evidence: [], limitations: [] },
        { id: "review", status: "blocked-by-workspace", skillAvailable: true, details: "no git", evidence: [], limitations: ["workspace has no .git metadata for base-branch diff review"] },
        { id: "planning", status: "pass", skillAvailable: true, details: "planning ok", evidence: [], limitations: [] },
        { id: "qa", status: "pass", skillAvailable: true, details: "qa ok", evidence: [], limitations: [] }
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
        latestEntry: {
          ts: "2026-05-09T22:35:00.000Z",
          score: 10,
          typecheck: 10,
          test: 10
        },
        commandUploadEnabled: false
      },
      qaReport: {
        status: "pass",
        path: ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md",
        generatedAt: "2026-05-09T20:55:00Z",
        commandUploadEnabled: false
      },
      evidence: ["docs/goal.md", ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md"],
      limitations: [
        "gstack CLI is not available on PATH; workflow status is recorded from installed skill files and local package-script evidence instead of claiming CLI execution.",
        "No .git metadata is present in this workspace."
      ]
    }), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("health history status/path")
    });
  });

  it("fails local alpha when gstack workflow status claims passing QA without a report path", async () => {
    await writeFile(path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-zz-qa-no-path.json"), JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-09T22:40:00.000Z",
      status: "pass-with-limitations",
      commandUploadEnabled: false,
      gstackAvailable: true,
      gstackCliAvailable: false,
      workflows: [
        { id: "health", status: "pass", skillAvailable: true, details: "health ok", evidence: [], limitations: [] },
        { id: "review", status: "blocked-by-workspace", skillAvailable: true, details: "no git", evidence: [], limitations: ["workspace has no .git metadata for base-branch diff review"] },
        { id: "planning", status: "pass", skillAvailable: true, details: "planning ok", evidence: [], limitations: [] },
        { id: "qa", status: "pass", skillAvailable: true, details: "qa ok", evidence: [], limitations: [] }
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
      },
      evidence: ["docs/goal.md"],
      limitations: [
        "gstack CLI is not available on PATH; workflow status is recorded from installed skill files and local package-script evidence instead of claiming CLI execution.",
        "No .git metadata is present in this workspace."
      ]
    }), "utf8");

    const manifest = await buildGoalAudit({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.promptToArtifactChecklist.find((item) => item.id === "gstack-workflow-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("local QA report status")
    });
  });
});

async function seedRoot(root: string) {
  const releasePath = ".tmp/release-evidence/seekr-release-test.json";
  const safetyPath = ".tmp/safety-evidence/seekr-command-boundary-scan-test.json";
  const apiProbePath = ".tmp/api-probe/seekr-api-probe-test.json";
  const demoPath = ".tmp/demo-readiness/seekr-demo-readiness-internal-alpha-test.json";
  const benchPath = ".tmp/bench-evidence-packet/seekr-bench-evidence-packet-jetson-bench-test.json";
  const handoffPath = ".tmp/handoff-index/seekr-handoff-index-internal-alpha-test.json";
  const bundlePath = ".tmp/handoff-bundles/seekr-handoff-bundle-internal-alpha-test.json";
  const bundleVerificationPath = ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json";
  const workflowPath = ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json";
  const qaReportPath = ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md";
  const qaHomeScreenshotPath = ".gstack/qa-reports/screenshots/seekr-qa-2026-05-09T20-55-00Z-clean-home.png";
  const qaMobileScreenshotPath = ".gstack/qa-reports/screenshots/seekr-qa-2026-05-09T20-55-00Z-clean-mobile.png";
  const todoAuditPath = ".tmp/todo-audit/seekr-todo-audit-2026-05-09T21-00-00-000Z.json";
  const sourceControlPath = ".tmp/source-control-handoff/seekr-source-control-handoff-test.json";
  const plugAndPlaySetupPath = ".tmp/plug-and-play-setup/seekr-local-setup-test.json";
  const localAiPreparePath = ".tmp/local-ai-prepare/seekr-local-ai-prepare-test.json";
  const plugAndPlayDoctorPath = ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json";
  const rehearsalStartSmokePath = ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json";
  const freshCloneSmokePath = ".tmp/fresh-clone-smoke/seekr-fresh-clone-smoke-test.json";
  const strictAiSmokePath = ".tmp/ai-smoke-status.json";
  const releaseChecksum = "a".repeat(64);
  const releaseFileCount = 42;
  const releaseTotalBytes = 123456;
  const scannedFileCount = 12;
  const allowedFindingCount = 3;

  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "src/server/adapters"), { recursive: true });
  await mkdir(path.join(root, ".tmp/release-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/hardware-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/safety-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/api-probe"), { recursive: true });
  await mkdir(path.join(root, ".tmp/completion-audit"), { recursive: true });
  await mkdir(path.join(root, ".tmp/demo-readiness"), { recursive: true });
  await mkdir(path.join(root, ".tmp/bench-evidence-packet"), { recursive: true });
  await mkdir(path.join(root, ".tmp/handoff-index"), { recursive: true });
  await mkdir(path.join(root, ".tmp/handoff-bundles"), { recursive: true });
  await mkdir(path.join(root, ".tmp/gstack-workflow-status"), { recursive: true });
  await mkdir(path.join(root, ".tmp/source-control-handoff"), { recursive: true });
  await mkdir(path.join(root, ".tmp/plug-and-play-setup"), { recursive: true });
  await mkdir(path.join(root, ".tmp/local-ai-prepare"), { recursive: true });
  await mkdir(path.join(root, ".tmp/plug-and-play-doctor"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-start-smoke"), { recursive: true });
  await mkdir(path.join(root, ".tmp/fresh-clone-smoke"), { recursive: true });
  await mkdir(path.join(root, ".tmp/plug-and-play-readiness"), { recursive: true });
  await mkdir(path.join(root, ".tmp/overnight"), { recursive: true });
  await mkdir(path.join(root, ".gstack/qa-reports/screenshots"), { recursive: true });

  for (const doc of [
    "README.md",
    "docs/FLIGHT_SOFTWARE.md",
    "docs/EDGE_HARDWARE_BENCH.md",
    "docs/HARDWARE_DECISION_GATE.md",
    "docs/V1_ACCEPTANCE.md",
    "docs/OPERATOR_QUICKSTART.md"
  ]) {
    await writeFile(path.join(root, doc), `${doc}\n`, "utf8");
  }
  await writeTodoDocs(root);
  await writeFile(path.join(root, "docs/goal.md"), [
    "# Goal",
    "## Prompt-To-Artifact",
    "## Acceptance Expectations",
    "## GStack Workflow Status",
    "Health: typecheck, Vitest, and Playwright are clean.",
    "Planning: docs/goal.md and audit:goal map operator, safety, DX, replay, and demo-readiness evidence.",
    "Review: diff-based review is unavailable when Git metadata is absent.",
    "QA: Playwright covers operator shell workflows.",
    "## Latest Verification",
    "## Real-World Blockers",
    ""
  ].join("\n"), "utf8");
  await writePackageJson(root);

  await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
    ok: true,
    generatedAt: Date.parse("2026-05-09T20:00:00.000Z"),
    completedCommands: ["typecheck", "test", "ui"],
    strictLocalAi: {
      ok: true,
      provider: "ollama",
      model: "llama3.2:latest",
      ollamaUrl: "http://127.0.0.1:11434",
        caseCount: REQUIRED_STRICT_AI_SMOKE_CASES.length,
      caseNames: [...REQUIRED_STRICT_AI_SMOKE_CASES]
    },
    releaseChecksum: {
      jsonPath: releasePath,
      sha256Path: releasePath.replace(/\.json$/, ".sha256"),
      markdownPath: releasePath.replace(/\.json$/, ".md"),
      overallSha256: releaseChecksum,
      fileCount: releaseFileCount,
      totalBytes: releaseTotalBytes
    },
    commandBoundaryScan: {
      jsonPath: safetyPath,
      markdownPath: safetyPath.replace(/\.json$/, ".md"),
      status: "pass",
      scannedFileCount,
      violationCount: 0,
      allowedFindingCount,
      commandUploadEnabled: false
    },
    commandUploadEnabled: false
  }), "utf8");
  await writeFile(path.join(root, releasePath), JSON.stringify({
    commandUploadEnabled: false,
    overallSha256: releaseChecksum,
    fileCount: releaseFileCount,
    totalBytes: releaseTotalBytes
  }), "utf8");
  await writeFile(path.join(root, safetyPath), JSON.stringify({
    status: "pass",
    commandUploadEnabled: false,
    summary: {
      scannedFileCount,
      violationCount: 0,
      allowedFindingCount
    }
  }), "utf8");
  await writeFile(path.join(root, apiProbePath), JSON.stringify({
    ok: true,
    commandUploadEnabled: false,
    checked: [
      "config",
      "session-acceptance",
      "session-acceptance-evidence",
      "readiness",
      "hardware-readiness",
      "source-health",
      "verify",
      "replays",
      "malformed-json"
    ],
    sessionAcceptance: {
      status: "pass",
      generatedAt: Date.parse("2026-05-09T20:00:00.000Z"),
      commandCount: 3,
      commandUploadEnabled: false,
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest",
        ollamaUrl: "http://127.0.0.1:11434",
        caseCount: REQUIRED_STRICT_AI_SMOKE_CASES.length,
        caseNames: [...REQUIRED_STRICT_AI_SMOKE_CASES]
      },
      releaseChecksum: {
        overallSha256: releaseChecksum,
        fileCount: releaseFileCount,
        totalBytes: releaseTotalBytes
      },
      commandBoundaryScan: {
        status: "pass",
        scannedFileCount,
        violationCount: 0,
        allowedFindingCount
      }
    },
    validation: { ok: true, warnings: [], blockers: [] }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-test.json"), JSON.stringify({
    commandUploadEnabled: false,
    validation: { ok: true }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-test.json"), JSON.stringify({
    commandUploadEnabled: false,
    reports: [
      hardwareReport("jetson-orin-nano", "warn"),
      hardwareReport("raspberry-pi-5", "warn")
    ]
  }), "utf8");
  await writeFile(path.join(root, ".tmp/overnight/STATUS.md"), "- Last update: 2026-05-09T20:00:00Z\n- Verdict: pass\n", "utf8");
  await writeFile(path.join(root, "src/server/adapters/mavlinkAdapter.ts"), "commandRejected('read-only');\n// read-only\n", "utf8");
  await writeFile(path.join(root, "src/server/adapters/ros2SlamAdapter.ts"), "commandRejected('read-only');\n// read-only\n", "utf8");

  await writeCompletionAuditArtifact(root);
  await writeTodoAudit({ root, generatedAt: GENERATED_AT });
  await writePlugAndPlayReadinessArtifact(root, false);
  await writeFile(path.join(root, demoPath), JSON.stringify({
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    artifacts: {
      acceptanceStatusPath: ".tmp/acceptance-status.json",
      releaseEvidenceJsonPath: releasePath,
      safetyScanJsonPath: safetyPath,
      apiProbeJsonPath: apiProbePath,
      completionAuditJsonPath: ".tmp/completion-audit/seekr-completion-audit-test.json",
      hardwareEvidenceJsonPath: ".tmp/hardware-evidence/seekr-hardware-evidence-test.json",
      overnightStatusPath: ".tmp/overnight/STATUS.md"
    },
    validation: { ok: true, warnings: [], blockers: [] },
    perspectiveReview: [
      { id: "operator", status: "blocked-real-world" },
      { id: "safety", status: "blocked-real-world" },
      { id: "dx", status: "ready-local-alpha" },
      { id: "replay", status: "ready-local-alpha" },
      { id: "demo-readiness", status: "blocked-real-world" }
    ]
  }), "utf8");
  await writeFile(path.join(root, benchPath), JSON.stringify({
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    sourceDemoReadinessPackagePath: demoPath,
    validation: { ok: true, warnings: [], blockers: [] }
  }), "utf8");
  await writeFile(path.join(root, handoffPath), JSON.stringify({
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    hardwareClaims: {
      jetsonOrinNanoValidated: false,
      raspberryPi5Validated: false,
      realMavlinkBenchValidated: false,
      realRos2BenchValidated: false,
      hilFailsafeValidated: false,
      isaacJetsonCaptureValidated: false,
      hardwareActuationAuthorized: false
    },
    validation: { ok: true, warnings: [], blockers: [] },
    artifactDigests: []
  }), "utf8");
  await writeFile(path.join(root, ".tmp/handoff-index/seekr-handoff-verification-test.json"), JSON.stringify({
    status: "pass",
    commandUploadEnabled: false,
    indexPath: handoffPath,
    digestCount: 0,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    validation: { ok: true, warnings: [], blockers: [] }
  }), "utf8");
  await writeFile(path.join(root, bundlePath), JSON.stringify({
    status: "ready-local-alpha-review-bundle",
    commandUploadEnabled: false,
    sourceIndexPath: handoffPath,
    sourceIndexComplete: false,
    gstackWorkflowStatusPath: workflowPath,
    gstackWorkflowStatus: "pass-with-limitations",
    gstackQaReportPath: qaReportPath,
    gstackQaReportStatus: "pass",
    gstackQaScreenshotPaths: [qaHomeScreenshotPath, qaMobileScreenshotPath],
    todoAuditPath,
    todoAuditStatus: "pass-real-world-blockers-tracked",
    sourceControlHandoffPath: sourceControlPath,
    sourceControlHandoffStatus: "ready-source-control-handoff",
    sourceControlHandoffReady: true,
    sourceControlHandoffRepositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    sourceControlHandoffPackageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
    sourceControlHandoffConfiguredRemoteUrls: ["https://github.com/Ayush1298567/SEEKR.git"],
    sourceControlHandoffLocalBranch: "main",
    sourceControlHandoffRemoteDefaultBranch: "main",
    sourceControlHandoffRemoteRefCount: 1,
    sourceControlHandoffBlockedCheckCount: 0,
    sourceControlHandoffWarningCheckCount: 0,
    sourceControlHandoffLocalHeadSha: "abc1234567890",
    sourceControlHandoffRemoteDefaultBranchSha: "abc1234567890",
    sourceControlHandoffWorkingTreeClean: true,
    sourceControlHandoffWorkingTreeStatusLineCount: 0,
    plugAndPlaySetupPath,
    plugAndPlaySetupStatus: "ready-local-setup",
    localAiPreparePath,
    localAiPrepareStatus: "ready-local-ai-model",
    localAiPrepareModel: "llama3.2:latest",
    plugAndPlayDoctorPath,
    plugAndPlayDoctorStatus: "ready-local-start",
    rehearsalStartSmokePath,
    rehearsalStartSmokeStatus: "pass",
    freshCloneSmokePath,
    freshCloneSmokeStatus: "pass",
    freshCloneSmokeCloneHeadSha: "abc1234567890",
    strictAiSmokeStatusPath: strictAiSmokePath,
    copiedFileCount: 12,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    hardwareClaims: {
      jetsonOrinNanoValidated: false,
      raspberryPi5Validated: false,
      realMavlinkBenchValidated: false,
      realRos2BenchValidated: false,
      hilFailsafeValidated: false,
      isaacJetsonCaptureValidated: false,
      hardwareActuationAuthorized: false
    },
    validation: { ok: true, warnings: [], blockers: [] }
  }), "utf8");
  await writeFile(path.join(root, bundleVerificationPath), JSON.stringify({
    status: "pass",
    commandUploadEnabled: false,
    sourceBundlePath: bundlePath,
    sourceIndexPath: handoffPath,
    gstackWorkflowStatusPath: workflowPath,
    gstackQaReportPath: qaReportPath,
    gstackQaScreenshotPaths: [qaHomeScreenshotPath, qaMobileScreenshotPath],
    todoAuditPath,
    sourceControlHandoffPath: sourceControlPath,
    sourceControlHandoffRepositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    sourceControlHandoffPackageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
    sourceControlHandoffConfiguredRemoteUrls: ["https://github.com/Ayush1298567/SEEKR.git"],
    sourceControlHandoffLocalBranch: "main",
    sourceControlHandoffRemoteDefaultBranch: "main",
    sourceControlHandoffRemoteRefCount: 1,
    sourceControlHandoffBlockedCheckCount: 0,
    sourceControlHandoffWarningCheckCount: 0,
    sourceControlHandoffLocalHeadSha: "abc1234567890",
    sourceControlHandoffRemoteDefaultBranchSha: "abc1234567890",
    sourceControlHandoffWorkingTreeClean: true,
    sourceControlHandoffWorkingTreeStatusLineCount: 0,
    plugAndPlaySetupPath,
    localAiPreparePath,
    plugAndPlayDoctorPath,
    rehearsalStartSmokePath,
    freshCloneSmokePath,
    strictAiSmokeStatusPath: strictAiSmokePath,
    checkedFileCount: 12,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    secretScan: {
      status: "pass",
      expectedFileCount: 12,
      scannedFileCount: 12,
      findingCount: 0,
      findings: []
    },
    validation: { ok: true, warnings: [], blockers: [] }
  }), "utf8");
  await writeFile(path.join(root, workflowPath), JSON.stringify({
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    status: "pass-with-limitations",
    commandUploadEnabled: false,
    gstackAvailable: true,
    gstackCliAvailable: false,
    gstackToolRoot: GSTACK_TOOL_ROOT,
    gstackToolCount: GSTACK_TOOL_COUNT,
    gstackToolNames: GSTACK_TOOL_NAMES,
    workflows: [
      { id: "health", status: "pass", skillAvailable: true, details: "health ok", evidence: [], limitations: [] },
      { id: "review", status: "blocked-by-workspace", skillAvailable: true, details: "no git", evidence: [], limitations: ["workspace has no .git metadata for base-branch diff review"] },
      { id: "planning", status: "pass", skillAvailable: true, details: "planning ok", evidence: [], limitations: [] },
      { id: "qa", status: "pass", skillAvailable: true, details: "qa ok", evidence: [], limitations: [] }
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
    evidence: ["docs/goal.md", GSTACK_HELPER_TOOL_EVIDENCE, qaReportPath, qaHomeScreenshotPath, qaMobileScreenshotPath],
    limitations: [
      GSTACK_CLI_UNAVAILABLE_LIMITATION,
      "No .git metadata is present in this workspace."
    ]
  }), "utf8");
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
  await writeFile(path.join(root, sourceControlPath), JSON.stringify({
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    status: "ready-source-control-handoff",
    ready: true,
    commandUploadEnabled: false,
    repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    packageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
    gitMetadataPath: "../.git",
    localBranch: "main",
    localHeadSha: "abc1234567890",
    remoteDefaultBranch: "main",
    remoteDefaultBranchSha: "abc1234567890",
    workingTreeClean: true,
    workingTreeStatusLineCount: 0,
    configuredRemoteUrls: ["https://github.com/Ayush1298567/SEEKR.git"],
    remoteRefCount: 1,
    blockedCheckCount: 0,
    warningCheckCount: 0,
    checks: [
      { id: "repository-reference", status: "pass", details: "Package metadata or README names the repository.", evidence: ["package.json", "README.md"] },
      { id: "github-landing-readme", status: "pass", details: "GitHub landing README has a fresh clone path.", evidence: ["../README.md", "github-landing-readme-command-order", "github-landing-readme-ai-readiness-proof"] },
      { id: "local-git-metadata", status: "pass", details: "Local Git metadata is present.", evidence: ["../.git"] },
      { id: "configured-github-remote", status: "pass", details: "Origin points at GitHub.", evidence: ["https://github.com/Ayush1298567/SEEKR.git"] },
      { id: "github-remote-refs", status: "pass", details: "GitHub remote has a default branch.", evidence: ["main"] },
      {
        id: "fresh-clone-smoke",
        status: "pass",
        details: "Fresh clone contract passed.",
        evidence: [
          "https://github.com/Ayush1298567/SEEKR",
          "git clone --depth 1",
          "npm ci --dry-run --ignore-scripts --no-audit --fund=false --prefer-offline",
          "fresh-clone-github-landing-readme-contract",
          "fresh-clone-operator-quickstart-contract",
          "fresh-clone:README.md",
          "fresh-clone:software/package.json",
          "fresh-clone:software/package-lock.json",
          "fresh-clone:software/.env.example",
          "fresh-clone:software/scripts/local-ai-prepare.ts",
          "fresh-clone:software/scripts/rehearsal-start.sh",
          "fresh-clone:software/docs/OPERATOR_QUICKSTART.md"
        ]
      },
      { id: "local-head-published", status: "pass", details: "Local HEAD matches GitHub default branch.", evidence: ["abc1234567890"] },
      { id: "working-tree-clean", status: "pass", details: "Worktree is clean.", evidence: ["git status --short"] }
    ],
    nextActionChecklist: [
      { id: "verify-source-control-before-bundle", status: "verification", details: "Rerun the read-only audit before final bundling.", commands: ["npm run audit:source-control"], clearsCheckIds: ["repository-reference", "github-landing-readme", "local-git-metadata", "configured-github-remote", "github-remote-refs", "fresh-clone-smoke", "local-head-published", "working-tree-clean"] }
    ],
    limitations: [
      "This audit is read-only and does not initialize Git, commit files, push branches, or change GitHub settings.",
      "Source-control handoff status is separate from aircraft hardware readiness.",
      "Real command upload and hardware actuation remain disabled."
    ]
  }), "utf8");
  await writeFile(path.join(root, plugAndPlaySetupPath), JSON.stringify({
    ok: true,
    status: "ready-local-setup",
    commandUploadEnabled: false,
    envFilePath: ".env",
    dataDirPath: ".tmp/rehearsal-data",
    checks: [
      { id: "env-example", status: "pass" },
      { id: "env-file", status: "pass" },
      { id: "rehearsal-data-dir", status: "pass" },
      { id: "safety-boundary", status: "pass" }
    ]
  }), "utf8");
  await writeFile(path.join(root, localAiPreparePath), JSON.stringify({
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    ok: true,
    status: "ready-local-ai-model",
    commandUploadEnabled: false,
    provider: "ollama",
    model: "llama3.2:latest",
    pullModel: "llama3.2",
    pullAttempted: true,
    prepareCommand: ["ollama", "pull", "llama3.2"],
    checks: [
      {
        id: "ollama-model-prep",
        status: "pass",
        details: "ollama pull llama3.2 completed successfully.",
        evidence: ["package.json scripts.ai:prepare", "ollama pull llama3.2"]
      }
    ],
    nextCommands: ["npm run doctor", "npm run test:ai:local", "npm run rehearsal:start"],
    limitations: ["Real command upload and hardware actuation remain disabled."]
  }), "utf8");
  await writeFile(path.join(root, plugAndPlayDoctorPath), JSON.stringify({
    ok: true,
    status: "ready-local-start",
    commandUploadEnabled: false,
    ai: { provider: "ollama", model: "llama3.2:latest", status: "pass" },
    ports: { api: 8787, client: 5173 },
    summary: { pass: 10, warn: 0, fail: 0 },
    checks: [
      { id: "package-scripts", status: "pass" },
      { id: "runtime-dependencies", status: "pass" },
      { id: "repository-safety", status: "pass" },
      { id: "source-control-handoff", status: "pass", evidence: [sourceControlPath] },
      { id: "operator-start", status: "pass" },
      { id: "operator-env", status: "pass" },
      { id: "local-ai", status: "pass" },
      {
        id: "local-ports",
        status: "pass",
        details: "Default port(s) already in use on 127.0.0.1 by a non-SEEKR or unhealthy listener: client 5173. Listener diagnostics: client 5173 -> node pid 12345 cwd ~/Ayush/Prophet/prophet-console. npm run rehearsal:start auto-selects free local API/client ports when no explicit port variables are set.",
        evidence: [
          "scripts/rehearsal-start.sh auto-selected free local API/client ports",
          "lsof -nP -iTCP:5173 -sTCP:LISTEN",
          "listener 12345 cwd ~/Ayush/Prophet/prophet-console"
        ]
      },
      { id: "data-dir", status: "pass" },
      { id: "safety-boundary", status: "pass" }
    ]
  }), "utf8");
  await writeFile(path.join(root, rehearsalStartSmokePath), JSON.stringify({
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    ok: true,
    status: "pass",
    commandUploadEnabled: false,
    command: "npm run rehearsal:start",
    apiPort: 8787,
    clientPort: 5173,
    dataDirPath: ".tmp/rehearsal-start-smoke/run-test/data",
    plugAndPlaySetupPath: ".tmp/plug-and-play-setup/seekr-local-setup-test.json",
    localAiPreparePath: ".tmp/local-ai-prepare/seekr-local-ai-prepare-test.json",
    sourceControlHandoffPath: ".tmp/source-control-handoff/seekr-source-control-handoff-test.json",
    plugAndPlayDoctorPath: ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-smoke-test.json",
    checked: [...REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS],
    checks: REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS.map((id) => ({
      id,
      status: "pass",
      details: `${id} passed.`,
      evidence: [id]
    })),
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    }
  }), "utf8");
  await writeFile(path.join(root, freshCloneSmokePath), JSON.stringify({
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    ok: true,
    status: "pass",
    commandUploadEnabled: false,
    repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    cloneCommand: ["git", "clone", "--depth", "1", "https://github.com/Ayush1298567/SEEKR"],
    installCommand: ["npm", "ci", "--ignore-scripts", "--no-audit", "--fund=false", "--prefer-offline"],
    localHeadSha: "abc1234567890",
    cloneHeadSha: "abc1234567890",
    plugAndPlaySetupPath,
    localAiPreparePath,
    localAiPrepareModel: "llama3.2:latest",
    sourceControlHandoffPath: sourceControlPath,
    sourceControlHandoffStatus: "ready-source-control-handoff",
    sourceControlHandoffReady: true,
    sourceControlHandoffLocalHeadSha: "abc1234567890",
    sourceControlHandoffRemoteDefaultBranchSha: "abc1234567890",
    plugAndPlayDoctorPath,
    plugAndPlayDoctorStatus: "ready-local-start",
    rehearsalStartSmokePath,
    rehearsalStartSmokeStatus: "pass",
    checked: [...REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS],
    checks: REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS.map((id) => ({
      id,
      status: "pass",
      details: `${id} passed.`,
      evidence: [id]
    })),
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    }
  }), "utf8");
}

async function writePackageJson(root: string) {
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      check: "npm run typecheck && npm run test",
      typecheck: "tsc --noEmit",
      test: "vitest run",
      build: "vite build",
      preview: "vite preview",
      server: "tsx watch src/server/index.ts",
      client: "vite --host 127.0.0.1",
      dev: "concurrently -k -n server,client -c cyan,green \"npm:server\" \"npm:client\"",
      acceptance: "npm run check",
      "setup:local": "tsx scripts/local-setup.ts",
      "ai:prepare": "tsx scripts/local-ai-prepare.ts",
      doctor: "tsx scripts/plug-and-play-doctor.ts",
      "rehearsal:start": "bash scripts/rehearsal-start.sh",
      "smoke:rehearsal:start": "tsx scripts/rehearsal-start-smoke.ts",
      "bridge:mavlink": "tsx scripts/bridge-mavlink-readonly.ts",
      "bridge:mavlink:serial": "tsx scripts/bridge-mavlink-serial-readonly.ts",
      "bridge:ros2": "tsx scripts/bridge-ros2-readonly.ts",
      "bridge:ros2:live": "tsx scripts/bridge-ros2-live-readonly.ts",
      "bridge:spatial": "tsx scripts/bridge-spatial-readonly.ts",
      "bench:edge": "tsx scripts/edge-bench.ts",
      "bench:flight": "tsx scripts/flight-bench.ts",
      "bench:sitl": "tsx scripts/sitl-bench.ts",
      "bench:sitl:io": "tsx scripts/sitl-process-io.ts",
      "bench:dimos": "tsx scripts/dimos-readonly-bench.ts",
      "safety:command-boundary": "tsx scripts/command-boundary-scan.ts",
      "test:ai:local": "tsx scripts/ai-smoke.ts --require-ollama",
      "test:ui": "playwright test",
      "qa:gstack": "tsx scripts/gstack-browser-qa.ts",
      "health:gstack": "tsx scripts/gstack-health-history.ts",
      "smoke:preview": "npm run build && npm run probe:preview",
      "probe:preview": "tsx scripts/preview-smoke.ts",
      "release:checksum": "tsx scripts/release-checksums.ts",
      "acceptance:record": "tsx scripts/acceptance-record.ts",
      "probe:api": "tsx scripts/api-probe.ts",
      "probe:hardware": "tsx scripts/hardware-probe.ts",
      "probe:hardware:archive": "tsx scripts/archive-hardware-probe.ts",
      "rehearsal:evidence": "tsx scripts/rehearsal-evidence.ts",
      "rehearsal:note": "tsx scripts/rehearsal-note.ts",
      "rehearsal:closeout": "tsx scripts/rehearsal-closeout.ts",
      "hil:failsafe:evidence": "tsx scripts/hil-failsafe-evidence.ts",
      "isaac:hil:evidence": "tsx scripts/isaac-hil-capture-evidence.ts",
      "policy:hardware:gate": "tsx scripts/hardware-actuation-policy-gate.ts",
      "audit:completion": "tsx scripts/completion-audit.ts",
      "demo:package": "tsx scripts/demo-readiness-package.ts",
      "bench:evidence:packet": "tsx scripts/bench-evidence-packet.ts",
      "handoff:index": "tsx scripts/handoff-index.ts",
      "handoff:verify": "tsx scripts/handoff-verify.ts",
      "handoff:bundle": "tsx scripts/handoff-bundle.ts",
      "handoff:bundle:verify": "tsx scripts/handoff-bundle-verify.ts",
      "audit:gstack": "tsx scripts/gstack-workflow-status.ts",
      "audit:source-control": "tsx scripts/source-control-handoff.ts",
      "audit:todo": "tsx scripts/todo-audit.ts",
      "audit:plug-and-play": "tsx scripts/plug-and-play-readiness.ts",
      "audit:goal": "tsx scripts/goal-audit.ts",
      overnight: "bash scripts/overnight-loop.sh"
    }
  }), "utf8");
}

async function writeTodoDocs(root: string, completed = false) {
  const box = completed ? "x" : " ";
  await writeFile(path.join(root, "docs/SEEKR_GCS_ALPHA_TODO.md"), [
    "# SEEKR GCS Internal Alpha Todo",
    "",
    "## Drone Integration Prerequisites",
    "",
    `- [${box}] Run hardware readiness probe on an actual Jetson Orin Nano.`,
    `- [${box}] Run hardware readiness probe on an actual Raspberry Pi 5.`,
    `- [${box}] Add HIL bench logs for failsafe behavior with manual override evidence.`,
    `- [${box}] Add reviewed hardware-actuation policy file for a specific bench vehicle before any real command enablement.`,
    `- [${box}] Connect read-only MAVLink bridge to a real serial/UDP telemetry source on bench hardware.`,
    `- [${box}] Connect read-only ROS 2 bridge to real \`/map\`, pose, detection, LiDAR, and costmap topics on bench hardware.`,
    `- [${box}] Add Isaac Sim HIL fixture capture from Jetson bench run.`,
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "docs/SEEKR_COMPLETION_PLAN.md"), [
    "# SEEKR Completion Plan",
    "",
    "## Customer View",
    "",
    `- [${box}] Field-laptop runbook is rehearsed by a fresh operator.`,
    ""
  ].join("\n"), "utf8");
}

async function seedCompletedTodoDocs(root: string) {
  await writeTodoDocs(root, true);
}

async function writeJetsonCompletedTodoDocs(root: string) {
  await writeFile(path.join(root, "docs/SEEKR_GCS_ALPHA_TODO.md"), [
    "# SEEKR GCS Internal Alpha Todo",
    "",
    "## Drone Integration Prerequisites",
    "",
    "- [x] Run hardware readiness probe on an actual Jetson Orin Nano.",
    "- [ ] Run hardware readiness probe on an actual Raspberry Pi 5.",
    "- [ ] Add HIL bench logs for failsafe behavior with manual override evidence.",
    "- [ ] Add reviewed hardware-actuation policy file for a specific bench vehicle before any real command enablement.",
    "- [ ] Connect read-only MAVLink bridge to a real serial/UDP telemetry source on bench hardware.",
    "- [ ] Connect read-only ROS 2 bridge to real `/map`, pose, detection, LiDAR, and costmap topics on bench hardware.",
    "- [ ] Add Isaac Sim HIL fixture capture from Jetson bench run.",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "docs/SEEKR_COMPLETION_PLAN.md"), [
    "# SEEKR Completion Plan",
    "",
    "## Customer View",
    "",
    "- [ ] Field-laptop runbook is rehearsed by a fresh operator.",
    ""
  ].join("\n"), "utf8");
}

async function writeCompletionAuditArtifact(root: string) {
  const completionAudit = await buildCompletionAudit({
    root,
    generatedAt: GENERATED_AT
  });
  await writeFile(path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json"), JSON.stringify(completionAudit), "utf8");
  return completionAudit;
}

async function writePlugAndPlayReadinessArtifact(root: string, complete: boolean) {
  const completionAudit = await buildCompletionAudit({
    root,
    generatedAt: GENERATED_AT
  });
  const remainingRealWorldBlockerIds = complete ? [] : completionAudit.realWorldBlockerIds;
  const remainingRealWorldBlockers = complete ? [] : completionAudit.realWorldBlockers;
  await writeFile(path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json"), JSON.stringify({
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    status: complete ? "complete" : "ready-local-plug-and-play-real-world-blocked",
    localPlugAndPlayOk: true,
    complete,
    commandUploadEnabled: false,
    ai: {
      implemented: true,
      provider: "ollama",
      model: "llama3.2:latest",
      ollamaUrl: "http://127.0.0.1:11434",
      caseCount: REQUIRED_STRICT_AI_SMOKE_CASES.length,
      caseNames: [...REQUIRED_STRICT_AI_SMOKE_CASES]
    },
    sourceControl: {
      path: ".tmp/source-control-handoff/seekr-source-control-handoff-test.json",
      generatedAt: GENERATED_AT,
      status: "ready-source-control-handoff",
      ready: true,
      repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
      packageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
      configuredRemoteUrls: ["https://github.com/Ayush1298567/SEEKR.git"],
      localBranch: "main",
      remoteDefaultBranch: "main",
      remoteRefCount: 1,
      blockedCheckCount: 0,
      warningCheckCount: 0,
      localHeadSha: "abc1234567890",
      remoteDefaultBranchSha: "abc1234567890",
      workingTreeClean: true,
      workingTreeStatusLineCount: 0
    },
    operatorStartPorts: {
      path: ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json",
      status: "pass",
      api: 8787,
      client: 5173,
      defaultPortsOccupied: true,
      autoRecoverable: true,
      listenerDiagnostics: ["listener 12345 cwd ~/Ayush/Prophet/prophet-console"],
      details: "Default port(s) already in use on 127.0.0.1 by a non-SEEKR or unhealthy listener: client 5173. Listener diagnostics: client 5173 -> node pid 12345 cwd ~/Ayush/Prophet/prophet-console. npm run rehearsal:start auto-selects free local API/client ports when no explicit port variables are set."
    },
    freshClone: {
      path: ".tmp/fresh-clone-smoke/seekr-fresh-clone-smoke-test.json",
      status: "pass",
      repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
      localHeadSha: "abc1234567890",
      cloneHeadSha: "abc1234567890",
      localAiPrepareModel: "llama3.2:latest",
      sourceControlHandoffStatus: "ready-source-control-handoff",
      sourceControlHandoffReady: true,
      plugAndPlayDoctorStatus: "ready-local-start",
      rehearsalStartSmokeStatus: "pass",
      checked: [...REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS]
    },
    reviewBundle: {
      path: ".tmp/handoff-bundles/seekr-handoff-bundle-internal-alpha-test.json",
      verificationPath: ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json",
      status: "pass",
      checkedFileCount: 12,
      secretScanStatus: "pass",
      sourceControlHandoffPath: ".tmp/source-control-handoff/seekr-source-control-handoff-test.json",
      sourceControlHandoffRepositoryUrl: "https://github.com/Ayush1298567/SEEKR",
      sourceControlHandoffPackageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
      sourceControlHandoffConfiguredRemoteUrls: ["https://github.com/Ayush1298567/SEEKR.git"],
      sourceControlHandoffLocalBranch: "main",
      sourceControlHandoffRemoteDefaultBranch: "main",
      sourceControlHandoffRemoteRefCount: 1,
      sourceControlHandoffBlockedCheckCount: 0,
      sourceControlHandoffWarningCheckCount: 0,
      sourceControlHandoffLocalHeadSha: "abc1234567890",
      sourceControlHandoffRemoteDefaultBranchSha: "abc1234567890",
      sourceControlHandoffWorkingTreeClean: true,
      sourceControlHandoffWorkingTreeStatusLineCount: 0
    },
    remainingRealWorldBlockerIds,
    remainingRealWorldBlockers,
    remainingRealWorldBlockerCount: remainingRealWorldBlockers.length,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    checks: [
      {
        id: "api-readback",
        status: "pass",
        details: "api ready",
        evidence: [".tmp/api-probe/seekr-api-probe-test.json"]
      },
      {
        id: "operator-setup",
        status: "pass",
        details: "setup ready",
        evidence: [".tmp/plug-and-play-setup/seekr-local-setup-test.json"]
      },
      {
        id: "operator-doctor",
        status: "pass",
        details: "doctor ready",
        evidence: [".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"]
      },
      {
        id: "operator-start-smoke",
        status: "pass",
        details: "rehearsal start smoke ready",
        evidence: [".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json"]
      },
      {
        id: "fresh-clone-operator-smoke",
        status: "pass",
        details: "fresh clone ready",
        evidence: [".tmp/fresh-clone-smoke/seekr-fresh-clone-smoke-test.json"]
      },
      {
        id: "workflow-qa",
        status: "pass",
        details: "workflow and QA ready",
        evidence: [
          ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json",
          ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md"
        ]
      },
      {
        id: "review-bundle",
        status: "pass",
        details: "review bundle ready",
        evidence: [
          ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json",
          ".tmp/handoff-bundles/seekr-handoff-bundle-internal-alpha-test.json",
          ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json",
          ".tmp/todo-audit/seekr-todo-audit-2026-05-09T21-00-00-000Z.json",
          ".tmp/source-control-handoff/seekr-source-control-handoff-test.json",
          ".tmp/plug-and-play-setup/seekr-local-setup-test.json",
          ".tmp/local-ai-prepare/seekr-local-ai-prepare-test.json",
          ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json",
          ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json",
          "docs/OPERATOR_QUICKSTART.md"
        ]
      }
    ]
  }), "utf8");
}

async function seedCompletedRealWorldEvidence(root: string) {
  await mkdir(path.join(root, ".tmp/rehearsal-notes"), { recursive: true });
  await mkdir(path.join(root, ".tmp/bridge-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/hil-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/isaac-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/policy-candidates"), { recursive: true });
  await mkdir(path.join(root, ".tmp/policy-evidence"), { recursive: true });

  await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-actual-target.json"), JSON.stringify({
    commandUploadEnabled: false,
    actualHardwareValidationComplete: true,
    hardwareValidationScope: "actual-target",
    actualTargetHostValidated: {
      "jetson-orin-nano": true,
      "raspberry-pi-5": true
    },
    reports: [
      hardwareReport("jetson-orin-nano", "pass"),
      hardwareReport("raspberry-pi-5", "pass")
    ]
  }), "utf8");

  await writeFile(path.join(root, ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-real-sources.json"), JSON.stringify({
    commandUploadEnabled: false,
    validation: { ok: true },
    sourceEvidence: {
      matched: [
        matchedSource("mavlink", ["telemetry"], 8),
        matchedSource("ros2-slam", ["map", "costmap"], 4),
        matchedSource("ros2-pose", ["telemetry"], 4),
        matchedSource("ros2-perception", ["detection", "perception"], 4),
        matchedSource("lidar-slam", ["lidar", "spatial", "slam"], 4),
        matchedSource("isaac-nvblox", ["costmap", "perception"], 4),
        matchedSource("isaac-sim-hil", ["spatial", "lidar"], 2)
      ]
    }
  }), "utf8");

  await writeFile(path.join(root, ".tmp/rehearsal-notes/seekr-rehearsal-closeout-complete.json"), JSON.stringify({
    status: "completed",
    freshOperatorCompleted: true,
    commandUploadEnabled: false,
    operatorFields: {
      operatorName: "Field Operator",
      machineIdentifier: "field-laptop-1",
      setupStartedAt: "2026-05-09T18:00:00Z",
      acceptanceCompletedAt: "2026-05-09T18:30:00Z",
      missionExportCompletedAt: "2026-05-09T18:45:00Z",
      replayId: "replay-real-1",
      finalStateHash: "f".repeat(64),
      shutdownCompletedAt: "2026-05-09T19:00:00Z",
      deviationsOrFailures: "none"
    },
    validation: { ok: true }
  }), "utf8");

  await writeFile(path.join(root, ".tmp/bridge-evidence/seekr-bridge-evidence-mavlink-serial.json"), JSON.stringify(
    bridgeEvidence("mavlink-serial-readonly", { serialWriteOpened: false })
  ), "utf8");
  await writeFile(path.join(root, ".tmp/bridge-evidence/seekr-bridge-evidence-ros2-live.json"), JSON.stringify(
    bridgeEvidence("ros2-live-readonly", { ros2ServicesTouched: false, ros2ActionsTouched: false })
  ), "utf8");

  await writeFile(path.join(root, ".tmp/hil-evidence/flight.log"), "link-loss failsafe triggered; manual override observed; estop verified\n", "utf8");
  await writeFile(path.join(root, ".tmp/hil-evidence/seekr-hil-failsafe-complete.json"), JSON.stringify(hilEvidenceManifest()), "utf8");
  await writeFile(path.join(root, ".tmp/hil-evidence/completed.json"), JSON.stringify(hilEvidenceManifest()), "utf8");

  await writeFile(path.join(root, ".tmp/isaac-evidence/capture.json"), JSON.stringify({
    source: "isaac-sim-hil",
    pipeline: "isaac-ros-nvblox",
    commandUploadEnabled: false,
    counts: { telemetry: 1, costmap: 1, detection: 1, pointCloud: 1 }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/isaac-evidence/capture.log"), "captured isaac sim sensor frames into Jetson read-only bridge\n", "utf8");
  await writeFile(path.join(root, ".tmp/isaac-evidence/seekr-isaac-hil-capture-complete.json"), JSON.stringify({
    status: "completed",
    commandUploadEnabled: false,
    run: {
      operatorName: "Field Operator",
      targetHardware: "jetson-orin-nano",
      isaacSimHost: "sim-host-1",
      isaacSimVersion: "4.2",
      isaacRosVersion: "3.x",
      sensorSuite: "rgb-depth-lidar",
      captureStartedAt: "2026-05-09T20:00:00Z",
      captureEndedAt: "2026-05-09T20:05:00Z",
      captureResult: "captured telemetry, costmap, detections, and point cloud",
      deviationsOrFailures: "none"
    },
    evidence: {
      hardwareEvidencePath: ".tmp/hardware-evidence/seekr-hardware-evidence-actual-target.json",
      rehearsalEvidencePath: ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-real-sources.json",
      captureManifestPath: ".tmp/isaac-evidence/capture.json",
      captureLogPath: ".tmp/isaac-evidence/capture.log"
    },
    validation: { ok: true }
  }), "utf8");

  await writeFile(path.join(root, ".tmp/policy-candidates/deny-default.json"), JSON.stringify({
    schemaVersion: 1,
    policyKind: "seekr-hardware-actuation-review",
    targetHardware: "jetson-orin-nano",
    vehicleIdentifier: "bench-quad-1",
    commandUploadEnabled: false,
    realAircraftCommandUploadAuthorized: false,
    hardwareActuationEnabled: false,
    runtimeInstallApproved: false,
    manualOverrideRequired: true,
    estopRequired: true,
    approvedCommandClasses: [],
    authorizedCommandClasses: [],
    allowedHardwareCommands: [],
    enabledHardwareCommands: [],
    missionUploadCommandClasses: []
  }), "utf8");
  await writeFile(path.join(root, ".tmp/policy-evidence/seekr-hardware-actuation-gate-complete.json"), JSON.stringify({
    status: "ready-for-human-review",
    commandUploadEnabled: false,
    scope: {
      operatorName: "Safety Operator",
      targetHardware: "jetson-orin-nano",
      vehicleIdentifier: "bench-quad-1",
      reviewers: ["Safety Lead", "Test Director"],
      reviewedAt: "2026-05-09T20:00:00Z"
    },
    authorization: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    evidence: {
      candidatePolicyPath: ".tmp/policy-candidates/deny-default.json",
      acceptanceStatusPath: ".tmp/acceptance-status.json",
      hardwareEvidencePath: ".tmp/hardware-evidence/seekr-hardware-evidence-actual-target.json",
      hilEvidencePath: ".tmp/hil-evidence/completed.json"
    },
    validation: { ok: true }
  }), "utf8");
}

async function seedCompletedHandoffArtifacts(root: string) {
  await writePlugAndPlayReadinessArtifact(root, true);
  await writeFile(path.join(root, ".tmp/demo-readiness/seekr-demo-readiness-internal-alpha-test.json"), JSON.stringify({
    localAlphaOk: true,
    complete: true,
    commandUploadEnabled: false,
    artifacts: {
      acceptanceStatusPath: ".tmp/acceptance-status.json",
      releaseEvidenceJsonPath: ".tmp/release-evidence/seekr-release-test.json",
      safetyScanJsonPath: ".tmp/safety-evidence/seekr-command-boundary-scan-test.json",
      apiProbeJsonPath: ".tmp/api-probe/seekr-api-probe-test.json",
      completionAuditJsonPath: ".tmp/completion-audit/seekr-completion-audit-test.json",
      hardwareEvidenceJsonPath: ".tmp/hardware-evidence/seekr-hardware-evidence-actual-target.json",
      overnightStatusPath: ".tmp/overnight/STATUS.md"
    },
    validation: { ok: true, warnings: [], blockers: [] },
    perspectiveReview: [
      { id: "operator", status: "ready-local-alpha" },
      { id: "safety", status: "ready-local-alpha" },
      { id: "dx", status: "ready-local-alpha" },
      { id: "replay", status: "ready-local-alpha" },
      { id: "demo-readiness", status: "ready-local-alpha" }
    ],
    realWorldBlockers: [],
    nextEvidenceChecklist: []
  }), "utf8");
  await writeFile(path.join(root, ".tmp/bench-evidence-packet/seekr-bench-evidence-packet-jetson-bench-test.json"), JSON.stringify({
    localAlphaOk: true,
    complete: true,
    commandUploadEnabled: false,
    sourceDemoReadinessPackagePath: ".tmp/demo-readiness/seekr-demo-readiness-internal-alpha-test.json",
    validation: { ok: true, warnings: [], blockers: [] },
    tasks: []
  }), "utf8");
  await writeFile(path.join(root, ".tmp/handoff-index/seekr-handoff-index-internal-alpha-test.json"), JSON.stringify({
    localAlphaOk: true,
    complete: true,
    commandUploadEnabled: false,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    hardwareClaims: {
      jetsonOrinNanoValidated: false,
      raspberryPi5Validated: false,
      realMavlinkBenchValidated: false,
      realRos2BenchValidated: false,
      hilFailsafeValidated: false,
      isaacJetsonCaptureValidated: false,
      hardwareActuationAuthorized: false
    },
    validation: { ok: true, warnings: [], blockers: [] },
    artifactDigests: [],
    realWorldBlockers: []
  }), "utf8");
  await writeFile(path.join(root, ".tmp/handoff-bundles/seekr-handoff-bundle-internal-alpha-test.json"), JSON.stringify({
    status: "ready-local-alpha-review-bundle",
    commandUploadEnabled: false,
    sourceIndexPath: ".tmp/handoff-index/seekr-handoff-index-internal-alpha-test.json",
    sourceIndexComplete: true,
    gstackWorkflowStatusPath: ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json",
    gstackWorkflowStatus: "pass-with-limitations",
    gstackQaReportPath: ".gstack/qa-reports/seekr-qa-2026-05-09T20-55-00Z.md",
    gstackQaReportStatus: "pass",
    gstackQaScreenshotPaths: [
      ".gstack/qa-reports/screenshots/seekr-qa-2026-05-09T20-55-00Z-clean-home.png",
      ".gstack/qa-reports/screenshots/seekr-qa-2026-05-09T20-55-00Z-clean-mobile.png"
    ],
    todoAuditPath: ".tmp/todo-audit/seekr-todo-audit-2026-05-09T21-00-00-000Z.json",
    todoAuditStatus: "pass-complete-no-blockers",
    sourceControlHandoffPath: ".tmp/source-control-handoff/seekr-source-control-handoff-test.json",
    sourceControlHandoffStatus: "ready-source-control-handoff",
    sourceControlHandoffReady: true,
    plugAndPlaySetupPath: ".tmp/plug-and-play-setup/seekr-local-setup-test.json",
    plugAndPlaySetupStatus: "ready-local-setup",
    localAiPreparePath: ".tmp/local-ai-prepare/seekr-local-ai-prepare-test.json",
    localAiPrepareStatus: "ready-local-ai-model",
    localAiPrepareModel: "llama3.2:latest",
    plugAndPlayDoctorPath: ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json",
    plugAndPlayDoctorStatus: "ready-local-start",
    rehearsalStartSmokePath: ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json",
    rehearsalStartSmokeStatus: "pass",
    strictAiSmokeStatusPath: ".tmp/ai-smoke-status.json",
    copiedFileCount: 12,
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    hardwareClaims: {
      jetsonOrinNanoValidated: false,
      raspberryPi5Validated: false,
      realMavlinkBenchValidated: false,
      realRos2BenchValidated: false,
      hilFailsafeValidated: false,
      isaacJetsonCaptureValidated: false,
      hardwareActuationAuthorized: false
    },
    realWorldBlockers: [],
    validation: { ok: true, warnings: [], blockers: [] }
  }), "utf8");
}

function hilEvidenceManifest() {
  return {
    status: "completed",
    commandUploadEnabled: false,
    run: {
      operatorName: "Safety Operator",
      targetHardware: "jetson-orin-nano",
      vehicleIdentifier: "bench-quad-1",
      autopilot: "px4",
      failsafeKind: "link-loss",
      failsafeTriggeredAt: "2026-05-09T19:30:00Z",
      manualOverrideObservedAt: "2026-05-09T19:30:10Z",
      estopVerifiedAt: "2026-05-09T19:30:20Z",
      aircraftSafeAt: "2026-05-09T19:30:40Z",
      manualOverrideResult: "operator regained authority",
      onboardFailsafeResult: "PX4 hold/land observed",
      deviationsOrFailures: "none"
    },
    evidence: {
      hardwareEvidencePath: ".tmp/hardware-evidence/seekr-hardware-evidence-actual-target.json",
      rehearsalEvidencePath: ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-real-sources.json",
      flightLogPath: ".tmp/hil-evidence/flight.log"
    },
    validation: { ok: true }
  };
}

function hardwareReport(targetId: string, hostPlatformStatus: "pass" | "warn") {
  return {
    target: { id: targetId },
    checks: [
      { id: "host-platform", status: hostPlatformStatus },
      { id: "safety-boundary", status: "pass" }
    ]
  };
}

function matchedSource(sourceAdapter: string, channels: string[], eventCount: number) {
  return {
    requirement: `${sourceAdapter}:${channels.join("+")}`,
    sourceAdapter,
    channels,
    droneIds: sourceAdapter === "mavlink" ? ["drone-1"] : [],
    eventCount,
    status: "pass"
  };
}

function bridgeEvidence(mode: string, safety: Record<string, false>) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-05-09T20:30:00.000Z",
    label: `${mode}-real`,
    bridgeMode: mode,
    status: "pass",
    commandUploadEnabled: false,
    validation: { ok: true, blockers: [], warnings: [] },
    bridgeResult: {
      ok: true,
      mode,
      dryRun: false,
      commandPreview: false,
      inputCount: 4,
      acceptedCount: 4,
      postedCount: 4,
      rejected: [],
      errors: [],
      commandEndpointsTouched: false,
      safety: {
        ...safety,
        commandUploadEnabled: false
      }
    },
    evidenceSha256: "b".repeat(64)
  };
}
