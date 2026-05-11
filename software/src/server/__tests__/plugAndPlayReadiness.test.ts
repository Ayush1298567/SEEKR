import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS } from "../../../scripts/fresh-clone-operator-smoke";
import { buildPlugAndPlayReadiness, writePlugAndPlayReadiness } from "../../../scripts/plug-and-play-readiness";
import { REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS } from "../../../scripts/rehearsal-start-smoke";
import { REQUIRED_STRICT_AI_SMOKE_CASES } from "../ai/localAiEvidence";

const GSTACK_TOOL_ROOT = "~/.gstack/repos/gstack/bin";
const GSTACK_TOOL_COUNT = 2;
const GSTACK_TOOL_NAMES = ["gstack-brain-sync", "gstack-slug"];
const GSTACK_HELPER_TOOL_EVIDENCE = `${GSTACK_TOOL_ROOT} (${GSTACK_TOOL_COUNT} gstack helper tools)`;
const GSTACK_CLI_UNAVAILABLE_LIMITATION = `gstack CLI is not available on PATH; local gstack helper tools are installed under ${GSTACK_TOOL_ROOT} (${GSTACK_TOOL_COUNT} executable helper(s)), so workflow status is recorded from installed skill/tool files and local package-script evidence instead of claiming umbrella CLI execution.`;

