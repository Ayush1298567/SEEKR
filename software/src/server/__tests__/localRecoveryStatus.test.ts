import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLocalRecoveryStatus, localRecoveryStatusCliSummary, writeLocalRecoveryStatus } from "../../../scripts/local-recovery-status";

const GENERATED_AT = "2026-05-12T00:00:00.000Z";
const ACCEPTANCE_GENERATED_AT_MS = 1_800_000_000_000;
const FRESH_ARTIFACT_AT = "2027-01-15T08:00:01.000Z";
const STALE_ARTIFACT_AT = "2027-01-15T07:59:59.000Z";
const HEAD_SHA = "1111111111111111111111111111111111111111";
const STALE_HEAD_SHA = "2222222222222222222222222222222222222222";

describe("local recovery status", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-local-recovery-status-test-${process.pid}-${Date.now()}`);
    await seedRecoveryArtifacts(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("summarizes the latest local plug-and-play recovery state without clearing real-world blockers", async () => {
    const result = await writeLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(result.manifest.status).toBe("ready-local-recovery-real-world-blocked");
    expect(result.manifest.localRecoveryOk).toBe(true);
    expect(result.manifest.complete).toBe(false);
    expect(result.manifest.commandUploadEnabled).toBe(false);
    expect(result.manifest.localHeadSha).toBe(HEAD_SHA);
    expect(result.manifest.freshCloneHeadSha).toBe(HEAD_SHA);
    expect(result.manifest.strictAi).toMatchObject({
      provider: "ollama",
      model: "llama3.2:latest",
      ollamaUrl: "http://127.0.0.1:11434",
      caseCount: 4
    });
    expect(result.manifest.plugAndPlay).toMatchObject({
      warningCount: 1,
      fallbackApi: 59374,
      fallbackClient: 59375,
      defaultPortsOccupied: true,
      autoRecoverable: true,
      listenerDiagnostics: [
        "listener 123 cwd ~/Ayush/Prophet/prophet-console"
      ],
      details: expect.stringContaining("auto-selects free local API/client ports")
    });
    expect(result.manifest.remainingRealWorldBlockerCount).toBe(8);
    expect(result.manifest.summary).toMatchObject({
      fail: 0,
      warn: 1,
      blocked: 1
    });
    expect(result.manifest.nextCommands).toContain("npm run plug-and-play");
    expect(localRecoveryStatusCliSummary(result)).toMatchObject({
      plugAndPlay: {
        fallbackApi: 59374,
        fallbackClient: 59375,
        defaultPortsOccupied: true,
        autoRecoverable: true,
        listenerDiagnostics: [
          "listener 123 cwd ~/Ayush/Prophet/prophet-console"
        ],
        details: expect.stringContaining("auto-selects free local API/client ports")
      }
    });
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR Local Recovery Status");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("listener 123 cwd ~/Ayush/Prophet/prophet-console");
  });

  it("blocks local recovery status when the fresh-clone strict AI proof is missing", async () => {
    await rm(path.join(root, ".tmp/fresh-clone-smoke"), { recursive: true, force: true });

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("blocked-local-recovery");
    expect(manifest.localRecoveryOk).toBe(false);
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.checks.find((check) => check.id === "fresh-clone-ai-proof")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("Fresh clone proof is missing")
    });
  });

  it("blocks local recovery status when acceptance points at stale release evidence", async () => {
    await writeJson(path.join(root, ".tmp/release-evidence/seekr-release-0.2.0-zz-newer.json"), {
      commandUploadEnabled: false,
      overallSha256: "a".repeat(64),
      fileCount: 99,
      totalBytes: 2048
    });

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("blocked-local-recovery");
    expect(manifest.checks.find((check) => check.id === "acceptance-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("latest release evidence")
    });
  });

  it("blocks local recovery status when acceptance auxiliary release or safety fields are stale", async () => {
    const acceptance = JSON.parse(await readFile(path.join(root, ".tmp/acceptance-status.json"), "utf8"));
    acceptance.releaseChecksum.sha256Path = path.join(root, ".tmp/release-evidence/seekr-release-0.2.0-old.sha256");
    acceptance.releaseChecksum.markdownPath = path.join(root, ".tmp/release-evidence/seekr-release-0.2.0-old.md");
    acceptance.commandBoundaryScan.markdownPath = path.join(root, ".tmp/safety-evidence/seekr-command-boundary-scan-old.md");
    acceptance.commandBoundaryScan.allowedFindingCount = 99;
    await writeJson(path.join(root, ".tmp/acceptance-status.json"), acceptance);

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    const acceptanceStatus = manifest.checks.find((check) => check.id === "acceptance-status");
    expect(manifest.status).toBe("blocked-local-recovery");
    expect(acceptanceStatus).toMatchObject({ status: "fail" });
    expect(acceptanceStatus?.details).toEqual(expect.stringContaining("SHA-256 path"));
    expect(acceptanceStatus?.details).toEqual(expect.stringContaining("Markdown path"));
    expect(acceptanceStatus?.details).toEqual(expect.stringContaining("allowed-finding count"));
  });

  it("blocks local recovery status when acceptance strict AI cases drift", async () => {
    const acceptance = JSON.parse(await readFile(path.join(root, ".tmp/acceptance-status.json"), "utf8"));
    acceptance.strictLocalAi.caseNames = [
      "baseline-zone-assignment",
      "prompt-injection-detection-notes",
      "map-conflict-no-fly-draft",
      "unexpected-extra-case"
    ];
    await writeJson(path.join(root, ".tmp/acceptance-status.json"), acceptance);

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("blocked-local-recovery");
    expect(manifest.checks.find((check) => check.id === "acceptance-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("strict local AI case names")
    });
  });

  it("blocks local recovery status when acceptance command-boundary evidence is stale", async () => {
    const acceptance = JSON.parse(await readFile(path.join(root, ".tmp/acceptance-status.json"), "utf8"));
    acceptance.commandBoundaryScan.scannedFileCount = 41;
    await writeJson(path.join(root, ".tmp/acceptance-status.json"), acceptance);

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("blocked-local-recovery");
    expect(manifest.checks.find((check) => check.id === "acceptance-status")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("scanned-file count")
    });
  });

  it("blocks local recovery status when API probe readback is stale against acceptance", async () => {
    const probe = JSON.parse(await readFile(path.join(root, ".tmp/api-probe/seekr-api-probe-test.json"), "utf8"));
    probe.sessionAcceptance.releaseChecksum.overallSha256 = "0".repeat(64);
    probe.sessionAcceptance.strictLocalAi.caseNames = [
      "baseline-zone-assignment",
      "prompt-injection-detection-notes",
      "map-conflict-no-fly-draft",
      "unexpected-extra-case"
    ];
    await writeJson(path.join(root, ".tmp/api-probe/seekr-api-probe-test.json"), probe);

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("blocked-local-recovery");
    expect(manifest.checks.find((check) => check.id === "api-readback")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("API probe release checksum summary")
    });
    expect(manifest.checks.find((check) => check.id === "api-readback")?.details).toEqual(expect.stringContaining("strict local AI summary"));
  });

  it("blocks local recovery status when the fresh-clone proof is stale against source control", async () => {
    const freshClone = JSON.parse(await readFile(path.join(root, ".tmp/fresh-clone-smoke/seekr-fresh-clone-smoke-test.json"), "utf8"));
    freshClone.cloneHeadSha = STALE_HEAD_SHA;
    freshClone.sourceControlHandoffLocalHeadSha = STALE_HEAD_SHA;
    await writeJson(path.join(root, ".tmp/fresh-clone-smoke/seekr-fresh-clone-smoke-test.json"), freshClone);

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("blocked-local-recovery");
    expect(manifest.checks.find((check) => check.id === "fresh-clone-ai-proof")).toMatchObject({
      status: "fail",
      details: expect.stringContaining(`current source-control HEAD ${HEAD_SHA}`)
    });
  });

  it("blocks local recovery status when plug-and-play readiness points at a stale source-control head", async () => {
    const readiness = JSON.parse(await readFile(path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json"), "utf8"));
    readiness.sourceControl.localHeadSha = STALE_HEAD_SHA;
    readiness.freshClone.cloneHeadSha = STALE_HEAD_SHA;
    readiness.reviewBundle.sourceControlHandoffLocalHeadSha = STALE_HEAD_SHA;
    await writeJson(path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json"), readiness);

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("blocked-local-recovery");
    expect(manifest.checks.find((check) => check.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("stale against current source-control HEAD")
    });
  });

  it("blocks local recovery status when plug-and-play readiness predates current acceptance", async () => {
    const readiness = JSON.parse(await readFile(path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json"), "utf8"));
    readiness.generatedAt = STALE_ARTIFACT_AT;
    await writeJson(path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json"), readiness);

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("blocked-local-recovery");
    expect(manifest.checks.find((check) => check.id === "plug-and-play-readiness")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("older than the current acceptance record")
    });
  });

  it("blocks local recovery status when review bundle verification points at a stale source-control head", async () => {
    const verification = JSON.parse(await readFile(path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json"), "utf8"));
    verification.sourceControlHandoffRemoteDefaultBranchSha = STALE_HEAD_SHA;
    verification.freshCloneSmokeCloneHeadSha = STALE_HEAD_SHA;
    await writeJson(path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json"), verification);

    const manifest = await buildLocalRecoveryStatus({
      root,
      generatedAt: GENERATED_AT
    });

    expect(manifest.status).toBe("blocked-local-recovery");
    expect(manifest.checks.find((check) => check.id === "review-bundle-verification")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("stale against current source-control HEAD")
    });
  });
});

async function seedRecoveryArtifacts(root: string) {
  for (const directory of [
    ".tmp/source-control-handoff",
    ".tmp/release-evidence",
    ".tmp/safety-evidence",
    ".tmp/api-probe",
    ".tmp/fresh-clone-smoke",
    ".tmp/plug-and-play-readiness",
    ".tmp/goal-audit",
    ".tmp/handoff-bundles",
    ".tmp/gstack-workflow-status",
    ".tmp/overnight"
  ]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }

  await writeJson(path.join(root, ".tmp/acceptance-status.json"), {
    ok: true,
    status: "pass",
    generatedAt: ACCEPTANCE_GENERATED_AT_MS,
    completedCommands: Array.from({ length: 13 }, (_, index) => `command-${index}`),
    commandUploadEnabled: false,
    releaseChecksum: {
      jsonPath: path.join(root, ".tmp/release-evidence/seekr-release-0.2.0-test.json"),
      sha256Path: path.join(root, ".tmp/release-evidence/seekr-release-0.2.0-test.sha256"),
      markdownPath: path.join(root, ".tmp/release-evidence/seekr-release-0.2.0-test.md"),
      overallSha256: "f".repeat(64),
      fileCount: 42,
      totalBytes: 1024
    },
    commandBoundaryScan: {
      jsonPath: path.join(root, ".tmp/safety-evidence/seekr-command-boundary-scan-test.json"),
      markdownPath: path.join(root, ".tmp/safety-evidence/seekr-command-boundary-scan-test.md"),
      status: "pass",
      scannedFileCount: 12,
      violationCount: 0,
      allowedFindingCount: 3,
      commandUploadEnabled: false
    },
    strictLocalAi: {
      ok: true,
      provider: "ollama",
      model: "llama3.2:latest",
      ollamaUrl: "http://127.0.0.1:11434",
      commandUploadEnabled: false,
      caseCount: 4,
      caseNames: [
        "baseline-zone-assignment",
        "prompt-injection-detection-notes",
        "map-conflict-no-fly-draft",
        "prompt-injection-spatial-metadata"
      ]
    }
  });
  await writeJson(path.join(root, ".tmp/release-evidence/seekr-release-0.2.0-test.json"), {
    commandUploadEnabled: false,
    overallSha256: "f".repeat(64),
    fileCount: 42,
    totalBytes: 1024
  });
  await writeJson(path.join(root, ".tmp/safety-evidence/seekr-command-boundary-scan-test.json"), {
    status: "pass",
    commandUploadEnabled: false,
    summary: {
      scannedFileCount: 12,
      violationCount: 0,
      allowedFindingCount: 3
    },
    scannedFiles: Array.from({ length: 12 }, (_, index) => `src/file-${index}.ts`),
    violations: []
  });
  await writeJson(path.join(root, ".tmp/api-probe/seekr-api-probe-test.json"), {
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
      ok: true,
      status: "pass",
      generatedAt: 1800000000000,
      commandCount: 13,
      commandUploadEnabled: false,
      releaseChecksum: {
        overallSha256: "f".repeat(64),
        fileCount: 42,
        totalBytes: 1024
      },
      commandBoundaryScan: {
        status: "pass",
        scannedFileCount: 12,
        violationCount: 0,
        allowedFindingCount: 3
      },
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest",
        ollamaUrl: "http://127.0.0.1:11434",
        commandUploadEnabled: false,
        caseCount: 4,
        caseNames: [
          "baseline-zone-assignment",
          "prompt-injection-detection-notes",
          "map-conflict-no-fly-draft",
          "prompt-injection-spatial-metadata"
        ]
      }
    }
  });
  await writeJson(path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json"), {
    generatedAt: FRESH_ARTIFACT_AT,
    status: "ready-source-control-handoff",
    ready: true,
    commandUploadEnabled: false,
    localHeadSha: HEAD_SHA,
    remoteDefaultBranchSha: HEAD_SHA,
    freshCloneHeadSha: HEAD_SHA,
    workingTreeClean: true,
    blockedCheckCount: 0,
    warningCheckCount: 0
  });
  await writeJson(path.join(root, ".tmp/fresh-clone-smoke/seekr-fresh-clone-smoke-test.json"), {
    generatedAt: FRESH_ARTIFACT_AT,
    status: "pass",
    commandUploadEnabled: false,
    localHeadSha: HEAD_SHA,
    cloneHeadSha: HEAD_SHA,
    sourceControlHandoffLocalHeadSha: HEAD_SHA,
    sourceControlHandoffRemoteDefaultBranchSha: HEAD_SHA,
    sourceControlHandoffFreshCloneHeadSha: HEAD_SHA,
    strictAiSmokeProvider: "ollama",
    strictAiSmokeModel: "llama3.2:latest",
    strictAiSmokeOllamaUrl: "http://127.0.0.1:11434",
    strictAiSmokeCaseCount: 4
  });
  await writeJson(path.join(root, ".tmp/plug-and-play-readiness/seekr-plug-and-play-readiness-test.json"), {
    generatedAt: FRESH_ARTIFACT_AT,
    status: "ready-local-plug-and-play-real-world-blocked",
    localPlugAndPlayOk: true,
    complete: false,
    commandUploadEnabled: false,
    summary: {
      pass: 15,
      warn: 1,
      fail: 0,
      blocked: 1
    },
    operatorStartPorts: {
      fallbackApi: 59374,
      fallbackClient: 59375,
      defaultPortsOccupied: true,
      autoRecoverable: true,
      listenerDiagnostics: [
        "listener 123 cwd ~/Ayush/Prophet/prophet-console"
      ],
      details: "Default ports are occupied by a non-SEEKR listener; npm run plug-and-play auto-selects free local API/client ports."
    },
    sourceControl: {
      localHeadSha: HEAD_SHA,
      remoteDefaultBranchSha: HEAD_SHA,
      freshCloneHeadSha: HEAD_SHA
    },
    freshClone: {
      localHeadSha: HEAD_SHA,
      cloneHeadSha: HEAD_SHA,
      sourceControlHandoffLocalHeadSha: HEAD_SHA,
      sourceControlHandoffRemoteDefaultBranchSha: HEAD_SHA,
      sourceControlHandoffFreshCloneHeadSha: HEAD_SHA
    },
    reviewBundle: {
      sourceControlHandoffLocalHeadSha: HEAD_SHA,
      sourceControlHandoffRemoteDefaultBranchSha: HEAD_SHA,
      sourceControlHandoffFreshCloneHeadSha: HEAD_SHA
    },
    remainingRealWorldBlockerCount: 8,
    remainingRealWorldBlockers: recoveryBlockers()
  });
  await writeJson(path.join(root, ".tmp/goal-audit/seekr-goal-audit-test.json"), {
    generatedAt: FRESH_ARTIFACT_AT,
    status: "local-alpha-ready-real-world-blocked",
    complete: false,
    commandUploadEnabled: false,
    summary: {
      pass: 11,
      warn: 1,
      fail: 0,
      blocked: 1
    },
    remainingRealWorldBlockerCount: 8,
    remainingRealWorldBlockers: recoveryBlockers()
  });
  await writeJson(path.join(root, ".tmp/handoff-bundles/seekr-review-bundle-verification-test.json"), {
    generatedAt: FRESH_ARTIFACT_AT,
    status: "pass",
    commandUploadEnabled: false,
    sourceControlHandoffLocalHeadSha: HEAD_SHA,
    sourceControlHandoffRemoteDefaultBranchSha: HEAD_SHA,
    sourceControlHandoffFreshCloneHeadSha: HEAD_SHA,
    freshCloneSmokeLocalHeadSha: HEAD_SHA,
    freshCloneSmokeCloneHeadSha: HEAD_SHA,
    freshCloneSmokeSourceControlHandoffLocalHeadSha: HEAD_SHA,
    freshCloneSmokeSourceControlHandoffRemoteDefaultBranchSha: HEAD_SHA,
    freshCloneSmokeSourceControlHandoffFreshCloneHeadSha: HEAD_SHA,
    checkedFileCount: 42,
    secretScan: {
      status: "pass",
      expectedFileCount: 42,
      scannedFileCount: 42,
      findingCount: 0
    }
  });
  await writeJson(path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json"), {
    generatedAt: FRESH_ARTIFACT_AT,
    status: "pass-with-limitations",
    commandUploadEnabled: false,
    healthHistory: {
      status: "pass"
    },
    qaReport: {
      status: "pass"
    }
  });
  await writeFile(path.join(root, ".tmp/overnight/STATUS.md"), [
    "# SEEKR Overnight Loop Status",
    "",
    "- Last update: 2026-05-12T00:19:50Z",
    "- Verdict: pass",
    ""
  ].join("\n"), "utf8");
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function recoveryBlockers() {
  return [
    "Fresh-operator field-laptop rehearsal is not completed in this session.",
    "No actual Jetson Orin Nano hardware readiness archive is present.",
    "No actual Raspberry Pi 5 hardware readiness archive is present.",
    "No real read-only MAVLink serial/UDP bench telemetry source has been validated.",
    "No real read-only ROS 2 /map, pose, detection, LiDAR, or costmap topic bridge has been validated.",
    "No HIL failsafe/manual override logs from a real bench run are present.",
    "No Isaac Sim to Jetson capture from a real bench run is archived.",
    "No reviewed hardware-actuation policy package exists, and runtime command authority remains disabled."
  ];
}
