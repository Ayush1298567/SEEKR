import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS,
  buildFreshCloneOperatorSmoke,
  freshCloneOperatorSmokeOk,
  writeFreshCloneOperatorSmoke
} from "../../../scripts/fresh-clone-operator-smoke";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("fresh clone operator smoke", () => {
  let root: string;
  let commands: string[];

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-fresh-clone-smoke-test-${process.pid}-${Date.now()}`);
    commands = [];
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("records a passing GitHub fresh-clone operator-start proof", async () => {
    const manifest = await buildFreshCloneOperatorSmoke({
      root,
      generatedAt: "2026-05-11T17:00:00.000Z",
      execFileImpl: fakeExec()
    });

    expect(manifest).toMatchObject({
      ok: true,
      status: "pass",
      commandUploadEnabled: false,
      repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
      localHeadSha: SHA,
      cloneHeadSha: SHA,
      localAiPrepareModel: "llama3.2:latest",
      sourceControlHandoffStatus: "ready-source-control-handoff",
      sourceControlHandoffLocalHeadSha: SHA,
      sourceControlHandoffRemoteDefaultBranchSha: SHA,
      plugAndPlayDoctorStatus: "ready-local-start",
      rehearsalStartSmokeStatus: "pass"
    });
    expect(manifest.checked).toEqual(REQUIRED_FRESH_CLONE_OPERATOR_SMOKE_CHECK_IDS);
    expect(freshCloneOperatorSmokeOk(manifest, {
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest"
      }
    })).toBe(true);
    expect(commands[0]).toBe("git rev-parse HEAD");
    expect(commands[1]).toContain("git clone --depth 1 https://github.com/Ayush1298567/SEEKR");
    expect(commands.slice(2)).toEqual([
      "git rev-parse HEAD",
      "npm ci --ignore-scripts --no-audit --fund=false --prefer-offline",
      "npm run smoke:rehearsal:start",
      "npm run doctor"
    ]);
  });

  it("fails closed when local AI prepare evidence does not match the acceptance model", async () => {
    const manifest = await buildFreshCloneOperatorSmoke({
      root,
      generatedAt: "2026-05-11T17:00:00.000Z",
      execFileImpl: fakeExec({ model: "llama3.1:latest" })
    });

    expect(manifest.ok).toBe(true);
    expect(freshCloneOperatorSmokeOk(manifest, {
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest"
      }
    })).toBe(false);
  });

  it("fails closed when source-control HEAD summaries are not preserved", async () => {
    const manifest = await buildFreshCloneOperatorSmoke({
      root,
      generatedAt: "2026-05-11T17:00:00.000Z",
      execFileImpl: fakeExec()
    });

    const unsafeManifest = {
      ...manifest,
      sourceControlHandoffLocalHeadSha: undefined,
      sourceControlHandoffRemoteDefaultBranchSha: undefined
    };

    expect(freshCloneOperatorSmokeOk(unsafeManifest, {
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest"
      }
    })).toBe(false);
  });

  it("writes JSON and Markdown artifacts", async () => {
    const result = await writeFreshCloneOperatorSmoke({
      root,
      generatedAt: "2026-05-11T17:00:00.000Z",
      execFileImpl: fakeExec()
    });

    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Fresh Clone Operator Smoke");
  });

  function fakeExec(options: { model?: string } = {}) {
    const model = options.model ?? "llama3.2:latest";
    return async (file: string, args: string[], commandOptions: { cwd: string }) => {
      commands.push([file, ...args].join(" "));
      if (file === "git" && args.join(" ") === "rev-parse HEAD") {
        return { stdout: `${SHA}\n`, stderr: "" };
      }
      if (file === "git" && args[0] === "clone") {
        const cloneDir = args.at(-1);
        if (!cloneDir) throw new Error("missing clone dir");
        await mkdir(path.join(cloneDir, "software"), { recursive: true });
        await writeFile(path.join(cloneDir, "software/package.json"), "{}", "utf8");
        await writeFile(path.join(cloneDir, "software/package-lock.json"), "{}", "utf8");
        return { stdout: "", stderr: "" };
      }
      if (file === "npm" && args.join(" ") === "ci --ignore-scripts --no-audit --fund=false --prefer-offline") {
        return { stdout: "", stderr: "" };
      }
      if (file === "npm" && args.join(" ") === "run smoke:rehearsal:start") {
        await seedSmokeArtifacts(commandOptions.cwd, model);
        return { stdout: "", stderr: "" };
      }
      if (file === "npm" && args.join(" ") === "run doctor") {
        await writeDoctor(commandOptions.cwd, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json");
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command ${file} ${args.join(" ")}`);
    };
  }
});

