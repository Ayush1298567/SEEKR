import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSourceControlHandoff, validateSourceControlHandoffManifest, writeSourceControlHandoff } from "../../../scripts/source-control-handoff";

describe("source-control handoff audit", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-source-control-test-${process.pid}-${Date.now()}`);
    await seedSourceControlProject(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("passes when local git metadata and GitHub remote refs are present", async () => {
    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tHEAD",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main",
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
      remoteDefaultBranch: "main",
      remoteRefCount: 1,
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
    expect(manifest.warningCheckCount).toBe(1);
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

  it("warns instead of pretending remote refs were checked when ls-remote fails", async () => {
    const manifest = await buildSourceControlHandoff({
      root,
      generatedAt: "2026-05-10T19:00:00.000Z",
      lsRemote: async () => ({
        ok: false,
        output: "",
        error: "network unavailable"
      })
    });

    expect(manifest.ready).toBe(true);
    expect(manifest.status).toBe("ready-source-control-handoff-with-warnings");
    expect(manifest.checks.find((check) => check.id === "github-remote-refs")).toMatchObject({
      status: "warn",
      details: expect.stringContaining("network unavailable")
    });
  });

  it("writes JSON and Markdown evidence without enabling commands", async () => {
    const result = await writeSourceControlHandoff({
      root,
      outDir: ".tmp/source-control-handoff",
      generatedAt: "2026-05-10T19:00:00.000Z",
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
      lsRemote: async () => ({
        ok: true,
        output: [
          "ref: refs/heads/main\tHEAD",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main",
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
}
