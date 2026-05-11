import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPlugAndPlayDoctor, writePlugAndPlayDoctor } from "../../../scripts/plug-and-play-doctor";

describe("plug-and-play doctor", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-plug-doctor-test-${process.pid}-${Date.now()}`);
    await seedDoctorProject(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("passes local laptop startup prerequisites while keeping command upload disabled", async () => {
    const manifest = await buildPlugAndPlayDoctor({
      root,
      generatedAt: "2026-05-10T09:00:00.000Z",
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      profile: "operator-start",
      ok: true,
      status: "ready-local-start",
      commandUploadEnabled: false,
      ai: {
        provider: "ollama",
        model: "llama3.2:latest",
        status: "pass",
        availableModels: ["llama3.2:latest"]
      },
      ports: {
        api: 8787,
        client: 5173
      }
    });
    expect(manifest.summary.fail).toBe(0);
    expect(manifest.nextCommands).toContain("npm run rehearsal:start");
    expect(manifest.checks.find((check) => check.id === "runtime-dependencies")).toMatchObject({
      status: "pass",
      evidence: expect.arrayContaining(["package.json engines.node", "package.json packageManager"]),
      details: expect.stringContaining("node_modules/.bin/vite")
    });
    expect(manifest.checks.find((check) => check.id === "repository-safety")).toMatchObject({
      status: "pass",
      evidence: expect.arrayContaining([".gitignore data/", ".npmrc engine-strict=true"])
    });
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")).toMatchObject({
      status: "pass",
      details: expect.stringContaining("published local HEAD"),
      evidence: expect.arrayContaining([".tmp/source-control-handoff/seekr-source-control-handoff-test.json"])
    });
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")?.details).toContain("clean worktree");
    expect(manifest.checks.find((check) => check.id === "operator-start")).toMatchObject({
      status: "pass"
    });
    expect(manifest.checks.find((check) => check.id === "safety-boundary")).toMatchObject({
      status: "pass"
    });
  });

  it("fails when local runtime dependencies have not been installed", async () => {
    await rm(path.join(root, "package-lock.json"), { force: true });

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "runtime-dependencies")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("package-lock.json is missing")
    });
  });

  it("fails when package runtime metadata is not declared", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    delete packageJson.engines;
    delete packageJson.packageManager;
    await writeFile(path.join(root, "package.json"), JSON.stringify(packageJson), "utf8");

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "runtime-dependencies")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("package.json engines.node")
    });
  });

  it("fails when local dev server dependency binaries are missing", async () => {
    await rm(path.join(root, "node_modules/.bin/vite"), { force: true });

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "runtime-dependencies")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("node_modules/.bin/vite")
    });
  });

  it("fails when the repository safety policy is missing", async () => {
    await rm(path.join(root, ".gitignore"), { force: true });
    await rm(path.join(root, ".npmrc"), { force: true });

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "repository-safety")).toMatchObject({
      status: "fail",
      details: expect.stringContaining(".npmrc")
    });
  });

  it("fails when runtime data is not ignored for source-control handoff", async () => {
    await writeFile(path.join(root, ".gitignore"), [
      ".env",
      ".env.*",
      "!.env.example",
      "node_modules/",
      ".tmp/",
      ".gstack/",
      "dist/",
      "test-results/",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "repository-safety")).toMatchObject({
      status: "fail",
      details: expect.stringContaining(".gitignore missing data/")
    });
  });

  it("warns instead of blocking when source-control handoff has not been initialized", async () => {
    await rm(path.join(root, ".tmp/source-control-handoff"), { recursive: true, force: true });

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(true);
    expect(manifest.status).toBe("ready-local-start");
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("npm run audit:source-control")
    });
  });

  it("fails when source-control handoff evidence is unsafe", async () => {
    const sourceControlPath = path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json");
    const sourceControl = JSON.parse(await readFile(sourceControlPath, "utf8"));
    sourceControl.commandUploadEnabled = true;
    await writeFile(sourceControlPath, JSON.stringify(sourceControl), "utf8");

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "source-control-handoff")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("commandUploadEnabled must be false")
    });
  });

  it("fails when configured Ollama model is unavailable", async () => {
    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["mistral:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "local-ai")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("llama3.2:latest is not installed")
    });
  });

  it("passes when unconfigured default ports are occupied because rehearsal start can auto-select free ports", async () => {
    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async (port) => port !== 5173,
      portInspector: async (port) => port === 5173
        ? [{ command: "node", pid: 12345, cwd: "~/Ayush/Prophet/prophet-console" }]
        : []
    });

    expect(manifest.ok).toBe(true);
    expect(manifest.checks.find((check) => check.id === "local-ports")).toMatchObject({
      status: "pass",
      details: expect.stringContaining("auto-selects free local API/client ports"),
      evidence: expect.arrayContaining([
        "scripts/rehearsal-start.sh auto-selected free local API/client ports",
        "listener 12345 cwd ~/Ayush/Prophet/prophet-console"
      ])
    });
  });

  it("warns when explicitly configured local start ports are already occupied", async () => {
    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {
        SEEKR_CLIENT_PORT: "5173"
      },
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async (port) => port !== 5173
    });

    expect(manifest.ok).toBe(true);
    expect(manifest.summary.warn).toBeGreaterThanOrEqual(1);
    expect(manifest.checks.find((check) => check.id === "local-ports")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("5173")
    });
  });

  it("includes read-only listener diagnostics when occupied ports are not a healthy SEEKR instance", async () => {
    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async (port) => port !== 8787,
      portInspector: async (port) => port === 8787
        ? [{ command: "node", pid: 12345, cwd: "~/Ayush/Prophet/prophet-console" }]
        : []
    });

    expect(manifest.ok).toBe(true);
    expect(manifest.checks.find((check) => check.id === "local-ports")).toMatchObject({
      status: "pass",
      details: expect.stringContaining("node pid 12345 cwd ~/Ayush/Prophet/prophet-console"),
      evidence: expect.arrayContaining([
        "lsof -nP -iTCP:8787 -sTCP:LISTEN",
        "listener 12345 cwd ~/Ayush/Prophet/prophet-console"
      ])
    });
  });

  it("passes when occupied local ports already serve a healthy SEEKR instance", async () => {
    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaAndRunningSeekrFetch(["llama3.2:latest"]),
      portAvailable: async () => false
    });

    expect(manifest.ok).toBe(true);
    expect(manifest.checks.find((check) => check.id === "local-ports")).toMatchObject({
      status: "pass",
      details: expect.stringContaining("healthy SEEKR local instance"),
      evidence: expect.arrayContaining([
        "http://127.0.0.1:8787/api/health",
        "http://127.0.0.1:5173/"
      ])
    });
  });

  it("marks rehearsal-start smoke doctor artifacts separately from operator-start doctor artifacts", async () => {
    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {
        SEEKR_DOCTOR_PROFILE: "rehearsal-start-smoke",
        SEEKR_API_PORT: "49111",
        SEEKR_CLIENT_PORT: "49112",
        SEEKR_DATA_DIR: ".tmp/rehearsal-start-smoke/run-test/data"
      },
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest).toMatchObject({
      profile: "rehearsal-start-smoke",
      ports: {
        api: 49111,
        client: 49112
      }
    });
  });

  it("fails when unsafe local environment flags are true", async () => {
    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {
        SEEKR_COMMAND_UPLOAD_ENABLED: "true"
      },
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.checks.find((check) => check.id === "safety-boundary")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("SEEKR_COMMAND_UPLOAD_ENABLED")
    });
  });

  it("fails when the rehearsal start wrapper skips local setup", async () => {
    await writeFile(path.join(root, "scripts/rehearsal-start.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "export SEEKR_DATA_DIR=\"${SEEKR_DATA_DIR:-.tmp/rehearsal-data}\"",
      "export SEEKR_EXPECTED_SOURCES=\"${SEEKR_EXPECTED_SOURCES:-mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception}\"",
      "npm run doctor",
      "exec npm run dev",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "operator-start")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("setup:local")
    });
  });

  it("fails when the rehearsal start wrapper skips source-control handoff refresh", async () => {
    await writeFile(path.join(root, "scripts/rehearsal-start.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "export SEEKR_DATA_DIR=\"${SEEKR_DATA_DIR:-.tmp/rehearsal-data}\"",
      "export SEEKR_EXPECTED_SOURCES=\"${SEEKR_EXPECTED_SOURCES:-mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception}\"",
      "npm run setup:local",
      "npm run doctor",
      "exec npm run dev",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "operator-start")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("audit:source-control")
    });
  });

  it("fails when the rehearsal start wrapper skips the doctor preflight", async () => {
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

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "operator-start")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("must run npm run setup:local before npm run audit:source-control before npm run doctor before exec npm run dev")
    });
  });

  it("fails when the rehearsal start wrapper skips port normalization and automatic fallback", async () => {
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

    const manifest = await buildPlugAndPlayDoctor({
      root,
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(manifest.ok).toBe(false);
    expect(manifest.status).toBe("blocked-local-start");
    expect(manifest.checks.find((check) => check.id === "operator-start")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("select_free_port")
    });
  });

  it("writes JSON and Markdown doctor artifacts", async () => {
    const result = await writePlugAndPlayDoctor({
      root,
      outDir: ".tmp/plug-and-play-doctor",
      generatedAt: "2026-05-10T09:00:00.000Z",
      env: {},
      fetchImpl: mockOllamaFetch(["llama3.2:latest"]),
      portAvailable: async () => true
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}plug-and-play-doctor${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR Plug-And-Play Doctor");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("npm run rehearsal:start");
  });
});

async function seedDoctorProject(root: string) {
  await mkdir(root, { recursive: true });
  await mkdir(path.join(root, "data"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "node_modules/.bin"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, ".tmp/source-control-handoff"), { recursive: true });
  await writeFile(path.join(root, ".git/config"), [
    "[remote \"origin\"]",
    "\turl = git@github.com:Ayush1298567/SEEKR.git",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": {
        engines: {
          node: ">=20",
          npm: ">=10"
        }
      }
    }
  }), "utf8");
  await writeFile(path.join(root, "node_modules/.bin/tsx"), "#!/usr/bin/env node\n", "utf8");
  await writeFile(path.join(root, "node_modules/.bin/concurrently"), "#!/usr/bin/env node\n", "utf8");
  await writeFile(path.join(root, "node_modules/.bin/vite"), "#!/usr/bin/env node\n", "utf8");
  await writeFile(path.join(root, ".gitignore"), [
    ".env",
    ".env.*",
    "!.env.example",
    "node_modules/",
    ".tmp/",
    ".gstack/",
    "data/",
    "dist/",
    "test-results/",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, ".npmrc"), "engine-strict=true\n", "utf8");
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    packageManager: "npm@11.8.0",
    repository: {
      type: "git",
      url: "git+https://github.com/Ayush1298567/SEEKR.git",
      directory: "software"
    },
    engines: {
      node: ">=20",
      npm: ">=10"
    },
    scripts: {
      doctor: "tsx scripts/plug-and-play-doctor.ts",
      "setup:local": "tsx scripts/local-setup.ts",
      dev: "concurrently -k -n server,client -c cyan,green \"npm:server\" \"npm:client\"",
      "rehearsal:start": "bash scripts/rehearsal-start.sh",
      server: "tsx src/server/index.ts",
      client: "vite --host 127.0.0.1",
      "test:ai:local": "tsx scripts/ai-smoke.ts --require-ollama",
      "audit:source-control": "tsx scripts/source-control-handoff.ts",
      "audit:plug-and-play": "tsx scripts/plug-and-play-readiness.ts",
      acceptance: "npm run check"
    }
  }), "utf8");
  await writeFile(path.join(root, "README.md"), "Source-control reference: https://github.com/Ayush1298567/SEEKR\n", "utf8");
  await writeFile(path.join(root, ".tmp/source-control-handoff/seekr-source-control-handoff-test.json"), JSON.stringify({
    schemaVersion: 1,
    status: "ready-source-control-handoff",
    ready: true,
    commandUploadEnabled: false,
    repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
    gitMetadataPath: ".git",
    localBranch: "main",
    localHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    remoteDefaultBranchSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
  await writeFile(path.join(root, ".env.example"), [
    "PORT=8787",
    "SEEKR_API_PORT=8787",
    "SEEKR_CLIENT_PORT=5173",
    "SEEKR_DATA_DIR=data",
    "SEEKR_AI_PROVIDER=ollama",
    "SEEKR_OLLAMA_URL=http://127.0.0.1:11434",
    "SEEKR_OLLAMA_MODEL=llama3.2:latest",
      "SEEKR_OLLAMA_TIMEOUT_MS=20000",
      ""
    ].join("\n"), "utf8");
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
    "npm run audit:source-control",
    "npm run doctor",
    "exec npm run dev",
    ""
  ].join("\n"), "utf8");
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
    "fresh-clone:software/scripts/rehearsal-start.sh",
    "fresh-clone:software/docs/OPERATOR_QUICKSTART.md"
  ];
}

function mockOllamaFetch(models: string[]): typeof fetch {
  return (async () => new Response(JSON.stringify({
    models: models.map((name) => ({ name }))
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })) as typeof fetch;
}

function mockOllamaAndRunningSeekrFetch(models: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes("/api/tags")) {
      return new Response(JSON.stringify({
        models: models.map((name) => ({ name }))
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (href.includes("/api/health")) {
      return new Response(JSON.stringify({ ok: true, schemaVersion: 1, stateSeq: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("<!doctype html><html><head><title>SEEKR GCS</title></head><body><div id=\"root\"></div></body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" }
    });
  }) as typeof fetch;
}