async function seedSmokeArtifacts(root: string, model: string) {
  await mkdir(path.join(root, ".tmp/plug-and-play-setup"), { recursive: true });
  await mkdir(path.join(root, ".tmp/local-ai-prepare"), { recursive: true });
  await mkdir(path.join(root, ".tmp/source-control-handoff"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-start-smoke"), { recursive: true });
  await mkdir(path.join(root, ".tmp/plug-and-play-doctor"), { recursive: true });
  await writeFile(path.join(root, ".tmp/plug-and-play-setup/seekr-local-setup-test.json"), JSON.stringify(setupArtifact()), "utf8");
  await writeFile(path.join(root, ".tmp/local-ai-prepare/seekr-local-ai-prepare-test.json"), JSON.stringify(localAiArtifact(model)), "utf8");
  await writeFile(path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json"), JSON.stringify(sourceControlArtifact()), "utf8");
  await writeFile(path.join(root, ".tmp/rehearsal-start-smoke/seekr-rehearsal-start-smoke-test.json"), JSON.stringify(rehearsalStartSmokeArtifact()), "utf8");
  await writeDoctor(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json", "smoke");
}

async function writeDoctor(root: string, sourceControlPath: string, suffix = "test") {
  await mkdir(path.join(root, ".tmp/plug-and-play-doctor"), { recursive: true });
  await writeFile(path.join(root, `.tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-${suffix}.json`), JSON.stringify(doctorArtifact(sourceControlPath)), "utf8");
}

function setupArtifact() {
  return {
    ok: true,
    status: "ready-local-setup",
    commandUploadEnabled: false,
    envFilePath: ".env",
    dataDirPath: ".tmp/rehearsal-data",
    checks: ["env-example", "env-file", "rehearsal-data-dir", "safety-boundary"].map((id) => ({ id, status: "pass" }))
  };
}

function localAiArtifact(model: string) {
  return {
    ok: true,
    status: "ready-local-ai-model",
    commandUploadEnabled: false,
    provider: "ollama",
    model,
    pullModel: model === "llama3.2:latest" ? "llama3.2" : model,
    pullAttempted: true,
    prepareCommand: ["ollama", "pull", model === "llama3.2:latest" ? "llama3.2" : model],
    checks: [
      {
        id: "ollama-model-prep",
        status: "pass",
        details: "model ready",
        evidence: ["package.json scripts.ai:prepare"]
      }
    ]
  };
}

function sourceControlArtifact() {
  return {
    schemaVersion: 1,
    generatedAt: "2026-05-11T17:00:00.000Z",
    status: "ready-source-control-handoff",
    ready: true,
    commandUploadEnabled: false,
    repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    packageRepositoryUrl: "git+https://github.com/Ayush1298567/SEEKR.git",
    configuredRemoteUrls: ["git@github.com:Ayush1298567/SEEKR.git"],
    localBranch: "main",
    remoteDefaultBranch: "main",
    remoteRefCount: 1,
    localHeadSha: SHA,
    remoteDefaultBranchSha: SHA,
    workingTreeClean: true,
    workingTreeStatusLineCount: 0,
    blockedCheckCount: 0,
    warningCheckCount: 0,
    checks: [
      { id: "repository-reference", status: "pass", details: "ok", evidence: ["package.json repository"] },
      { id: "github-landing-readme", status: "pass", details: "ok", evidence: ["../README.md", "github-landing-readme-command-order", "github-landing-readme-ai-readiness-proof"] },
      { id: "local-git-metadata", status: "pass", details: "ok", evidence: [".git"] },
      { id: "configured-github-remote", status: "pass", details: "ok", evidence: ["git@github.com:Ayush1298567/SEEKR.git"] },
      { id: "github-remote-refs", status: "pass", details: "ok", evidence: ["https://github.com/Ayush1298567/SEEKR", "git ls-remote --symref"] },
      { id: "fresh-clone-smoke", status: "pass", details: "ok", evidence: freshCloneSmokeEvidence() },
      { id: "local-head-published", status: "pass", details: "ok", evidence: [`HEAD:${SHA}`, `origin/main:${SHA}`] },
      { id: "working-tree-clean", status: "pass", details: "ok", evidence: ["git status --porcelain --untracked-files=normal"] }
    ],
    nextActionChecklist: [
      { id: "rerun-source-control-audit", status: "verification", details: "rerun", commands: ["npm run audit:source-control"], clearsCheckIds: ["repository-reference", "github-landing-readme", "local-git-metadata", "configured-github-remote", "github-remote-refs", "fresh-clone-smoke", "local-head-published", "working-tree-clean"] }
    ],
    limitations: [
      "This audit is read-only and does not initialize Git, commit files, push branches, or change GitHub settings.",
      "Source-control handoff status is separate from aircraft hardware readiness.",
      "Real command upload and hardware actuation remain disabled."
    ]
  };
}

function rehearsalStartSmokeArtifact() {
  const checked = [
    "wrapper-started",
    "setup-artifact",
    "local-ai-prepare-artifact",
    "source-control-handoff-artifact",
    "doctor-artifact",
    "api-health",
    "client-shell",
    "runtime-config",
    "source-health",
    "readiness",
    "shutdown"
  ];
  return {
    schemaVersion: 1,
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
    plugAndPlayDoctorPath: ".tmp/plug-and-play-doctor/seekr-plug-and-play-doctor-smoke.json",
    checked,
    checks: checked.map((id) => ({ id, status: "pass", details: `${id} passed.` })),
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    }
  };
}

function doctorArtifact(sourceControlPath: string) {
  return {
    ok: true,
    status: "ready-local-start",
    profile: "operator-start",
    commandUploadEnabled: false,
    ai: { provider: "ollama", model: "llama3.2:latest", status: "pass" },
    summary: { pass: 10, warn: 0, fail: 0 },
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
          details: "package.json engines.node package.json engines.npm package.json packageManager package-lock.json package-lock.json packages[\"\"].engines node_modules/.bin/tsx node_modules/.bin/concurrently node_modules/.bin/vite",
          evidence: ["package.json engines.node", "package.json engines.npm", "package.json packageManager", "package-lock.json", "package-lock.json packages[\"\"].engines", "node_modules/.bin/tsx", "node_modules/.bin/concurrently", "node_modules/.bin/vite"]
        }
      : id === "source-control-handoff"
        ? { id, status: "pass", details: sourceControlPath, evidence: [sourceControlPath] }
        : { id, status: "pass", details: `${id} passed.`, evidence: [id] })
  };
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
