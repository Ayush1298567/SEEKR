import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { buildPlugAndPlayReadiness, writePlugAndPlayReadiness } from "../../../scripts/plug-and-play-readiness";

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
        caseCount: 4
      },
      safetyBoundary: {
        realAircraftCommandUpload: false,
        hardwareActuationEnabled: false,
        runtimePolicyInstalled: false
      }
    });
    expect(manifest.summary.fail).toBe(0);
    expect(manifest.summary.blocked).toBe(1);
    expect(manifest.remainingRealWorldBlockers).toHaveLength(8);
    expect(manifest.remainingRealWorldBlockerCount).toBe(8);
    expect(manifest.checks.find((check) => check.id === "real-world-boundary")).toMatchObject({
      status: "blocked"
    });
  });

  it("fails when strict local AI evidence is not implemented", async () => {
    await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
      ok: true,
      commandUploadEnabled: false,
      strictLocalAi: { ok: false, provider: "rules", model: "deterministic-v1", caseCount: 0 },
      releaseChecksum: {
        jsonPath: ".tmp/release-evidence/seekr-release-test.json",
        overallSha256: "a".repeat(64)
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
      details: expect.stringContaining("must run npm run setup:local before npm run audit:source-control before npm run doctor before exec npm run dev")
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
      "npm run doctor",
      "npm run rehearsal:start",
      "```",
      "",
      "Local AI uses Ollama with llama3.2:latest for advisory proposals.",
      "",
      "Inspect /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays during rehearsal.",
      "",
      "real-world blockers remain until field evidence exists.",
      "",
      "No command upload or hardware actuation is allowed.",
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
      warningCheckCount: 1,
      checks: [
        { id: "repository-reference", status: "pass", details: "Repository reference is present." },
        { id: "local-git-metadata", status: "blocked", details: "This workspace is not a Git worktree." },
        { id: "configured-github-remote", status: "warn", details: "No local Git metadata exists." },
        { id: "github-remote-refs", status: "blocked", details: "GitHub remote has no refs." }
      ],
      nextActionChecklist: [
        { id: "restore-or-initialize-local-git", status: "required", details: "Restore or initialize local Git metadata.", commands: ["git init"], clearsCheckIds: ["local-git-metadata"] },
        { id: "configure-github-origin", status: "required", details: "Configure the GitHub origin remote.", commands: ["git remote add origin git@github.com:Ayush1298567/SEEKR.git"], clearsCheckIds: ["configured-github-remote"] },
        { id: "publish-reviewed-main", status: "required", details: "Publish the reviewed main branch.", commands: ["git push -u origin main"], clearsCheckIds: ["github-remote-refs"] },
        { id: "rerun-source-control-audit", status: "verification", details: "Rerun the source-control audit after publication.", commands: ["npm run audit:source-control"], clearsCheckIds: ["repository-reference", "local-git-metadata", "configured-github-remote", "github-remote-refs"] }
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

  it("allows plug-and-play readiness when only soft operator doctor checks are warnings", async () => {
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
    expect(manifest.checks.find((check) => check.id === "operator-doctor")).toMatchObject({
      status: "pass"
    });
  });

  it("fails when review bundle verification points at stale workflow evidence", async () => {
    await writeFile(path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-zz-newer.json"), JSON.stringify({
      status: "pass-with-limitations",
      commandUploadEnabled: false,
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

  it("fails when review bundle verification points at stale source-control handoff evidence", async () => {
    await writeFile(path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-zz-newer.json"), JSON.stringify({
      schemaVersion: 1,
      status: "ready-source-control-handoff",
      ready: true,
      commandUploadEnabled: false,
      repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
      configuredRemoteUrls: ["git@github.com:Ayush1298567/SEEKR.git"],
      remoteRefCount: 1,
      blockedCheckCount: 0,
      warningCheckCount: 0,
      checks: [
        { id: "repository-reference", status: "pass", details: "Repository reference is present." },
        { id: "local-git-metadata", status: "pass", details: "Local Git metadata is present." },
        { id: "configured-github-remote", status: "pass", details: "GitHub remote is configured." },
        { id: "github-remote-refs", status: "pass", details: "Remote refs are present." }
      ],
      nextActionChecklist: [
        {
          id: "verify-source-control-before-bundle",
          status: "verification",
          details: "Rerun the read-only audit before final bundling to keep source-control evidence current.",
          commands: ["npm run audit:source-control"],
          clearsCheckIds: ["repository-reference", "local-git-metadata", "configured-github-remote", "github-remote-refs"]
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
      details: expect.stringContaining("latest plug-and-play doctor")
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
      checks: ["wrapper-started", "api-health", "client-shell", "runtime-config", "source-health", "readiness", "shutdown"].map((id) => ({
        id,
        status: "pass",
        details: `${id} passed.`
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
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Remaining real-world blockers");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Count: 8");
  });
});

async function seedPlugAndPlayEvidence(root: string) {
  await mkdir(path.join(root, ".tmp/release-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/api-probe"), { recursive: true });
  await mkdir(path.join(root, ".tmp/completion-audit"), { recursive: true });
  await mkdir(path.join(root, ".tmp/plug-and-play-setup"), { recursive: true });
  await mkdir(path.join(root, ".tmp/plug-and-play-doctor"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-start-smoke"), { recursive: true });
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
    "npm ci",
    "npm run setup:local",
    "npm run audit:source-control",
    "npm run doctor",
    "npm run rehearsal:start",
    "npm run smoke:rehearsal:start",
    "```",
    "",
    "Local AI uses Ollama with llama3.2:latest for advisory proposals.",
    "",
    "Inspect /api/config, /api/readiness, /api/source-health, /api/verify, and /api/replays during rehearsal.",
    "",
    "real-world blockers remain until field evidence exists.",
    "",
    "No command upload or hardware actuation is allowed.",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "dist/index.html"), "<div id=\"root\"></div>\n", "utf8");
  await writeFile(path.join(root, ".tmp/overnight/STATUS.md"), "- Verdict: pass\n", "utf8");
  await writeFile(path.join(root, "scripts/rehearsal-start.sh"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "export SEEKR_DATA_DIR=\"${SEEKR_DATA_DIR:-.tmp/rehearsal-data}\"",
    "export SEEKR_EXPECTED_SOURCES=\"${SEEKR_EXPECTED_SOURCES:-mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception}\"",
    "npm run setup:local",
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
  await seedEnvLoaderFiles(root);
  await seedSetupFiles(root);
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
    commandUploadEnabled: false,
    strictLocalAi: {
      ok: true,
      provider: "ollama",
      model: "llama3.2:latest",
      caseCount: 4
    },
    releaseChecksum: {
      jsonPath: releasePath,
      overallSha256: "a".repeat(64)
    }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/api-probe/seekr-api-probe-test.json"), JSON.stringify({
    ok: true,
    commandUploadEnabled: false,
    checked: ["config", "session-acceptance", "session-acceptance-evidence", "readiness", "verify", "replays", "malformed-json"]
  }), "utf8");
  await writeFile(path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json"), JSON.stringify({
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
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
      {
        id: "hardware-actuation-policy-review",
        status: "blocked",
        details: "No reviewed hardware-actuation policy package exists, and runtime command authority remains disabled with false authorization fields."
      }
    ],
    realWorldBlockers: [
      "Fresh-operator field-laptop rehearsal is not completed in this session.",
      "No actual Jetson Orin Nano hardware readiness archive is present.",
      "No actual Raspberry Pi 5 hardware readiness archive is present.",
      "No real read-only MAVLink serial/UDP bench telemetry source has been validated.",
      "No real read-only ROS 2 /map, pose, detection, LiDAR, or costmap topic bridge has been validated.",
      "No HIL failsafe/manual override logs from a real bench run are present.",
      "No Isaac Sim to Jetson capture from a real bench run is archived.",
      "No reviewed hardware-actuation policy package exists, and runtime command authority remains disabled."
    ]
  }), "utf8");
  await writeFile(path.join(root, ".tmp/gstack-workflow-status/seekr-gstack-workflow-status-test.json"), JSON.stringify({
    status: "pass-with-limitations",
    commandUploadEnabled: false,
    healthHistory: { status: "pass" },
    qaReport: {
      status: "pass",
      path: ".gstack/qa-reports/seekr-qa-test.md",
      screenshotPaths: [
        ".gstack/qa-reports/screenshots/seekr-qa-test-home.png",
        ".gstack/qa-reports/screenshots/seekr-qa-test-mobile.png"
      ]
    }
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
    plugAndPlaySetupPath: ".tmp/plug-and-play-setup/seekr-local-setup-test.json",
    plugAndPlayDoctorPath: ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json",
    rehearsalStartSmokePath: ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json",
    operatorQuickstartPath: "docs/OPERATOR_QUICKSTART.md",
    checkedFileCount: 6,
    secretScan: {
      status: "pass",
      expectedFileCount: 6,
      scannedFileCount: 6,
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
    }
  }), "utf8");
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
    "const checks = ['runtime-dependencies', 'repository-safety', 'source-control-handoff', 'packageManager', 'engines.node', '.npmrc', 'node_modules/.bin/concurrently', 'node_modules/.bin/vite', 'local-ai', 'local-ports'];",
    "const disabled = process.env.SEEKR_COMMAND_UPLOAD_ENABLED;",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "src/server/__tests__/plugAndPlayDoctor.test.ts"), [
    "it('fails when local runtime dependencies have not been installed', () => {});",
    "it('fails when the repository safety policy is missing', () => {});",
    "it('fails when configured Ollama model is unavailable', () => {});",
    "it('warns when local start ports are already occupied', () => {});",
    "it('fails when unsafe local environment flags are true', () => {});",
    "it('fails when the rehearsal start wrapper skips the doctor preflight', () => {});",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-test.json"), JSON.stringify({
    ok: true,
    generatedAt: "2026-05-10T07:01:00.000Z",
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
      : { id, status: "pass", details: `${id} passed.` })
  }), "utf8");
  await writeFile(path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json"), JSON.stringify({
    schemaVersion: 1,
    status: "ready-source-control-handoff",
    ready: true,
    commandUploadEnabled: false,
    repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    gitMetadataPath: ".git",
    configuredRemoteUrls: ["git@github.com:Ayush1298567/SEEKR.git"],
    remoteDefaultBranch: "main",
    remoteRefCount: 1,
    blockedCheckCount: 0,
    warningCheckCount: 0,
    checks: [
      { id: "repository-reference", status: "pass", details: "Repository reference is present." },
      { id: "local-git-metadata", status: "pass", details: "Local Git metadata is present." },
      { id: "configured-github-remote", status: "pass", details: "GitHub remote is configured." },
      { id: "github-remote-refs", status: "pass", details: "Remote refs are present." }
    ],
    nextActionChecklist: [
      {
        id: "verify-source-control-before-bundle",
        status: "verification",
        details: "Rerun the read-only audit before final bundling to keep source-control evidence current.",
        commands: ["npm run audit:source-control"],
        clearsCheckIds: ["repository-reference", "local-git-metadata", "configured-github-remote", "github-remote-refs"]
      }
    ],
    limitations: [
      "This audit is read-only and does not initialize Git, commit files, push branches, or change GitHub settings.",
      "Source-control handoff status is separate from aircraft hardware readiness.",
      "Real command upload and hardware actuation remain disabled."
    ]
  }), "utf8");
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
