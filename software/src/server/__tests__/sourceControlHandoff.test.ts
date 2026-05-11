import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSourceControlHandoff, validateSourceControlHandoffManifest, writeSourceControlHandoff } from "../../../scripts/source-control-handoff";

const LOCAL_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REMOTE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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
      })
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
      })
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
      lsRemote: async () => ({ ok: true, output: "" })
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
      })
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
      })
    });

    expect(manifest.ready).toBe(true);
    expect(manifest.status).toBe("ready-source-control-handoff-with-warnings");
    expect(manifest.warningCheckCount).toBe(2);
    expect(manifest.checks.find((check) => check.id === "github-remote-refs")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("network unavailable")
    });
    expect(manifest.checks.find((check) => check.id === "local-head-published")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("could not be proven")
    });
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
      lsRemote: async () => ({ ok: true, output: "" })
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
      })
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