describe("plug-and-play readiness audit", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-plug-ready-test-${process.pid}-${Date.now()}`);
    await seedPlugAndPlayEvidence(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports local plug-and-play readiness while preserving real-world blockers", async () => {
    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      status: "ready-local-plug-and-play-real-world-blocked",
      localPlugAndPlayOk: true,
      complete: false,
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
        status: "ready-source-control-handoff",
        ready: true,
        repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
        packageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
        configuredRemoteUrls: ["git@github.com:Ayush1298567/SEEKR.git"],
        localBranch: "main",
        remoteDefaultBranch: "main",
        remoteRefCount: 1,
        blockedCheckCount: 0,
        warningCheckCount: 0,
        localHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        remoteDefaultBranchSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
        details: expect.stringContaining("auto-selects free local API/client ports")
      },
      freshClone: {
        path: ".tmp/fresh-clone-smoke/seekr-fresh-clone-smoke-test.json",
        status: "pass",
        repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
        localHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        cloneHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        localAiPrepareModel: "llama3.2:latest",
        sourceControlHandoffStatus: "ready-source-control-handoff",
        sourceControlHandoffReady: true,
        plugAndPlayDoctorStatus: "ready-local-start",
        rehearsalStartSmokeStatus: "pass",
        checked: [...REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS]
      },
      reviewBundle: {
        path: ".tmp/handoff-bundles/seekr-handoff-bundle-test.json",
        verificationPath: ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json",
        status: "pass",
        checkedFileCount: 9,
        secretScanStatus: "pass",
        sourceControlHandoffPath: ".tmp/source-control-handoff/seekr-source-control-handoff-test.json",
        sourceControlHandoffRepositoryUrl: "https://github.com/Ayush1298567/SEEKR",
        sourceControlHandoffPackageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
        sourceControlHandoffConfiguredRemoteUrls: ["git@github.com:Ayush1298567/SEEKR.git"],
        sourceControlHandoffLocalBranch: "main",
        sourceControlHandoffRemoteDefaultBranch: "main",
        sourceControlHandoffRemoteRefCount: 1,
        sourceControlHandoffBlockedCheckCount: 0,
        sourceControlHandoffWarningCheckCount: 0,
        sourceControlHandoffLocalHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceControlHandoffRemoteDefaultBranchSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceControlHandoffWorkingTreeClean: true,
        sourceControlHandoffWorkingTreeStatusLineCount: 0
      },
      safetyBoundary: {
        realAircraftCommandUpload: false,
        hardwareActuationEnabled: false,
        runtimePolicyInstalled: false
      }
    });
    expect(manifest.summary.fail).toBe(0);
    expect(manifest.summary.blocked).toBe(1);
    expect(manifest.remainingRealWorldBlockerIds).toHaveLength(8);
    expect(manifest.remainingRealWorldBlockerIds).toEqual(expect.arrayContaining([
      "actual-jetson-orin-nano-hardware-evidence",
      "actual-raspberry-pi-5-hardware-evidence"
    ]));
    expect(manifest.remainingRealWorldBlockers).toHaveLength(8);
    expect(manifest.remainingRealWorldBlockerCount).toBe(8);
    expect(manifest.checks.find((check) => check.id === "real-world-boundary")).toMatchObject({
      status: "blocked"
    });
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")).toMatchObject({
      status: "pass",
      details: expect.stringContaining("published local HEAD")
    });
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")?.details).toContain("clean worktree");
  });

  it("fails when review bundle source-control summary drifts from the latest source-control artifact", async () => {
    const verificationPath = path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json");
    const verification = JSON.parse(await readFile(verificationPath, "utf8"));
    verification.sourceControlHandoffRepositoryUrl = "https://github.com/example/not-seekr";
    verification.sourceControlHandoffLocalBranch = "release";
    verification.sourceControlHandoffRemoteDefaultBranch = "release";
    verification.sourceControlHandoffBlockedCheckCount = 99;
    verification.sourceControlHandoffWarningCheckCount = 99;
    verification.sourceControlHandoffWorkingTreeClean = false;
    await writeFile(verificationPath, JSON.stringify(verification), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.reviewBundle.sourceControlHandoffWorkingTreeClean).toBe(false);
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("repository URL summary must match")
    });
    expect(manifest.checks.find((check) => check.id === "review-bundle")?.details).toContain("blocked-check summary must match");
    expect(manifest.checks.find((check) => check.id === "review-bundle")?.details).toContain("warning-check summary must match");
  });

  it("fails when the fresh-clone operator smoke proof is missing", async () => {
    await rm(path.join(root, ".tmp/fresh-clone-smoke"), { recursive: true, force: true });

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "fresh-clone-operator-smoke")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("fresh-clone operator smoke artifact")
    });
  });

  it("fails closed when completion audit is not complete even if the blocker list is empty", async () => {
    const completionPath = path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.complete = false;
    completion.realWorldBlockers = [];
    await writeFile(completionPath, JSON.stringify(completion), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.complete).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "real-world-boundary")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("must explicitly report complete")
    });
  });

  it("fails closed when completion audit claims complete while blockers remain", async () => {
    const completionPath = path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.complete = true;
    await writeFile(completionPath, JSON.stringify(completion), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.complete).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "real-world-boundary")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("cannot report complete while real-world blockers remain")
    });
  });

  it("fails closed when completion audit under-reports blocked item details", async () => {
    const completionPath = path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.realWorldBlockers = completion.realWorldBlockers.slice(1);
    await writeFile(completionPath, JSON.stringify(completion), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.remainingRealWorldBlockerCount).toBe(7);
    expect(manifest.checks.find((check) => check.id === "real-world-boundary")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("realWorldBlockers must exactly mirror blocked item details")
    });
  });

  it("fails closed when completion audit under-reports blocked item IDs", async () => {
    const completionPath = path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.realWorldBlockerIds = completion.realWorldBlockerIds.slice(1);
    await writeFile(completionPath, JSON.stringify(completion), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "real-world-boundary")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("realWorldBlockerIds must exactly mirror blocked item IDs")
    });
  });

  it("fails when the API probe readback does not match acceptance evidence", async () => {
    const apiProbePath = path.join(root, ".tmp/api-probe/seekr-api-probe-test.json");
    const apiProbe = JSON.parse(await readFile(apiProbePath, "utf8"));
    apiProbe.sessionAcceptance.releaseChecksum.overallSha256 = "b".repeat(64);
    await writeFile(apiProbePath, JSON.stringify(apiProbe), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "api-readback")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("probe release checksum summary does not match acceptance status")
    });
  });

  it("fails when the API probe AI readback does not match acceptance evidence", async () => {
    const apiProbePath = path.join(root, ".tmp/api-probe/seekr-api-probe-test.json");
    const apiProbe = JSON.parse(await readFile(apiProbePath, "utf8"));
    apiProbe.sessionAcceptance.strictLocalAi.model = "stale-model:latest";
    await writeFile(apiProbePath, JSON.stringify(apiProbe), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "api-readback")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("probe strict local AI summary does not match acceptance status")
    });
  });

  it("fails when strict local AI evidence is not implemented", async () => {
    await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
      ok: true,
      generatedAt: Date.parse("2026-05-10T07:00:00.000Z"),
      commandUploadEnabled: false,
      strictLocalAi: { ok: false, provider: "rules", model: "deterministic-v1", caseCount: 0, caseNames: [] },
      releaseChecksum: {
        jsonPath: ".tmp/release-evidence/seekr-release-test.json",
        overallSha256: "a".repeat(64),
        fileCount: 10,
        totalBytes: 1000
      },
      commandBoundaryScan: {
        jsonPath: ".tmp/safety-evidence/seekr-command-boundary-scan-test.json",
        markdownPath: ".tmp/safety-evidence/seekr-command-boundary-scan-test.md",
        status: "pass",
        scannedFileCount: 126,
        violationCount: 0,
        allowedFindingCount: 36,
        commandUploadEnabled: false
      }
    }), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.ai.implemented).toBe(false);
    expect(manifest.checks.find((check) => check.id === "acceptance-ai")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("strict local AI evidence must pass")
    });
  });

  it("fails when strict local AI evidence points at a non-loopback Ollama URL", async () => {
    const acceptancePath = path.join(root, ".tmp/acceptance-status.json");
    const apiProbePath = path.join(root, ".tmp/api-probe/seekr-api-probe-test.json");
    const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
    const apiProbe = JSON.parse(await readFile(apiProbePath, "utf8"));
    acceptance.strictLocalAi.ollamaUrl = "https://api.example.com:11434";
    apiProbe.sessionAcceptance.strictLocalAi.ollamaUrl = acceptance.strictLocalAi.ollamaUrl;
    await writeFile(acceptancePath, JSON.stringify(acceptance), "utf8");
    await writeFile(apiProbePath, JSON.stringify(apiProbe), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "acceptance-ai")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("loopback Ollama URL")
    });
  });

  it("fails when local AI prepare evidence does not match the acceptance strict AI model", async () => {
    const preparePath = path.join(root, ".tmp/local-ai-prepare/seekr-local-ai-prepare-test.json");
    const prepare = JSON.parse(await readFile(preparePath, "utf8"));
    prepare.model = "mistral:latest";
    prepare.pullModel = "mistral:latest";
    prepare.prepareCommand = ["ollama", "pull", "mistral:latest"];
    prepare.checks[0].details = "ollama pull mistral:latest completed successfully.";
    prepare.checks[0].evidence = ["package.json scripts.ai:prepare", "ollama pull mistral:latest"];
    await writeFile(preparePath, JSON.stringify(prepare), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "local-ai-prepare")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("acceptance strict local AI model")
    });
  });

  it("fails when strict local AI scenario names are incomplete", async () => {
    const acceptancePath = path.join(root, ".tmp/acceptance-status.json");
    const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
    acceptance.strictLocalAi.caseNames = REQUIRED_STRICT_AI_SMOKE_CASES.filter((name) => name !== "prompt-injection-spatial-metadata");
    await writeFile(acceptancePath, JSON.stringify(acceptance), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "acceptance-ai")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("prompt-injection-spatial-metadata")
    });
  });

  it("fails when strict local AI scenario names include untracked extras", async () => {
    const acceptancePath = path.join(root, ".tmp/acceptance-status.json");
    const apiProbePath = path.join(root, ".tmp/api-probe/seekr-api-probe-test.json");
    const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
    const apiProbe = JSON.parse(await readFile(apiProbePath, "utf8"));
    acceptance.strictLocalAi.caseNames = [...REQUIRED_STRICT_AI_SMOKE_CASES, "untracked-extra-ai-scenario"];
    acceptance.strictLocalAi.caseCount = acceptance.strictLocalAi.caseNames.length;
    apiProbe.sessionAcceptance.strictLocalAi.caseNames = acceptance.strictLocalAi.caseNames;
    apiProbe.sessionAcceptance.strictLocalAi.caseCount = acceptance.strictLocalAi.caseCount;
    await writeFile(acceptancePath, JSON.stringify(acceptance), "utf8");
    await writeFile(apiProbePath, JSON.stringify(apiProbe), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "acceptance-ai")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("untracked-extra-ai-scenario")
    });
  });

  it("fails when operator AI environment defaults are incomplete", async () => {
    await writeFile(path.join(root, ".env.example"), [
      "PORT=8787",
      "SEEKR_API_PORT=8787",
      "SEEKR_CLIENT_PORT=5173",
      "SEEKR_DATA_DIR=data",
      "SEEKR_OLLAMA_MODEL=llama3.2:latest",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-env")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("SEEKR_OLLAMA_URL=http://127.0.0.1:11434")
    });
  });

  it("fails when local env loader wiring is missing", async () => {
    await writeFile(path.join(root, "src/server/index.ts"), "console.log('server without env loader');\n", "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "env-loader")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("src/server/index.ts missing loadLocalEnv();")
    });
  });

  it("fails when the operator rehearsal start wrapper is missing expected local defaults", async () => {
    await writeFile(path.join(root, "scripts/rehearsal-start.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "exec npm run dev",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-start")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("SEEKR_EXPECTED_SOURCES")
    });
  });

  it("fails when the operator rehearsal start wrapper skips local setup", async () => {
    await writeFile(path.join(root, "scripts/rehearsal-start.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "export SEEKR_DATA_DIR=\"${SEEKR_DATA_DIR:-.tmp/rehearsal-data}\"",
      "export SEEKR_EXPECTED_SOURCES=\"${SEEKR_EXPECTED_SOURCES:-mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception}\"",
      "npm run doctor",
      "exec npm run dev",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-start")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("setup:local")
    });
  });

  it("fails when the operator rehearsal start wrapper skips the doctor preflight", async () => {
    await writeFile(path.join(root, "scripts/rehearsal-start.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "export SEEKR_DATA_DIR=\"${SEEKR_DATA_DIR:-.tmp/rehearsal-data}\"",
      "export SEEKR_EXPECTED_SOURCES=\"${SEEKR_EXPECTED_SOURCES:-mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception}\"",
      "npm run setup:local",
    "npm run ai:prepare",
      "npm run audit:source-control",
      "exec npm run dev",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "operator-start")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("must run npm run setup:local before npm run ai:prepare before npm run audit:source-control before npm run doctor before exec npm run dev")
    });
  });

  it("fails when rehearsal-start smoke evidence has not been generated", async () => {
    await rm(path.join(root, ".tmp/rehearsal-start-smoke"), { recursive: true, force: true });

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "operator-start-smoke")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("smoke artifact")
    });
  });

  it("fails when rehearsal-start smoke evidence did not pass", async () => {
    const smokePath = path.join(root, ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json");
    const smoke = JSON.parse(await readFile(smokePath, "utf8"));
    smoke.ok = false;
    smoke.status = "fail";
    smoke.checks.find((check: { id: string }) => check.id === "client-shell").status = "fail";
    await writeFile(smokePath, JSON.stringify(smoke), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "operator-start-smoke")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("status must be pass")
    });
  });

  it("fails when rehearsal-start smoke evidence has an extra check row", async () => {
    const smokePath = path.join(root, ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json");
    const smoke = JSON.parse(await readFile(smokePath, "utf8"));
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
    await writeFile(smokePath, JSON.stringify(smoke), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "operator-start-smoke")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("exactly match the required rehearsal-start smoke check IDs")
    });
  });

  it("fails when rehearsal-start smoke evidence rows are reordered", async () => {
    const smokePath = path.join(root, ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json");
    const smoke = JSON.parse(await readFile(smokePath, "utf8"));
    smoke.checked = [
      "api-health",
      "wrapper-started",
      ...REQUIRED_REHEARSAL_START_SMOKE_CHECK_IDS.slice(2)
    ];
    smoke.checks = [
      smoke.checks.find((check: { id: string }) => check.id === "api-health"),
      smoke.checks.find((check: { id: string }) => check.id === "wrapper-started"),
      ...smoke.checks.filter((check: { id: string }) => !["api-health", "wrapper-started"].includes(check.id))
    ];
    await writeFile(smokePath, JSON.stringify(smoke), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "operator-start-smoke")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("exactly match the required rehearsal-start smoke check IDs")
    });
  });

  it("fails when rehearsal-start smoke evidence drops generated prerequisite artifact pointers", async () => {
    const smokePath = path.join(root, ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json");
    const smoke = JSON.parse(await readFile(smokePath, "utf8"));
    delete smoke.localAiPreparePath;
    delete smoke.sourceControlHandoffPath;
    await writeFile(smokePath, JSON.stringify(smoke), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "operator-start-smoke")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("localAiPreparePath")
    });
  });

  it("fails when the operator quickstart omits plug-and-play setup or safety guidance", async () => {
    await writeFile(path.join(root, "docs/OPERATOR_QUICKSTART.md"), [
      "# SEEKR Operator Quickstart",
      "",
      "Open the local app and run a rehearsal.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-quickstart-doc")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("npm run setup:local")
    });
  });

  it("fails when the operator quickstart omits the source-control handoff audit step", async () => {
    await writeFile(path.join(root, "docs/OPERATOR_QUICKSTART.md"), [
      "# SEEKR Operator Quickstart",
      "",
      "## Setup",
      "",
      "```bash",
      "npm ci",
      "npm run setup:local",
    "npm run ai:prepare",
      "npm run doctor",
      "npm run rehearsal:start",
      "```",
      "",
      "Local AI uses Ollama with llama3.2:latest for advisory proposals.",
      "AI output is advisory. It can help select from validated candidate plans, but it cannot create command payloads or bypass operator validation.",
      "",
      "Inspect /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays during rehearsal.",
      "",
      "real-world blockers remain until field evidence exists.",
      "",
      "No real aircraft command upload.",
    "No hardware actuation.",
      "No AI-created command payloads.",
      "No operator answer bypassing validation.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-quickstart-doc")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("npm run audit:source-control")
    });
  });

  it("fails when the operator quickstart omits advisory AI command-safety guidance", async () => {
    await writeFile(path.join(root, "docs/OPERATOR_QUICKSTART.md"), [
      "# SEEKR Operator Quickstart",
      "",
      "## Setup",
      "",
      "```bash",
      "npm ci",
      "npm run setup:local",
    "npm run ai:prepare",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run rehearsal:start",
      "```",
      "",
      "Local AI uses Ollama with llama3.2:latest for proposals.",
      "",
      "Inspect /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays during rehearsal.",
      "",
      "real-world blockers remain until field evidence exists.",
      "",
      "No real aircraft command upload.",
    "No hardware actuation.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-quickstart-doc")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("AI output is advisory")
    });
  });

  it("fails when the operator doctor artifact has not been generated", async () => {
    await rm(path.join(root, ".tmp/plug-and-play-doctor"), { recursive: true, force: true });

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("doctor artifact")
    });
  });

  it("fails when the operator doctor source contract omits healthy occupied-port recognition", async () => {
    const scriptPath = path.join(root, "scripts/plug-and-play-doctor.ts");
    const testPath = path.join(root, "src/server/__tests__/plugAndPlayDoctor.test.ts");
    await writeFile(scriptPath, (await readFile(scriptPath, "utf8"))
      .replace("function probeOccupiedSeekrPort() { return true; }\n", "")
      .replace("const healthy = 'healthy SEEKR local instance';\n", ""), "utf8");
    await writeFile(testPath, (await readFile(testPath, "utf8"))
      .replace("it('passes when occupied local ports already serve a healthy SEEKR instance', () => {});\n", "")
      .replace("const details = 'healthy SEEKR local instance';\n", ""), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("probeOccupiedSeekrPort")
    });
    expect(manifest.checks.find((check) => check.id === "operator-doctor")?.details).toContain("healthy SEEKR local instance");
  });

  it("warns when source-control handoff evidence is not ready", async () => {
    await writeFile(path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json"), JSON.stringify({
      schemaVersion: 1,
      status: "blocked-source-control-handoff",
      ready: false,
      commandUploadEnabled: false,
      repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
      configuredRemoteUrls: [],
      remoteRefCount: 0,
      blockedCheckCount: 2,
      warningCheckCount: 4,
      checks: [
        { id: "repository-reference", status: "pass", details: "Repository reference is present." },
        { id: "github-landing-readme", status: "pass", details: "GitHub landing README has a fresh clone path.", evidence: ["../README.md", "github-landing-readme-command-order", "github-landing-readme-ai-readiness-proof"] },
        { id: "local-git-metadata", status: "blocked", details: "This workspace is not a Git worktree." },
        { id: "configured-github-remote", status: "warn", details: "No local Git metadata exists." },
        { id: "github-remote-refs", status: "blocked", details: "GitHub remote has no refs." },
        { id: "fresh-clone-smoke", status: "warn", details: "Fresh clone startup-file and npm ci dry-run coverage could not be proven while remote refs are missing." },
        { id: "local-head-published", status: "warn", details: "No local Git metadata exists, so the published commit cannot be compared to local HEAD." },
        { id: "working-tree-clean", status: "warn", details: "No local Git metadata exists, so the worktree cleanliness cannot be inspected." }
      ],
      nextActionChecklist: [
        { id: "restore-or-initialize-local-git", status: "required", details: "Restore or initialize local Git metadata.", commands: ["git init"], clearsCheckIds: ["local-git-metadata"] },
        { id: "configure-github-origin", status: "required", details: "Configure the GitHub origin remote.", commands: ["git remote add origin git@github.com:Ayush1298567/SEEKR.git"], clearsCheckIds: ["configured-github-remote"] },
        { id: "publish-reviewed-main", status: "required", details: "Publish the reviewed main branch.", commands: ["git push -u origin main"], clearsCheckIds: ["github-remote-refs"] },
        { id: "rerun-source-control-audit", status: "verification", details: "Rerun the source-control audit after publication.", commands: ["npm run audit:source-control"], clearsCheckIds: ["repository-reference", "github-landing-readme", "local-git-metadata", "configured-github-remote", "github-remote-refs", "fresh-clone-smoke", "local-head-published", "working-tree-clean"] }
      ],
      limitations: [
        "This audit is read-only and does not initialize Git, commit files, push branches, or change GitHub settings.",
        "Source-control handoff status is separate from aircraft hardware readiness.",
        "Real command upload and hardware actuation remain disabled."
      ]
    }), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(true);
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("local-git-metadata")
    });
  });

  it("warns when a ready source-control handoff could not inspect remote refs", async () => {
    const sourceControlPath = path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json");
    const sourceControl = JSON.parse(await readFile(sourceControlPath, "utf8"));
    sourceControl.status = "ready-source-control-handoff-with-warnings";
    sourceControl.remoteDefaultBranch = undefined;
    sourceControl.remoteDefaultBranchSha = undefined;
    sourceControl.remoteRefCount = 0;
    sourceControl.blockedCheckCount = 0;
    sourceControl.warningCheckCount = 3;
    sourceControl.checks = sourceControl.checks.map((check: { id: string; status: string; details: string }) =>
      ["github-remote-refs", "fresh-clone-smoke", "local-head-published"].includes(check.id)
        ? { ...check, status: "warn", details: `${check.id} could not be inspected during transient network failure.` }
        : check
    );
    sourceControl.nextActionChecklist = [
      {
        id: "rerun-source-control-audit",
        status: "verification",
        details: "Rerun the read-only audit after manual source-control recovery so the handoff can prove Git metadata, origin, and remote refs are current.",
        commands: ["npm run audit:source-control"],
        clearsCheckIds: ["repository-reference", "github-landing-readme", "local-git-metadata", "configured-github-remote", "github-remote-refs", "fresh-clone-smoke", "local-head-published", "working-tree-clean"]
      }
    ];
    await writeFile(sourceControlPath, JSON.stringify(sourceControl), "utf8");
    const verificationPath = path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json");
    const verification = JSON.parse(await readFile(verificationPath, "utf8"));
    verification.sourceControlHandoffRemoteDefaultBranch = undefined;
    verification.sourceControlHandoffRemoteDefaultBranchSha = undefined;
    verification.sourceControlHandoffRemoteRefCount = 0;
    verification.sourceControlHandoffBlockedCheckCount = 0;
    verification.sourceControlHandoffWarningCheckCount = 3;
    await writeFile(verificationPath, JSON.stringify(verification), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(true);
    expect(manifest.status).toBe("ready-local-plug-and-play-real-world-blocked");
    expect(manifest.summary.warn).toBe(1);
    expect(manifest.sourceControl).toMatchObject({
      status: "ready-source-control-handoff-with-warnings",
      remoteRefCount: 0,
      blockedCheckCount: 0,
      warningCheckCount: 3
    });
    expect(manifest.reviewBundle).toMatchObject({
      sourceControlHandoffRemoteRefCount: 0,
      sourceControlHandoffBlockedCheckCount: 0,
      sourceControlHandoffWarningCheckCount: 3
    });
    expect(manifest.sourceControl.remoteDefaultBranchSha).toBeUndefined();
    expect(manifest.reviewBundle.sourceControlHandoffRemoteDefaultBranchSha).toBeUndefined();
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("github-remote-refs")
    });
  });

  it("fails when source-control handoff evidence is unsafe", async () => {
    const sourceControlPath = path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json");
    const sourceControl = JSON.parse(await readFile(sourceControlPath, "utf8"));
    sourceControl.commandUploadEnabled = true;
    await writeFile(sourceControlPath, JSON.stringify(sourceControl), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("commandUploadEnabled must be false")
    });
  });

  it("fails when ready source-control handoff evidence predates acceptance", async () => {
    const sourceControlPath = path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json");
    const sourceControl = JSON.parse(await readFile(sourceControlPath, "utf8"));
    sourceControl.generatedAt = "2026-05-10T06:59:00.000Z";
    await writeFile(sourceControlPath, JSON.stringify(sourceControl), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("newer than or equal to the latest acceptance record")
    });
  });

  it("fails when the local setup artifact has not been generated", async () => {
    await rm(path.join(root, ".tmp/plug-and-play-setup"), { recursive: true, force: true });

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-setup")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("setup artifact")
    });
  });

  it("fails when the local AI prepare artifact has not been generated", async () => {
    await rm(path.join(root, ".tmp/local-ai-prepare"), { recursive: true, force: true });

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "local-ai-prepare")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("local AI prepare artifact")
    });
  });

  it("fails when review bundle verification points at a stale plug-and-play setup", async () => {
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

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest plug-and-play setup")
    });
  });

  it("fails when review bundle verification points at a stale local AI prepare artifact", async () => {
    await writeFile(path.join(root, ".tmp/local-ai-prepare/seekr-local-ai-prepare-zz-newer.json"), JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-10T07:02:30.000Z",
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

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest local AI prepare artifact")
    });
  });

  it("fails when the operator doctor predates the latest acceptance record", async () => {
    const acceptance = JSON.parse(await readFile(path.join(root, ".tmp/acceptance-status.json"), "utf8"));
    acceptance.generatedAt = Date.parse("2026-05-10T07:02:00.000Z");
    await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify(acceptance), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("newer than or equal to the latest acceptance record")
    });
  });

  it("fails when the operator doctor artifact omits the start-wrapper check", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), "utf8"));
    doctor.checks = doctor.checks.filter((check: { id: string }) => check.id !== "operator-start");
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), JSON.stringify(doctor), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("operator-start")
    });
  });

  it("fails when the operator doctor artifact omits the runtime dependency check", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), "utf8"));
    doctor.checks = doctor.checks.filter((check: { id: string }) => check.id !== "runtime-dependencies");
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), JSON.stringify(doctor), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("runtime-dependencies")
    });
  });

  it("fails when the operator doctor artifact omits the repository safety check", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), "utf8"));
    doctor.checks = doctor.checks.filter((check: { id: string }) => check.id !== "repository-safety");
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), JSON.stringify(doctor), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("repository-safety")
    });
  });

  it("fails when the operator doctor artifact omits dev-server binary evidence", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), "utf8"));
    const runtimeCheck = doctor.checks.find((check: { id: string }) => check.id === "runtime-dependencies");
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
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), JSON.stringify(doctor), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("node_modules/.bin/concurrently")
    });
  });

  it("fails when a critical operator doctor check is only warning", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), "utf8"));
    doctor.checks.find((check: { id: string }) => check.id === "operator-start").status = "warn";
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), JSON.stringify(doctor), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("operator-start")
    });
  });

  it("fails when operator-start doctor artifact rows are reordered", async () => {
    const doctorPath = path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json");
    const doctor = JSON.parse(await readFile(doctorPath, "utf8"));
    doctor.checks = [
      doctor.checks.find((check: { id: string }) => check.id === "runtime-dependencies"),
      doctor.checks.find((check: { id: string }) => check.id === "package-scripts"),
      ...doctor.checks.filter((check: { id: string }) => !["package-scripts", "runtime-dependencies"].includes(check.id))
    ];
    await writeFile(doctorPath, JSON.stringify(doctor), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("shared exact-row operator-start artifact contract")
    });
  });

  it("fails when operator-start doctor artifact includes an extra row", async () => {
    const doctorPath = path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json");
    const doctor = JSON.parse(await readFile(doctorPath, "utf8"));
    doctor.summary.pass += 1;
    doctor.checks.push({
      id: "unreviewed-extra-doctor-check",
      status: "pass",
      details: "Unreviewed extra doctor check passed.",
      evidence: ["unreviewed-extra-doctor-check"]
    });
    await writeFile(doctorPath, JSON.stringify(doctor), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.status).toBe("blocked-local-plug-and-play");
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("shared exact-row operator-start artifact contract")
    });
  });

  it("surfaces soft operator doctor warnings while preserving plug-and-play readiness", async () => {
    const doctor = JSON.parse(await readFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), "utf8"));
    doctor.summary.pass = 7;
    doctor.summary.warn = 3;
    doctor.checks.find((check: { id: string }) => check.id === "source-control-handoff").status = "warn";
    doctor.checks.find((check: { id: string }) => check.id === "local-ports").status = "warn";
    doctor.checks.find((check: { id: string }) => check.id === "data-dir").status = "warn";
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), JSON.stringify(doctor), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:03:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(true);
    expect(manifest.summary.warn).toBe(1);
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("local-ports")
    });
  });

  it("fails when review bundle verification points at stale workflow evidence", async () => {
    await writeFile(path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-zz-newer.json"), JSON.stringify({
      status: "pass-with-limitations",
      commandUploadEnabled: false,
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
      healthHistory: { status: "pass" },
      qaReport: {
        status: "pass",
        path: ".gstack/qa-reports/seekr-qa-newer.md",
        screenshotPaths: []
      }
    }), "utf8");
    await writeFile(path.join(root, ".gstack/qa-reports/seekr-qa-newer.md"), "# QA\n\nPass for local internal-alpha browser/API QA.\n", "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest gstack workflow status")
    });
  });

  it("fails when current gstack workflow rows are reordered", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
    workflow.workflows = [
      workflow.workflows.find((item: { id: string }) => item.id === "review"),
      workflow.workflows.find((item: { id: string }) => item.id === "health"),
      ...workflow.workflows.filter((item: { id: string }) => !["health", "review"].includes(item.id))
    ];
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "workflow-qa")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("gstack workflow rows must exactly match")
    });
  });

  it("fails when current gstack workflow drops unavailable CLI helper-tool evidence", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
    delete workflow.gstackToolNames;
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "workflow-qa")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("helper-tool evidence")
    });
  });

  it("fails when current gstack perspective rows include an extra row", async () => {
    const workflowPath = path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
    workflow.perspectives.push({ id: "unreviewed-extra-perspective", status: "pass" });
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "workflow-qa")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("gstack perspective rows must exactly match")
    });
  });

  it("fails when review bundle verification points at stale source-control handoff evidence", async () => {
    await writeFile(path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-zz-newer.json"), JSON.stringify({
      schemaVersion: 1,
      status: "ready-source-control-handoff",
      ready: true,
      commandUploadEnabled: false,
      repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
      localBranch: "main",
      localHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      remoteDefaultBranchSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workingTreeClean: true,
      workingTreeStatusLineCount: 0,
      configuredRemoteUrls: ["git@github.com:Ayush1298567/SEEKR.git"],
      remoteDefaultBranch: "main",
      remoteRefCount: 1,
      blockedCheckCount: 0,
      warningCheckCount: 0,
      checks: [
        { id: "repository-reference", status: "pass", details: "Repository reference is present." },
        { id: "github-landing-readme", status: "pass", details: "GitHub landing README has a fresh clone path.", evidence: ["../README.md", "github-landing-readme-command-order", "github-landing-readme-ai-readiness-proof"] },
        { id: "local-git-metadata", status: "pass", details: "Local Git metadata is present." },
        { id: "configured-github-remote", status: "pass", details: "GitHub remote is configured." },
        { id: "github-remote-refs", status: "pass", details: "Remote refs are present." },
        { id: "fresh-clone-smoke", status: "pass", details: "Fresh clone contains required plug-and-play startup files and passes npm ci dry-run.", evidence: freshCloneSmokeEvidence() },
        { id: "local-head-published", status: "pass", details: "Local HEAD matches GitHub main." },
        { id: "working-tree-clean", status: "pass", details: "Local worktree is clean." }
      ],
      nextActionChecklist: [
        {
          id: "verify-source-control-before-bundle",
          status: "verification",
          details: "Rerun the read-only audit before final bundling to keep source-control evidence current.",
          commands: ["npm run audit:source-control"],
          clearsCheckIds: ["repository-reference", "github-landing-readme", "local-git-metadata", "configured-github-remote", "github-remote-refs", "fresh-clone-smoke", "local-head-published", "working-tree-clean"]
        }
      ],
      limitations: [
        "This audit is read-only and does not initialize Git, commit files, push branches, or change GitHub settings.",
        "Source-control handoff status is separate from aircraft hardware readiness.",
        "Real command upload and hardware actuation remain disabled."
      ]
    }), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest source-control handoff artifact")
    });
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest source-control handoff")
    });
  });

  it("fails when review bundle verification points at a stale plug-and-play doctor", async () => {
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-zz-newer.json"), JSON.stringify({
      ok: true,
      status: "ready-local-start",
      commandUploadEnabled: false,
      ai: {
        provider: "ollama",
        model: "llama3.2:latest",
        status: "pass"
      },
      summary: {
        pass: 6,
        warn: 0,
        fail: 0
      }
    }), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest operator-start plug-and-play doctor")
    });
  });

  it("does not let a rehearsal-start smoke doctor supersede the operator-start doctor", async () => {
    await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-zz-smoke.json"), JSON.stringify({
      ok: true,
      generatedAt: "2026-05-10T07:05:00.000Z",
      profile: "rehearsal-start-smoke",
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
      checks: []
    }), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "pass",
      evidence: expect.arrayContaining([
        ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"
      ])
    });
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "pass"
    });
  });

  it("fails when review bundle verification points at a stale rehearsal-start smoke artifact", async () => {
    await writeFile(path.join(root, ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-zz-newer.json"), JSON.stringify({
      schemaVersion: 1,
      ok: true,
      status: "pass",
      commandUploadEnabled: false,
      command: "npm run rehearsal:start",
      apiPort: 8788,
      clientPort: 5174,
      dataDirPath: ".tmp/rehearsal-start-smoke/run-newer/data",
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

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest rehearsal-start smoke")
    });
  });

  it("fails when review bundle verification omits the operator quickstart", async () => {
    const verificationPath = path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json");
    const verification = JSON.parse(await readFile(verificationPath, "utf8"));
    delete verification.operatorQuickstartPath;
    await writeFile(verificationPath, JSON.stringify(verification), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("operator quickstart")
    });
  });

  it("fails when review bundle verification omits the strict local AI smoke status", async () => {
    const verificationPath = path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json");
    const verification = JSON.parse(await readFile(verificationPath, "utf8"));
    delete verification.strictAiSmokeStatusPath;
    await writeFile(verificationPath, JSON.stringify(verification), "utf8");

    const manifest = await buildPlugAndPlayReadiness({
      root,
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(manifest.localPlugAndPlayOk).toBe(false);
    expect(manifest.checks.find((check) => check.id === "review-bundle")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("strict local AI smoke status")
    });
  });

  it("writes JSON and Markdown readiness artifacts", async () => {
    const result = await writePlugAndPlayReadiness({
      root,
      outDir: ".tmp/plug-and-play-readiness",
      generatedAt: "2026-05-10T07:00:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}plug-and-play-readiness${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"remainingRealWorldBlockerCount\": 8");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR Plug-And-Play Readiness");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Operator start ports");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Fresh clone");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Remaining real-world blockers");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Count: 8");
  });
});

