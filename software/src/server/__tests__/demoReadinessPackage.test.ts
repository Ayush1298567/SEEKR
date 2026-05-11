import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDemoReadinessPackage, writeDemoReadinessPackage } from "../../../scripts/demo-readiness-package";

describe("demo readiness package", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-demo-package-test-${process.pid}-${Date.now()}`);
    await mkdir(path.join(root, ".tmp/release-evidence"), { recursive: true });
    await mkdir(path.join(root, ".tmp/safety-evidence"), { recursive: true });
    await mkdir(path.join(root, ".tmp/api-probe"), { recursive: true });
    await mkdir(path.join(root, ".tmp/completion-audit"), { recursive: true });
    await mkdir(path.join(root, ".tmp/source-control-handoff"), { recursive: true });
    await mkdir(path.join(root, ".tmp/hardware-evidence"), { recursive: true });
    await mkdir(path.join(root, ".tmp/policy-evidence"), { recursive: true });
    await mkdir(path.join(root, ".tmp/overnight"), { recursive: true });
    await seedPackageEvidence(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("packages local-alpha evidence while preserving real-world blockers", async () => {
    const manifest = await buildDemoReadinessPackage({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z",
      label: "alpha-demo"
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      status: "ready-local-alpha",
      localAlphaOk: true,
      complete: false,
      commandUploadEnabled: false,
      releaseChecksum: {
        overallSha256: "a".repeat(64),
        fileCount: 42,
        totalBytes: 123456
      },
      overnightStatus: {
        verdict: "pass",
        lastUpdate: "2026-05-09T19:30:00Z",
        cycle: "12",
        stale: false,
        ok: true
      },
      hardwareClaims: {
        jetsonOrinNanoValidated: false,
        raspberryPi5Validated: false,
        realMavlinkBenchValidated: false,
        realRos2BenchValidated: false,
        hilFailsafeValidated: false,
        isaacJetsonCaptureValidated: false,
        hardwareActuationAuthorized: false
      }
    });
    expect(manifest.validation.blockers).toEqual([]);
    expect(manifest.realWorldBlockers).toEqual([
      "Hardware archives exist, but no actual-target host-platform pass was found for: jetson-orin-nano.",
      "Hardware archives exist, but no actual-target host-platform pass was found for: raspberry-pi-5.",
      "No fresh-operator field-laptop rehearsal closeout with setup, acceptance, export, replay, and shutdown timestamps is present.",
      "No real serial/UDP MAVLink source has been captured on bench hardware.",
      "No real ROS 2 pose, map, detection, LiDAR, or costmap topics have been captured on bench hardware."
    ]);
    expect(manifest.nextEvidenceChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "actual-jetson-orin-nano-hardware-evidence",
        hardwareRequired: true,
        nextCommand: "npm run probe:hardware:archive -- --target jetson-orin-nano",
        runbook: "docs/EDGE_HARDWARE_BENCH.md"
      }),
      expect.objectContaining({
        id: "actual-raspberry-pi-5-hardware-evidence",
        hardwareRequired: true,
        nextCommand: "npm run probe:hardware:archive -- --target raspberry-pi-5",
        runbook: "docs/EDGE_HARDWARE_BENCH.md"
      }),
      expect.objectContaining({
        id: "fresh-operator-rehearsal",
        hardwareRequired: false,
        nextCommand: expect.stringContaining("npm run rehearsal:closeout")
      }),
      expect.objectContaining({
        id: "real-mavlink-bench",
        hardwareRequired: true,
        nextCommand: expect.stringContaining("npm run bridge:mavlink:serial")
      }),
      expect.objectContaining({
        id: "real-ros2-bench",
        hardwareRequired: true,
        nextCommand: expect.stringContaining("npm run bridge:ros2:live")
      })
    ]));
    expect(manifest.perspectiveReview).toEqual([
      expect.objectContaining({
        id: "operator",
        status: "blocked-real-world",
        gaps: expect.arrayContaining([expect.stringContaining("fresh-operator")])
      }),
      expect.objectContaining({
        id: "safety",
        status: "blocked-real-world",
        score: 8
      }),
      expect.objectContaining({
        id: "dx",
        status: "ready-local-alpha",
        gaps: expect.arrayContaining([expect.stringContaining("Source-control handoff evidence is missing")]),
        nextAction: expect.stringContaining("audit:source-control")
      }),
      expect.objectContaining({
        id: "replay",
        status: "ready-local-alpha",
        score: 9
      }),
      expect.objectContaining({
        id: "demo-readiness",
        status: "blocked-real-world",
        gaps: expect.arrayContaining([
          "Hardware archives exist, but no actual-target host-platform pass was found for: jetson-orin-nano.",
          "Hardware archives exist, but no actual-target host-platform pass was found for: raspberry-pi-5."
        ])
      })
    ]);
    expect(manifest.artifacts.hardwareEvidenceJsonPath).toContain(".tmp/hardware-evidence/");
    expect(manifest.artifacts.safetyScanJsonPath).toContain(".tmp/safety-evidence/");
    expect(manifest.artifacts.apiProbeJsonPath).toContain(".tmp/api-probe/");
    expect(manifest.artifacts.sourceControlHandoffJsonPath).toBeUndefined();
    expect(manifest.artifacts.policyGateJsonPath).toContain(".tmp/policy-evidence/");
    expect(manifest.artifacts.overnightStatusPath).toBe(".tmp/overnight/STATUS.md");
  });

  it("uses source-control handoff evidence for the DX perspective when GitHub publication is ready", async () => {
    await writeReadySourceControlHandoff(root);

    const manifest = await buildDemoReadinessPackage({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z",
      label: "alpha-demo"
    });

    const dx = manifest.perspectiveReview.find((item) => item.id === "dx");
    expect(dx).toMatchObject({
      status: "ready-local-alpha",
      gaps: [],
      strengths: expect.arrayContaining([
        expect.stringContaining("local HEAD is published to GitHub")
      ]),
      evidence: expect.arrayContaining([
        ".tmp/source-control-handoff/seekr-source-control-handoff-test.json"
      ]),
      nextAction: expect.stringContaining("Keep source-control handoff evidence current")
    });
    expect(manifest.artifacts.sourceControlHandoffJsonPath).toBe(".tmp/source-control-handoff/seekr-source-control-handoff-test.json");
    expect(manifest.artifacts.sourceControlHandoffMarkdownPath).toBe(".tmp/source-control-handoff/seekr-source-control-handoff-test.md");
  });

  it("reports a DX gap when ready source-control handoff evidence predates acceptance", async () => {
    await writeReadySourceControlHandoff(root, "2026-05-09T18:59:00.000Z");

    const manifest = await buildDemoReadinessPackage({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z",
      label: "alpha-demo"
    });

    const dx = manifest.perspectiveReview.find((item) => item.id === "dx");
    expect(manifest.status).toBe("ready-local-alpha");
    expect(dx).toMatchObject({
      status: "ready-local-alpha",
      gaps: expect.arrayContaining([
        expect.stringContaining("generated before the latest acceptance")
      ]),
      evidence: expect.arrayContaining([
        ".tmp/source-control-handoff/seekr-source-control-handoff-test.json"
      ]),
      nextAction: expect.stringContaining("audit:source-control")
    });
    expect(dx?.strengths).not.toEqual(expect.arrayContaining([
      expect.stringContaining("local HEAD is published to GitHub")
    ]));
  });

  it("writes JSON and Markdown package artifacts", async () => {
    const result = await writeDemoReadinessPackage({
      root,
      outDir: ".tmp/demo-readiness",
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}demo-readiness${path.sep}`);
    expect(result.markdownPath).toContain(`${path.sep}.tmp${path.sep}demo-readiness${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"overnightStatus\"");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"nextEvidenceChecklist\"");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"perspectiveReview\"");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Next evidence checklist");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Perspective review");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("does not validate Jetson/Pi hardware");
  });

  it("warns when the overnight status is stale", async () => {
    await writeFile(path.join(root, ".tmp/overnight/STATUS.md"), "- Last update: 2026-05-06T19:00:00Z\n- Cycle: 9\n- Verdict: pass\n", "utf8");

    const manifest = await buildDemoReadinessPackage({
      root,
      generatedAt: "2026-05-09T22:00:00.000Z"
    });

    expect(manifest.localAlphaOk).toBe(true);
    expect(manifest.overnightStatus).toMatchObject({
      verdict: "pass",
      stale: true,
      ok: true
    });
    expect(manifest.validation.warnings).toContain("Overnight-loop status is pass but older than 48 hours.");
  });

  it("blocks local-alpha packaging when acceptance and latest release disagree", async () => {
    await writeFile(path.join(root, ".tmp/release-evidence/seekr-release-0.2.0-2026-05-09T21-00-00-000Z.json"), JSON.stringify({
      commandUploadEnabled: false,
      overallSha256: "b".repeat(64),
      fileCount: 43,
      totalBytes: 123999
    }), "utf8");

    const manifest = await buildDemoReadinessPackage({
      root,
      generatedAt: "2026-05-09T22:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha");
    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.validation.blockers).toContain("Acceptance status release checksum does not match the latest release evidence.");
    expect(manifest.commandUploadEnabled).toBe(false);
  });

  it("blocks local-alpha packaging when acceptance and latest safety scan disagree", async () => {
    await writeFile(path.join(root, ".tmp/safety-evidence/seekr-command-boundary-scan-2026-05-09T21-00-00-000Z.json"), JSON.stringify({
      status: "pass",
      commandUploadEnabled: false,
      summary: {
        scannedFileCount: 109,
        violationCount: 0,
        allowedFindingCount: 37
      }
    }), "utf8");

    const manifest = await buildDemoReadinessPackage({
      root,
      generatedAt: "2026-05-09T22:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha");
    expect(manifest.localAlphaOk).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      "Acceptance status command-boundary scan path does not point at the latest safety evidence.",
      "Acceptance status command-boundary scan summary does not match the latest safety evidence."
    ]));
    expect(manifest.commandUploadEnabled).toBe(false);
  });

  it("blocks local-alpha packaging when completion audit is locally failing", async () => {
    await writeFile(path.join(root, ".tmp/completion-audit/seekr-completion-audit-2026-05-09T21-00-00-000Z.json"), JSON.stringify({
      commandUploadEnabled: false,
      localAlphaOk: false,
      complete: false,
      realWorldBlockers: []
    }), "utf8");

    const manifest = await buildDemoReadinessPackage({
      root,
      generatedAt: "2026-05-09T22:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha");
    expect(manifest.validation.blockers).toContain("Completion audit must keep commandUploadEnabled false and report localAlphaOk true.");
  });

  it("blocks local-alpha packaging when final API probe evidence is missing", async () => {
    await rm(path.join(root, ".tmp/api-probe"), { recursive: true, force: true });

    const manifest = await buildDemoReadinessPackage({
      root,
      generatedAt: "2026-05-09T22:00:00.000Z"
    });

    expect(manifest.status).toBe("blocked-local-alpha");
    expect(manifest.validation.blockers).toContain("API probe evidence is missing.");
  });
});

async function seedPackageEvidence(root: string) {
  const releaseChecksum = "a".repeat(64);
  const releasePath = ".tmp/release-evidence/seekr-release-0.2.0-2026-05-09T19-00-00-000Z.json";
  const safetyPath = ".tmp/safety-evidence/seekr-command-boundary-scan-2026-05-09T19-00-00-000Z.json";
  await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
    ok: true,
    generatedAt: Date.parse("2026-05-09T19:00:00.000Z"),
    releaseChecksum: {
      jsonPath: releasePath,
      sha256Path: releasePath.replace(/\.json$/, ".sha256"),
      markdownPath: releasePath.replace(/\.json$/, ".md"),
      overallSha256: releaseChecksum,
      fileCount: 42,
      totalBytes: 123456
    },
    commandBoundaryScan: {
      jsonPath: safetyPath,
      markdownPath: safetyPath.replace(/\.json$/, ".md"),
      status: "pass",
      scannedFileCount: 108,
      violationCount: 0,
      allowedFindingCount: 36,
      commandUploadEnabled: false
    },
    commandUploadEnabled: false
  }), "utf8");
  await writeFile(path.join(root, releasePath), JSON.stringify({
    commandUploadEnabled: false,
    overallSha256: releaseChecksum,
    fileCount: 42,
    totalBytes: 123456
  }), "utf8");
  await writeFile(path.join(root, safetyPath), JSON.stringify({
    status: "pass",
    commandUploadEnabled: false,
    summary: {
      scannedFileCount: 108,
      violationCount: 0,
      allowedFindingCount: 36
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/api-probe/seekr-api-probe-2026-05-09T19-00-00-000Z.json"), JSON.stringify({
    ok: true,
    commandUploadEnabled: false,
    checked: ["config", "session-acceptance", "session-acceptance-evidence", "readiness", "hardware-readiness", "source-health", "verify", "replays", "malformed-json"],
    sessionAcceptance: {
      status: "pass",
      commandUploadEnabled: false,
      releaseChecksum: {
        overallSha256: releaseChecksum,
        fileCount: 42,
        totalBytes: 123456
      },
      commandBoundaryScan: {
        status: "pass",
        scannedFileCount: 108,
        violationCount: 0,
        allowedFindingCount: 36
      }
    },
    validation: { ok: true, warnings: [], blockers: [] }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/completion-audit/seekr-completion-audit-2026-05-09T19-00-00-000Z.json"), JSON.stringify({
    commandUploadEnabled: false,
    localAlphaOk: true,
    complete: false,
    items: [
      {
        id: "actual-board-hardware-evidence",
        label: "Actual Jetson/Pi hardware evidence",
        status: "blocked",
        details: "Hardware archives exist, but no actual-target host-platform pass was found for: jetson-orin-nano, raspberry-pi-5.",
        evidence: [".tmp/hardware-evidence/seekr-hardware-evidence-off-board.json"]
      },
      {
        id: "fresh-operator-rehearsal",
        label: "Fresh-operator field-laptop rehearsal",
        status: "blocked",
        details: "No fresh-operator field-laptop rehearsal closeout with setup, acceptance, export, replay, and shutdown timestamps is present.",
        evidence: [".tmp/rehearsal-notes"]
      },
      {
        id: "real-mavlink-bench",
        label: "Real read-only MAVLink bench connection",
        status: "blocked",
        details: "No real serial/UDP MAVLink source has been captured on bench hardware.",
        evidence: [".tmp/rehearsal-evidence"]
      },
      {
        id: "real-ros2-bench",
        label: "Real read-only ROS 2 bench topics",
        status: "blocked",
        details: "No real ROS 2 pose, map, detection, LiDAR, or costmap topics have been captured on bench hardware.",
        evidence: [".tmp/rehearsal-evidence"]
      },
      {
        id: "adapter-command-boundary",
        label: "Read-only adapter command boundary",
        status: "pass",
        details: "Adapters reject commands.",
        evidence: ["src/server/adapters/mavlinkAdapter.ts"]
      }
    ],
    realWorldBlockers: [
      "No actual Jetson/Pi hardware evidence.",
      "No real read-only MAVLink/ROS bench evidence."
    ]
  }), "utf8");
  await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-off-board.json"), JSON.stringify({
    commandUploadEnabled: false,
    actualHardwareValidationComplete: false
  }), "utf8");
  await writeFile(path.join(root, ".tmp/policy-evidence/seekr-hardware-actuation-gate-blocked.json"), JSON.stringify({
    commandUploadEnabled: false,
    status: "blocked",
    authorization: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/overnight/STATUS.md"), "- Last update: 2026-05-09T19:30:00Z\n- Cycle: 12\n- Verdict: pass\n", "utf8");
}

async function writeReadySourceControlHandoff(root: string, generatedAt = "2026-05-09T19:30:00.000Z") {
  const sourceControlPath = ".tmp/source-control-handoff/seekr-source-control-handoff-test.json";
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    status: "ready-source-control-handoff",
    ready: true,
    commandUploadEnabled: false,
    repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    packageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
    gitMetadataPath: "../.git",
    localBranch: "main",
    localHeadSha: "a".repeat(40),
    remoteDefaultBranchSha: "a".repeat(40),
    workingTreeStatusLineCount: 0,
    configuredRemoteUrls: ["https://github.com/Ayush1298567/SEEKR.git"],
    remoteDefaultBranch: "main",
    remoteRefCount: 1,
    blockedCheckCount: 0,
    warningCheckCount: 0,
    checks: [
      { id: "repository-reference", status: "pass", details: "Repository reference present.", evidence: ["package.json"] },
      { id: "github-landing-readme", status: "pass", details: "GitHub landing README has a fresh clone path.", evidence: ["../README.md"] },
      { id: "local-git-metadata", status: "pass", details: "Git metadata present.", evidence: ["../.git"] },
      { id: "configured-github-remote", status: "pass", details: "GitHub remote configured.", evidence: ["origin"] },
      { id: "github-remote-refs", status: "pass", details: "GitHub refs available.", evidence: ["refs/heads/main"] },
      { id: "local-head-published", status: "pass", details: "Local HEAD is published.", evidence: ["origin/main"] },
      { id: "working-tree-clean", status: "pass", details: "Working tree is clean.", evidence: ["git status --short"] }
    ],
    nextActionChecklist: [
      {
        id: "rerun-source-control-audit",
        status: "verification",
        details: "Rerun source-control audit after future commits.",
        commands: ["npm run audit:source-control"],
        clearsCheckIds: ["repository-reference", "github-landing-readme", "local-git-metadata", "configured-github-remote", "github-remote-refs", "local-head-published", "working-tree-clean"]
      }
    ],
    limitations: [
      "This audit does not initialize Git, commit files, push branches, or change GitHub settings.",
      "Source-control handoff is separate from aircraft hardware readiness.",
      "Command upload and hardware actuation remain disabled."
    ]
  };
  await writeFile(path.join(root, sourceControlPath), JSON.stringify(manifest), "utf8");
  await writeFile(path.join(root, sourceControlPath.replace(/\.json$/, ".md")), "# Source Control Handoff\n", "utf8");
}
