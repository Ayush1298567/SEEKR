import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSourceControlHandoff, validateSourceControlHandoffManifest, writeSourceControlHandoff } from "../../../scripts/source-control-handoff";

const LOCAL_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REMOTE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FRESH_CLONE_PATHS = [
  "README.md",
  "software/package.json",
  "software/package-lock.json",
  "software/.env.example",
  "software/scripts/rehearsal-start.sh",
  "software/docs/OPERATOR_QUICKSTART.md"
];

describe("source-control handoff audit", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-source-control-test-${process.pid}-${Date.now()}`, "software");
    await seedSourceControlProject(root);
  });

  afterEach(async () => {
    await rm(path.dirname(root), { recursive: true, force: true });
  });

  it("passes when local git metadata and GitHub remote refs are present", async () => {
    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      status: "ready-source-control-handoff",
      ready: true,
      commandUploadEnabled: false,
      repositoryUrl: "https://github.com/Ayush1298567/SEEKR",
      gitMetadataPath: ".git",
      localBranch: "main",
      localHeadSha: LOCAL_SHA,
      remoteDefaultBranch: "main",
      remoteDefaultBranchSha: LOCAL_SHA,
      remoteRefCount: 1,
      workingTreeStatusLineCount: 0,
      blockedCheckCount: 0,
      warningCheckCount: 0,
      nextActionChecklist: [
        expect.objectContaining({
          id: "verify-source-control-before-bundle",
          status: "verification",
          commands: expect.arrayContaining(["npm run audit:source-control"])
        })
      ]
    });
    expect(manifest.checks.every((check) => check.status === "pass")).toBe(true);
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")?.details).toContain("ordered fenced shell command lines");
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")?.evidence).toContain("github-landing-readme-command-order");
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")?.evidence).toContain("github-landing-readme-ai-readiness-proof");
    expect(manifest.checks.find((check) => check.id === "fresh-clone-smoke")?.details).toContain("npm ci --dry-run");
    expect(manifest.checks.find((check) => check.id === "fresh-clone-smoke")?.details).toContain("operator quickstart contract");
    expect(manifest.checks.find((check) => check.id === "fresh-clone-smoke")?.evidence).toContain("fresh-clone-operator-quickstart-contract");
  });

  it("blocks when local HEAD is unpublished or the worktree is dirty", async () => {
    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: " M software/README.md\n?? software/scripts/new-audit.ts\n"
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${REMOTE_SHA}\tHEAD`,
          `${REMOTE_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(REMOTE_SHA)
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(2);
    expect(manifest.warningCheckCount).toBe(0);
    expect(manifest.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "local-head-published",
        status: "blocked",
        details: expect.stringContaining("does not match")
      }),
      expect.objectContaining({
        id: "working-tree-clean",
        status: "blocked",
        details: expect.stringContaining("2 uncommitted")
      })
    ]));
    expect(manifest.nextActionChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "review-and-clear-local-worktree",
        clearsCheckIds: expect.arrayContaining(["working-tree-clean"])
      }),
      expect.objectContaining({
        id: "publish-current-local-head",
        commands: expect.arrayContaining(["git push origin HEAD:main"]),
        clearsCheckIds: expect.arrayContaining(["local-head-published"])
      })
    ]));
  });

  it("blocks when local git metadata is absent and the GitHub repo has no refs", async () => {
    await rm(path.join(root, ".git"), { recursive: true, force: true });

    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      lsRemote: async () => ({ ok: true, output: "" }),
      freshClone: freshCloneOk()
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.blockedCheckCount).toBe(2);
    expect(manifest.warningCheckCount).toBe(3);
    expect(manifest.nextActionChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "restore-or-initialize-local-git",
        commands: expect.arrayContaining(["git init"]),
        clearsCheckIds: expect.arrayContaining(["local-git-metadata"])
      }),
      expect.objectContaining({
        id: "configure-github-origin",
        clearsCheckIds: expect.arrayContaining(["configured-github-remote"])
      }),
      expect.objectContaining({
        id: "publish-reviewed-main",
        commands: expect.arrayContaining(["git push -u origin main"]),
        clearsCheckIds: expect.arrayContaining(["github-remote-refs"])
      }),
      expect.objectContaining({
        id: "rerun-source-control-audit",
        commands: expect.arrayContaining(["npm run audit:source-control"])
      })
    ]));
    expect(manifest.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "local-git-metadata",
        status: "blocked",
        details: expect.stringContaining("not a Git worktree")
      }),
      expect.objectContaining({
        id: "github-remote-refs",
        status: "blocked",
        details: expect.stringContaining("no published refs/default branch")
      })
    ]));
  });

  it("blocks when the GitHub landing README omits the fresh-clone operator path", async () => {
    await writeFile(path.join(root, "..", "README.md"), "SEEKR source-control handoff: https://github.com/Ayush1298567/SEEKR\n", "utf8");

    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("git clone")
    });
    expect(manifest.nextActionChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "repair-github-landing-readme",
        commands: expect.arrayContaining(["npm run test -- operatorQuickstartContract acceptanceScripts"]),
        clearsCheckIds: expect.arrayContaining(["github-landing-readme"])
      })
    ]));
  });

  it("blocks when the GitHub landing README starts before setup and source-control audit", async () => {
    await writeFile(path.join(root, "..", "README.md"), [
      "# SEEKR",
      "",
      "```bash",
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "npm ci",
      "npm run rehearsal:start",
      "npm run smoke:rehearsal:start",
      "npm run setup:local",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run test:ai:local",
      "npm run audit:plug-and-play",
      "```",
      "",
      "If the repository is already cloned, run git pull --ff-only first.",
      "The local plug-and-play path keeps command upload and hardware actuation disabled.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("fenced shell command line order")
    });
    expect(manifest.nextActionChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "repair-github-landing-readme",
        commands: expect.arrayContaining(["npm run test -- operatorQuickstartContract acceptanceScripts"]),
        clearsCheckIds: expect.arrayContaining(["github-landing-readme"])
      })
    ]));
  });

  it("blocks when the GitHub landing README omits final AI and plug-and-play proof commands", async () => {
    await writeFile(path.join(root, "..", "README.md"), [
      "# SEEKR",
      "",
      "```bash",
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "npm ci",
      "npm run setup:local",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run rehearsal:start",
      "npm run smoke:rehearsal:start",
      "```",
      "",
      "If the repository is already cloned, run git pull --ff-only first.",
      "The local plug-and-play path keeps command upload and hardware actuation disabled.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("npm run test:ai:local")
    });
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")?.details).toContain("npm run audit:plug-and-play");
  });

  it("blocks when the GitHub landing README does not explicitly keep command authority disabled", async () => {
    await writeFile(path.join(root, "..", "README.md"), [
      "# SEEKR",
      "",
      "```bash",
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "npm ci",
      "npm run setup:local",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run rehearsal:start",
      "npm run smoke:rehearsal:start",
      "npm run test:ai:local",
      "npm run audit:plug-and-play",
      "```",
      "",
      "If the repository is already cloned, run git pull --ff-only first.",
      "The local plug-and-play path can enable command upload and hardware actuation after the audit.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("must state non-negated command upload disabled")
    });
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")?.details).toContain("must state non-negated hardware actuation disabled");
  });

  it("blocks when the GitHub landing README negates disabled command authority wording", async () => {
    await writeFile(path.join(root, "..", "README.md"), [
      "# SEEKR",
      "",
      "```bash",
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "npm ci",
      "npm run setup:local",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run rehearsal:start",
      "npm run smoke:rehearsal:start",
      "npm run test:ai:local",
      "npm run audit:plug-and-play",
      "```",
      "",
      "If the repository is already cloned, run git pull --ff-only first.",
      "The local plug-and-play path says command upload is not disabled and hardware actuation is not locked.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("must state non-negated command upload disabled")
    });
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")?.details).toContain("must state non-negated hardware actuation disabled");
  });

  it("blocks when the GitHub landing README runs plug-and-play audit before strict local AI proof", async () => {
    await writeFile(path.join(root, "..", "README.md"), [
      "# SEEKR",
      "",
      "```bash",
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "npm ci",
      "npm run setup:local",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run rehearsal:start",
      "npm run smoke:rehearsal:start",
      "npm run audit:plug-and-play",
      "npm run test:ai:local",
      "```",
      "",
      "If the repository is already cloned, run git pull --ff-only first.",
      "The local plug-and-play path keeps command upload and hardware actuation disabled.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("npm run test:ai:local before npm run audit:plug-and-play")
    });
  });

  it("does not let prose hide reversed GitHub landing command blocks", async () => {
    await writeFile(path.join(root, "..", "README.md"), [
      "# SEEKR",
      "",
      "Run `git pull --ff-only` before working from an existing clone.",
      "For final proof, `npm run test:ai:local` must happen before `npm run audit:plug-and-play`.",
      "",
      "```bash",
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "npm ci",
      "npm run setup:local",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run rehearsal:start",
      "npm run smoke:rehearsal:start",
      "npm run audit:plug-and-play",
      "npm run test:ai:local",
      "```",
      "",
      "The local plug-and-play path keeps command upload and hardware actuation disabled.",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("fenced shell command line order")
    });
  });

  it("does not let shell comments satisfy GitHub landing command proof", async () => {
    await writeFile(path.join(root, "..", "README.md"), [
      "# SEEKR",
      "",
      "Run `git pull --ff-only` before working from an existing clone.",
      "The local plug-and-play path keeps command upload and hardware actuation disabled.",
      "",
      "```bash",
      "git clone https://github.com/Ayush1298567/SEEKR.git",
      "cd SEEKR/software",
      "npm ci",
      "npm run setup:local",
      "npm run audit:source-control",
      "npm run doctor",
      "npm run rehearsal:start",
      "npm run smoke:rehearsal:start",
      "# npm run test:ai:local",
      "# npm run audit:plug-and-play",
      "```",
      ""
    ].join("\n"), "utf8");

    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "github-landing-readme")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("fenced shell command line order")
    });
  });

  it("warns instead of pretending remote refs were checked when ls-remote fails", async () => {
    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: false,
        output: "",
        error: "network unavailable"
      }),
      freshClone: async () => ({
        ok: false,
        cloneSucceeded: false,
        checkedPaths: FRESH_CLONE_PATHS,
        missingPaths: FRESH_CLONE_PATHS,
        error: "network unavailable"
      })
    });

    expect(manifest.ready).toBe(true);
    expect(manifest.status).toBe("ready-source-control-handoff-with-warnings");
    expect(manifest.warningCheckCount).toBe(3);
    expect(manifest.checks.find((check) => check.id === "github-remote-refs")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("network unavailable")
    });
    expect(manifest.checks.find((check) => check.id === "local-head-published")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("could not be proven")
    });
    expect(manifest.checks.find((check) => check.id === "fresh-clone-smoke")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("network unavailable")
    });
  });

  it("blocks when the published fresh clone is missing plug-and-play files", async () => {
    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: async () => ({
        ok: false,
        cloneSucceeded: true,
        headSha: LOCAL_SHA,
        checkedPaths: FRESH_CLONE_PATHS,
        missingPaths: ["software/package-lock.json", "software/docs/OPERATOR_QUICKSTART.md"],
        installDryRunOk: false,
        installDryRunError: "Skipped npm ci --dry-run because required fresh-clone files are missing."
      })
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "fresh-clone-smoke")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("software/package-lock.json")
    });
    expect(manifest.checks.find((check) => check.id === "fresh-clone-smoke")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("software/docs/OPERATOR_QUICKSTART.md")
    });
    expect(manifest.nextActionChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "repair-published-fresh-clone",
        commands: expect.arrayContaining(["git push origin HEAD:main"]),
        clearsCheckIds: expect.arrayContaining(["fresh-clone-smoke"])
      })
    ]));
  });

  it("blocks when the published fresh clone cannot satisfy npm ci dry-run", async () => {
    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: async () => ({
        ok: false,
        cloneSucceeded: true,
        headSha: LOCAL_SHA,
        checkedPaths: FRESH_CLONE_PATHS,
        missingPaths: [],
        installDryRunOk: false,
        installDryRunError: "package.json and package-lock.json are not in sync"
      })
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "fresh-clone-smoke")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("npm ci --dry-run")
    });
    expect(manifest.nextActionChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "repair-published-fresh-clone",
        commands: expect.arrayContaining(["npm run audit:source-control"]),
        clearsCheckIds: expect.arrayContaining(["fresh-clone-smoke"])
      })
    ]));
  });

  it("blocks when the published fresh clone has an invalid operator quickstart", async () => {
    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\tHEAD`,
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: async () => ({
        ok: false,
        cloneSucceeded: true,
        headSha: LOCAL_SHA,
        checkedPaths: FRESH_CLONE_PATHS,
        missingPaths: [],
        installDryRunOk: true,
        operatorQuickstartProblems: ["npm run smoke:rehearsal:start"]
      })
    });

    expect(manifest.ready).toBe(false);
    expect(manifest.status).toBe("blocked-source-control-handoff");
    expect(manifest.blockedCheckCount).toBe(1);
    expect(manifest.checks.find((check) => check.id === "fresh-clone-smoke")).toMatchObject({
      status: "blocked",
      details: expect.stringContaining("operator quickstart")
    });
    expect(manifest.checks.find((check) => check.id === "fresh-clone-smoke")?.details).toContain("npm run smoke:rehearsal:start");
    expect(manifest.nextActionChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "repair-published-fresh-clone",
        commands: expect.arrayContaining(["npm run test -- operatorQuickstartContract sourceControlHandoff acceptanceScripts"]),
        clearsCheckIds: expect.arrayContaining(["fresh-clone-smoke"])
      })
    ]));
  });


  it("writes JSON and Markdown evidence without enabling commands", async () => {
    const result = await writeSourceControlHandoff({
      root,
      outDir: ".tmp/source-control-handoff",
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({ ok: true, output: "" }),
      freshClone: freshCloneOk()
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}source-control-handoff${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR Source-Control Handoff");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Publication Next Steps");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("does not initialize Git");
  });

  it("validates source-control handoff artifacts semantically", async () => {
    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      git: gitMock({
        branch: "main",
        headSha: LOCAL_SHA,
        status: ""
      }),
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          `${LOCAL_SHA}\trefs/heads/main`,
          ""
        ].join("\n")
      }),
      freshClone: freshCloneOk(LOCAL_SHA)
    });

    expect(validateSourceControlHandoffManifest(manifest)).toMatchObject({
      ok: true,
      blockedCheckIds: [],
      warningCheckIds: [],
      ready: true
    });
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      commandUploadEnabled: true
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("commandUploadEnabled")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      blockedCheckCount: 1
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("blockedCheckCount")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      nextActionChecklist: []
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("nextActionChecklist")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      remoteDefaultBranchSha: REMOTE_SHA
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("localHeadSha equal remoteDefaultBranchSha")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      remoteRefCount: 0
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("at least one GitHub remote ref")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      remoteDefaultBranch: undefined
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("remoteDefaultBranch")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      configuredRemoteUrls: ["https://github.com/example/not-seekr.git"]
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("configured remote pointing at Ayush1298567/SEEKR")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      checks: manifest.checks.map((check) => check.id === "github-landing-readme"
        ? {
          ...check,
          evidence: ["../README.md", "github-landing-readme-command-order"]
        }
        : check)
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("final AI/readiness proof evidence")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      checks: manifest.checks.map((check) => check.id === "fresh-clone-smoke"
        ? {
          ...check,
          evidence: [
            "https://github.com/Ayush1298567/SEEKR",
            "git clone --depth 1",
            "fresh-clone:README.md"
          ]
        }
        : check)
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("fresh-clone-smoke pass")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      checks: manifest.checks.map((check) => check.id === "fresh-clone-smoke"
        ? {
          ...check,
          evidence: check.evidence.map((item) => item === "npm ci --dry-run --ignore-scripts --no-audit --fund=false --prefer-offline"
            ? "operator note says npm ci --dry-run still needs to be run"
            : item)
        }
        : check)
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("fresh-clone-smoke pass")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      checks: [
        ...manifest.checks,
        { id: "unreviewed-extra-check", status: "pass", details: "Unexpected check should not be accepted." }
      ]
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("exactly match the required source-control check IDs")
    ]));
    expect(validateSourceControlHandoffManifest({
      ...manifest,
      checks: [
        manifest.checks[1],
        manifest.checks[0],
        ...manifest.checks.slice(2)
      ]
    }).problems).toEqual(expect.arrayContaining([
      expect.stringContaining("exactly match the required source-control check IDs")
    ]));
  });
});

async function seedSourceControlProject(root: string) {
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, ".git/config"), [
    "[remote \"origin\"]",
    "\turl = git@github.com:Ayush1298567/SEEKR.git",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    repository: {
      type: "git",
      url: "git+https://github.com/Ayush1298567/SEEKR.git",
      directory: "software"
    }
  }), "utf8");
  await writeFile(path.join(root, "README.md"), "See https://github.com/Ayush1298567/SEEKR for source-control handoff.\n", "utf8");
  await writeFile(path.join(root, "..", "README.md"), [
    "# SEEKR",
    "",
    "```bash",
    "git clone https://github.com/Ayush1298567/SEEKR.git",
    "cd SEEKR/software",
    "npm ci",
    "npm run setup:local",
    "npm run audit:source-control",
    "npm run doctor",
    "npm run rehearsal:start",
    "npm run smoke:rehearsal:start",
    "npm run test:ai:local",
    "npm run audit:plug-and-play",
    "```",
    "",
    "If the repository is already cloned, run git pull --ff-only first.",
    "The local plug-and-play path keeps command upload and hardware actuation disabled.",
    ""
  ].join("\n"), "utf8");
}

function gitMock(state: { branch: string; headSha: string; status: string }) {
  return async (args: string[]) => {
    const key = args.join(" ");
    if (key === "branch --show-current") return { ok: true, stdout: `${state.branch}\n` };
    if (key === "rev-parse HEAD") return { ok: true, stdout: `${state.headSha}\n` };
    if (key === "status --porcelain --untracked-files=normal") return { ok: true, stdout: state.status };
    return { ok: false, stdout: "", error: `unexpected git args: ${key}` };
  };
}

function freshCloneOk(headSha = LOCAL_SHA) {
  return async () => ({
    ok: true,
    cloneSucceeded: true,
    headSha,
    checkedPaths: FRESH_CLONE_PATHS,
    missingPaths: [],
    installDryRunOk: true
  });
}