async function seedPlugAndPlayEvidence(root: string) {
  await mkdir(path.join(root, ".tmp/release-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/api-probe"), { recursive: true });
  await mkdir(path.join(root, ".tmp/completion-audit"), { recursive: true });
  await mkdir(path.join(root, ".tmp/plug-and-play-setup"), { recursive: true });
  await mkdir(path.join(root, ".tmp/local-ai-prepare"), { recursive: true });
  await mkdir(path.join(root, ".tmp/plug-and-play-doctor"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-start-smoke"), { recursive: true });
  await mkdir(path.join(root, ".tmp/fresh-clone-smoke"), { recursive: true });
  await mkdir(path.join(root, ".tmp/source-control-handoff"), { recursive: true });
  await mkdir(path.join(root, ".tmp/gstack-workflow-status"), { recursive: true });
  await mkdir(path.join(root, ".tmp/handoff-bundles"), { recursive: true });
  await mkdir(path.join(root, ".tmp/todo-audit"), { recursive: true });
  await mkdir(path.join(root, ".tmp/overnight"), { recursive: true });
  await mkdir(path.join(root, ".gstack/qa-reports/screenshots"), { recursive: true });
  await mkdir(path.join(root, "src/server/ai"), { recursive: true });
  await mkdir(path.join(root, "src/server/api"), { recursive: true });
  await mkdir(path.join(root, "src/server/__tests__"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "dist"), { recursive: true });

  const scripts = Object.fromEntries([
      "setup:local",
      "ai:prepare",
      "doctor",
      "dev",
      "rehearsal:start",
      "server",
      "client",
      "build",
      "preview",
      "check",
      "acceptance",
      "test:ai:local",
      "smoke:rehearsal:start",
      "smoke:fresh-clone",
      "qa:gstack",
      "audit:completion",
      "demo:package",
      "bench:evidence:packet",
      "handoff:index",
      "handoff:verify",
      "audit:gstack",
      "audit:source-control",
      "audit:todo",
      "audit:plug-and-play",
      "handoff:bundle",
      "handoff:bundle:verify",
      "audit:goal"
    ].map((script) => [script, `echo ${script}`]));
  scripts["rehearsal:start"] = "bash scripts/rehearsal-start.sh";
  scripts["smoke:rehearsal:start"] = "tsx scripts/rehearsal-start-smoke.ts";
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts }), "utf8");
  await writeFile(path.join(root, ".env.example"), [
    "PORT=8787",
    "SEEKR_API_PORT=8787",
    "SEEKR_CLIENT_PORT=5173",
    "SEEKR_DATA_DIR=data",
    "# SEEKR_ENV_FILE=.env",
    "# Set SEEKR_LOAD_DOTENV=false to ignore .env loading.",
    "SEEKR_AI_PROVIDER=ollama",
    "SEEKR_OLLAMA_URL=http://127.0.0.1:11434",
    "SEEKR_OLLAMA_MODEL=llama3.2:latest",
    "SEEKR_OLLAMA_TIMEOUT_MS=20000",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "docs/OPERATOR_QUICKSTART.md"), [
    "# SEEKR Operator Quickstart",
    "",
    "## Setup",
    "",
    "```bash",
    "git clone https://github.com/Ayush1298567/SEEKR.git",
    "cd SEEKR/software",
    "git pull --ff-only",
    "npm ci",
    "npm run setup:local",
    "npm run ai:prepare",
    "npm run audit:source-control",
    "npm run doctor",
    "npm run rehearsal:start",
    "npm run smoke:rehearsal:start",
    "```",
    "",
    "The runnable app lives under software/.",
    "Local AI uses Ollama with llama3.2:latest for advisory proposals.",
    "Run ollama pull llama3.2 before strict local AI smoke so the default model is installed.",
    "Run npm run test:ai:local before final packaging; it writes .tmp/ai-smoke-status.json with strict local AI smoke cases, validator pass, no unsafe operator-facing text, and no mutation while thinking.",
    "If doctor reports a non-SEEKR or unhealthy listener, use the Listener diagnostics line to identify the process. Stop the existing process before startup; if no port variables are explicit, npm run rehearsal:start uses auto-selected free local API/client ports when defaults are busy.",
    "AI output is advisory. It can help select from validated candidate plans, but it cannot create command payloads or bypass operator validation.",
    "",
    "Inspect /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays during rehearsal.",
    "",
    "real-world blockers remain until field evidence exists.",
    "",
    "No real aircraft command upload.",
    "No hardware actuation.",
    "No AI-created command payloads.",
    "No operator answer bypassing validation.",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "dist/index.html"), "<div id=\"root\"></div>\n", "utf8");
  await writeFile(path.join(root, ".tmp/overnight/STATUS.md"), "- Verdict: pass\n", "utf8");
  await writeFile(path.join(root, "scripts/rehearsal-start.sh"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "export SEEKR_DATA_DIR=\"${SEEKR_DATA_DIR:-.tmp/rehearsal-data}\"",
    "export SEEKR_EXPECTED_SOURCES=\"${SEEKR_EXPECTED_SOURCES:-mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception}\"",
    "select_free_port() { echo 49111; }",
    "port_is_busy() { return 1; }",
    "export PORT=\"${PORT:-8787}\"",
    "export SEEKR_API_PORT=\"${SEEKR_API_PORT:-$PORT}\"",
    "export SEEKR_CLIENT_PORT=\"${SEEKR_CLIENT_PORT:-5173}\"",
    "echo \"PORT and SEEKR_API_PORT disagree; set only one API port or set both to the same value before running npm run rehearsal:start.\"",
    "echo \"Default SEEKR API port 8787 is busy; auto-selected free local API port $SEEKR_API_PORT.\"",
    "echo \"Default SEEKR client port 5173 is busy; auto-selected free local client port $SEEKR_CLIENT_PORT.\"",
    "npm run setup:local",
    "npm run ai:prepare",
    "npm run audit:source-control",
    "npm run doctor",
    "exec npm run dev",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "scripts/rehearsal-start-smoke.ts"), [
    "const command = ['npm', 'run', 'rehearsal:start'];",
    "const endpoints = ['/api/config', '/api/source-health', '/api/readiness'];",
    "const safety = 'commandUploadEnabled';",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "scripts/fresh-clone-operator-smoke.ts"), [
    "const clone = 'git clone';",
    "const install = 'npm ci';",
    "const start = 'npm run smoke:rehearsal:start';",
    "const doctor = 'npm run doctor';",
    "const manifest = { commandUploadEnabled: false };",
    ""
  ].join("\n"), "utf8");
  await seedEnvLoaderFiles(root);
  await seedSetupFiles(root);
  await seedLocalAiPrepareFiles(root);
  await seedDoctorFiles(root);

  const releasePath = ".tmp/release-evidence/seekr-release-test.json";
  await writeFile(path.join(root, releasePath), JSON.stringify({
    commandUploadEnabled: false,
    overallSha256: "a".repeat(64),
    fileCount: 10,
    totalBytes: 1000
  }), "utf8");
  await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
    ok: true,
    generatedAt: Date.parse("2026-05-10T07:00:00.000Z"),
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
      jsonPath: releasePath,
      overallSha256: "a".repeat(64),
      fileCount: 10,
      totalBytes: 1000
    },
    commandBoundaryScan: {
      jsonPath: ".tmp/safety-evidence/seekr-command-boundary-scan-test.json",
      markdownPath: ".tmp/safety-evidence/seekr-command-boundary-scan-test.md",
      status: "pass",
      scannedFileCount: 126,
      violationCount: 0,
      allowedFindingCount: 36,
      commandUploadEnabled: false
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/api-probe/seekr-api-probe-test.json"), JSON.stringify({
    ok: true,
    commandUploadEnabled: false,
    checked: ["config", "session-acceptance", "session-acceptance-evidence", "readiness", "verify", "replays", "malformed-json"],
    sessionAcceptance: {
      ok: true,
      status: "pass",
      generatedAt: Date.parse("2026-05-10T07:00:00.000Z"),
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
        overallSha256: "a".repeat(64),
        fileCount: 10,
        totalBytes: 1000
      },
      commandBoundaryScan: {
        status: "pass",
        scannedFileCount: 126,
        violationCount: 0,
        allowedFindingCount: 36
      }
    }
  }), "utf8");
  const completionBlockers = [
    { id: "fresh-operator-rehearsal", details: "Fresh-operator field-laptop rehearsal is not completed in this session." },
    { id: "actual-jetson-orin-nano-hardware-evidence", details: "No actual Jetson Orin Nano hardware readiness archive is present." },
    { id: "actual-raspberry-pi-5-hardware-evidence", details: "No actual Raspberry Pi 5 hardware readiness archive is present." },
    { id: "real-mavlink-bench", details: "No real read-only MAVLink serial/UDP bench telemetry source has been validated." },
    { id: "real-ros2-bench", details: "No real read-only ROS 2 /map, pose, detection, LiDAR, or costmap topic bridge has been validated." },
    { id: "hil-failsafe-manual-override", details: "No HIL failsafe/manual override logs from a real bench run are present." },
    { id: "isaac-sim-jetson-capture", details: "No Isaac Sim to Jetson capture from a real bench run is archived." },
    { id: "hardware-actuation-policy-review", details: "No reviewed hardware-actuation policy package exists, and runtime command authority remains disabled with false authorization fields." }
  ];
  await writeFile(path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json"), JSON.stringify({
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    summary: {
      pass: 2,
      warn: 0,
      fail: 0,
      blocked: completionBlockers.length
    },
    items: [
      {
        id: "adapter-command-boundary",
        status: "pass",
        details: "MAVLink and ROS 2 adapter command methods remain rejected and documented as read-only."
      },
      {
        id: "command-boundary-scan",
        status: "pass",
        details: "Latest command-boundary static scan passed."
      },
      ...completionBlockers.map((blocker) => ({
        id: blocker.id,
        status: "blocked",
        details: blocker.details
      }))
    ],
    realWorldBlockerIds: completionBlockers.map((blocker) => blocker.id),
    realWorldBlockers: completionBlockers.map((blocker) => blocker.details)
  }), "utf8");
  await writeFile(path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json"), JSON.stringify({
    status: "pass-with-limitations",
    commandUploadEnabled: false,
    gstackAvailable: true,
    gstackCliAvailable: false,
    gstackToolRoot: GSTACK_TOOL_ROOT,
    gstackToolCount: GSTACK_TOOL_COUNT,
    gstackToolNames: GSTACK_TOOL_NAMES,
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
    healthHistory: { status: "pass" },
    qaReport: {
      status: "pass",
      path: ".gstack/qa-reports/seekr-qa-test.md",
      screenshotPaths: [
        ".gstack/qa-reports/screenshots/seekr-qa-test-home.png",
        ".gstack/qa-reports/screenshots/seekr-qa-test-mobile.png"
      ]
    },
    evidence: ["docs/goal.md", GSTACK_HELPER_TOOL_EVIDENCE, ".gstack/qa-reports/seekr-qa-test.md"],
    limitations: [
      GSTACK_CLI_UNAVAILABLE_LIMITATION,
      "No .git metadata is present in this workspace."
    ]
  }), "utf8");
  await writeFile(path.join(root, ".gstack/qa-reports/seekr-qa-test.md"), "# QA\n\nPass for local internal-alpha browser/API QA.\n", "utf8");
  await writeFile(path.join(root, ".gstack/qa-reports/screenshots/seekr-qa-test-home.png"), "home", "utf8");
  await writeFile(path.join(root, ".gstack/qa-reports/screenshots/seekr-qa-test-mobile.png"), "mobile", "utf8");
  await writeFile(path.join(root, ".tmp/todo-audit/seekr-todo-audit-test.json"), JSON.stringify({
    status: "pass-real-world-blockers-tracked",
    commandUploadEnabled: false
  }), "utf8");
  await writeFile(path.join(root, ".tmp/handoff-bundles/seekr-handoff-bundle-test.json"), JSON.stringify({
    status: "ready-local-alpha-review-bundle",
    commandUploadEnabled: false
  }), "utf8");
  await writeFile(path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json"), JSON.stringify({
    status: "pass",
    commandUploadEnabled: false,
    sourceBundlePath: ".tmp/handoff-bundles/seekr-handoff-bundle-test.json",
    gstackWorkflowStatusPath: ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json",
    gstackQaReportPath: ".gstack/qa-reports/seekr-qa-test.md",
    todoAuditPath: ".tmp/todo-audit/seekr-todo-audit-test.json",
    sourceControlHandoffPath: ".tmp/source-control-handoff/seekr-source-control-handoff-test.json",
    sourceControlHandoffRepositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    sourceControlHandoffPackageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
    sourceControlHandoffConfiguredRemoteUrls: ["git@github.com:Ayush1298567/SEEKR.git"],
    sourceControlHandoffLocalBranch: "main",
    sourceControlHandoffRemoteDefaultBranch: "main",
    sourceControlHandoffRemoteRefCount: 1,
    sourceControlHandoffBlockedCheckCount: 0,
    sourceControlHandoffWarningCheckCount: 0,
    sourceControlHandoffLocalHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourceControlHandoffRemoteDefaultBranchSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourceControlHandoffWorkingTreeClean: true,
    sourceControlHandoffWorkingTreeStatusLineCount: 0,
    plugAndPlaySetupPath: ".tmp/plug-and-play-setup/seekr-local-setup-test.json",
    localAiPreparePath: ".tmp/local-ai-prepare/seekr-local-ai-prepare-test.json",
    plugAndPlayDoctorPath: ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json",
    rehearsalStartSmokePath: ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json",
    freshCloneSmokePath: ".tmp/fresh-clone-smoke/seekr-fresh-clone-smoke-test.json",
    strictAiSmokeStatusPath: ".tmp/ai-smoke-status.json",
    operatorQuickstartPath: "docs/OPERATOR_QUICKSTART.md",
    checkedFileCount: 9,
    secretScan: {
      status: "pass",
      expectedFileCount: 9,
      scannedFileCount: 9,
      findingCount: 0
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json"), JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-10T07:02:00.000Z",
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
  await writeFile(path.join(root, ".tmp/fresh-clone-smoke/seekr-fresh-clone-smoke-test.json"), JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-10T07:03:00.000Z",
    ok: true,
    status: "pass",
    commandUploadEnabled: false,
    repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    cloneCommand: ["git", "clone", "--depth", "1", "https://github.com/Ayush1298567/SEEKR"],
    installCommand: ["npm", "ci", "--ignore-scripts", "--no-audit", "--fund=false", "--prefer-offline"],
    localHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    cloneHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    plugAndPlaySetupPath: ".tmp/plug-and-play-setup/seekr-local-setup-fresh-clone.json",
    localAiPreparePath: ".tmp/local-ai-prepare/seekr-local-ai-prepare-fresh-clone.json",
    localAiPrepareModel: "llama3.2:latest",
    sourceControlHandoffPath: ".tmp/source-control-handoff/seekr-source-control-handoff-fresh-clone.json",
    sourceControlHandoffStatus: "ready-source-control-handoff",
    sourceControlHandoffReady: true,
    sourceControlHandoffLocalHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourceControlHandoffRemoteDefaultBranchSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    plugAndPlayDoctorPath: ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-fresh-clone.json",
    plugAndPlayDoctorStatus: "ready-local-start",
    rehearsalStartSmokePath: ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-fresh-clone.json",
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

async function seedLocalAiPrepareFiles(root: string) {
  await writeFile(path.join(root, "scripts/local-ai-prepare.ts"), [
    "export async function buildLocalAiPrepare() { return true; }",
    "export async function writeLocalAiPrepare() { return true; }",
    "const manifest = { commandUploadEnabled: false };",
    "const provider = 'ollama';",
    "const action = 'pull';",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "src/server/__tests__/localAiPrepare.test.ts"), [
    "it('runs ollama pull llama3.2', () => {});",
    "it('supports check-only mode', () => {});",
    "it('fails closed when ollama prep fails closed', () => {});",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, ".tmp/local-ai-prepare/seekr-local-ai-prepare-test.json"), JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-10T07:01:00.000Z",
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
  await writeFile(path.join(root, ".tmp/local-ai-prepare/seekr-local-ai-prepare-test.md"), "# SEEKR Local AI Prepare\n", "utf8");
}

async function seedSetupFiles(root: string) {
  await writeFile(path.join(root, "scripts/local-setup.ts"), [
    "export async function writeLocalSetup() { return {}; }",
    "const envCreated = true;",
    "const envAlreadyExisted = false;",
    "const check = 'rehearsal-data-dir';",
    "const unsafe = 'SEEKR_COMMAND_UPLOAD_ENABLED=true';",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "src/server/__tests__/localSetup.test.ts"), [
    "it('does not overwrite an existing env file', () => {});",
    "it('blocks env output paths outside the project root', () => {});",
    "it('blocks setup when env example defaults are missing', () => {});",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, ".tmp/plug-and-play-setup/seekr-local-setup-test.json"), JSON.stringify({
    ok: true,
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
  }), "utf8");
}

async function seedDoctorFiles(root: string) {
  await writeFile(path.join(root, "scripts/plug-and-play-doctor.ts"), [
    "export async function buildPlugAndPlayDoctor() { return {}; }",
    "export async function writePlugAndPlayDoctor() { return {}; }",
    "const checks = ['runtime-dependencies', 'repository-safety', 'source-control-handoff', 'packageManager', 'engines.node', '.npmrc', 'node_modules/.bin/concurrently', 'node_modules/.bin/vite', 'local-ai', 'local-ports', 'auto-selected free local', 'SEEKR_DOCTOR_PROFILE'];",
    "function probeOccupiedSeekrPort() { return true; }",
    "const healthy = 'healthy SEEKR local instance';",
    "const disabled = process.env.SEEKR_COMMAND_UPLOAD_ENABLED;",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "src/server/__tests__/plugAndPlayDoctor.test.ts"), [
    "it('fails when local runtime dependencies have not been installed', () => {});",
    "it('fails when the repository safety policy is missing', () => {});",
    "it('fails when configured Ollama model is unavailable', () => {});",
    "it('passes when unconfigured default ports are occupied because rehearsal start can auto-select free ports', () => {});",
    "it('warns when explicitly configured local start ports are already occupied', () => {});",
    "it('passes when occupied local ports already serve a healthy SEEKR instance', () => {});",
    "const details = 'healthy SEEKR local instance';",
    "it('fails when unsafe local environment flags are true', () => {});",
    "it('fails when the rehearsal start wrapper skips the doctor preflight', () => {});",
    "it('fails when the rehearsal start wrapper skips port normalization and automatic fallback', () => {});",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), JSON.stringify({
    ok: true,
    generatedAt: "2026-05-10T07:01:00.000Z",
    profile: "operator-start",
    status: "ready-local-start",
    commandUploadEnabled: false,
    ports: {
      api: 8787,
      client: 5173
    },
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
            details: "Source-control handoff artifact .tmp/source-control-handoff/seekr-source-control-handoff-test.json is ready.",
            evidence: [".tmp/source-control-handoff/seekr-source-control-handoff-test.json"]
          }
      : id === "local-ports"
        ? {
            id,
            status: "pass",
            details: "Default port(s) already in use on 127.0.0.1 by a non-SEEKR or unhealthy listener: client 5173. Listener diagnostics: client 5173 -> node pid 12345 cwd ~/Ayush/Prophet/prophet-console. npm run rehearsal:start auto-selects free local API/client ports when no explicit port variables are set.",
            evidence: [
              "PORT",
              "SEEKR_API_PORT",
              "SEEKR_CLIENT_PORT",
              "scripts/rehearsal-start.sh auto-selected free local API/client ports",
              "lsof -nP -iTCP:5173 -sTCP:LISTEN",
              "listener 12345 cwd ~/Ayush/Prophet/prophet-console"
            ]
          }
      : { id, status: "pass", details: `${id} passed.` })
  }), "utf8");
  await writeFile(path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json"), JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-10T07:00:30.000Z",
    status: "ready-source-control-handoff",
    ready: true,
    commandUploadEnabled: false,
    repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    packageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
    gitMetadataPath: ".git",
    localBranch: "main",
    localHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    remoteDefaultBranchSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workingTreeClean: true,
    workingTreeStatusLineCount: 0,
    configuredRemoteUrls: ["git@github.com:Ayush1298567/SEEKR.git"],
    remoteDefaultBranch: "main",
    remoteRefCount: 1,
    blockedCheckCount: 0,
    warningCheckCount: 0,
    checks: [
      { id: "repository-reference", status: "pass", details: "Repository reference is present." },
      { id: "github-landing-readme", status: "pass", details: "GitHub landing README has a fresh clone path.", evidence: ["../README.md", "github-landing-readme-command-order", "github-landing-readme-ai-readiness-proof"] },
      { id: "local-git-metadata", status: "pass", details: "Local Git metadata is present." },
      { id: "configured-github-remote", status: "pass", details: "GitHub remote is configured." },
      { id: "github-remote-refs", status: "pass", details: "Remote refs are present." },
      { id: "fresh-clone-smoke", status: "pass", details: "Fresh clone contains required plug-and-play startup files and passes npm ci dry-run.", evidence: freshCloneSmokeEvidence() },
      { id: "local-head-published", status: "pass", details: "Local HEAD matches GitHub main." },
      { id: "working-tree-clean", status: "pass", details: "Local worktree is clean." }
    ],
    nextActionChecklist: [
      {
        id: "verify-source-control-before-bundle",
        status: "verification",
        details: "Rerun the read-only audit before final bundling to keep source-control evidence current.",
        commands: ["npm run audit:source-control"],
        clearsCheckIds: ["repository-reference", "github-landing-readme", "local-git-metadata", "configured-github-remote", "github-remote-refs", "fresh-clone-smoke", "local-head-published", "working-tree-clean"]
      }
    ],
    limitations: [
      "This audit is read-only and does not initialize Git, commit files, push branches, or change GitHub settings.",
      "Source-control handoff status is separate from aircraft hardware readiness.",
      "Real command upload and hardware actuation remain disabled."
    ]
  }), "utf8");
}

function freshCloneSmokeEvidence() {
  return [
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
  ];
}

async function seedEnvLoaderFiles(root: string) {
  await writeFile(path.join(root, "src/server/env.ts"), [
    "export function loadLocalEnv() { return { loaded: true }; }",
    "export function parseEnvContent() { return []; }",
    "const file = process.env.SEEKR_ENV_FILE;",
    "const disabled = process.env.SEEKR_LOAD_DOTENV === 'false';",
    "const reason = 'outside-root';",
    ""
  ].join("\n"), "utf8");
  for (const file of [
    "src/server/index.ts",
    "src/server/config.ts",
    "src/server/session.ts",
    "src/server/ai/llamaProvider.ts",
    "src/server/sourceHealth.ts",
    "src/server/persistence.ts",
    "src/server/api/auth.ts"
  ]) {
    await writeFile(path.join(root, file), "import { loadLocalEnv } from './env';\nloadLocalEnv();\n", "utf8");
  }
  await writeFile(path.join(root, "src/server/__tests__/envLoader.test.ts"), [
    "it('fills unset server AI settings from a project-local .env', () => {});",
    "it('does not override explicit environment variables', () => {});",
    "it('ignores env files outside the project root', () => {});",
    ""
  ].join("\n"), "utf8");
}
