import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RELEASE_INPUTS, buildReleaseChecksumManifest, writeReleaseChecksumEvidence } from "../../../scripts/release-checksums";

describe("release checksum evidence", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-release-checksum-test-${process.pid}-${Date.now()}`);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "dist/assets"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await mkdir(path.join(root, ".tmp"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "9.9.9" }), "utf8");
    await writeFile(path.join(root, "src/index.ts"), "export const ok = true;\n", "utf8");
    await writeFile(path.join(root, "dist/index.html"), "<div id=\"root\"></div>\n", "utf8");
    await writeFile(path.join(root, "dist/assets/index.js"), "console.log('seekr');\n", "utf8");
    await writeFile(path.join(root, "docs/SAFETY.md"), "# Safety\n", "utf8");
    await writeFile(path.join(root, ".tmp/transient.txt"), "do not include\n", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds a stable manifest for release inputs without transient evidence", async () => {
    const manifest = await buildReleaseChecksumManifest({
      root,
      inputs: ["package.json", "src", "dist", "docs"],
      generatedAt: "2026-05-09T18:00:00.000Z"
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      softwareVersion: "9.9.9",
      commandUploadEnabled: false,
      safetyBoundary: {
        realHardwareCommandUpload: "blocked",
        mavlink: "read-only",
        ros2: "read-only",
        px4ArdupilotHardwareTransport: "blocked"
      }
    });
    expect(manifest.files.map((file) => file.path)).toEqual([
      "dist/assets/index.js",
      "dist/index.html",
      "docs/SAFETY.md",
      "package.json",
      "src/index.ts"
    ]);
    expect(manifest.files.some((file) => file.path.startsWith(".tmp/"))).toBe(false);
    expect(manifest.overallSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("covers repository safety files in the default release input set", () => {
    expect(DEFAULT_RELEASE_INPUTS).toEqual(expect.arrayContaining([
      ".gitignore",
      ".npmrc",
      "package.json",
      "package-lock.json"
    ]));
  });

  it("writes JSON, SHA-256, and Markdown evidence under the requested output directory", async () => {
    const result = await writeReleaseChecksumEvidence({
      root,
      outDir: ".tmp/release-evidence",
      inputs: ["package.json", "src", "dist", "docs"],
      generatedAt: "2026-05-09T18:00:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}release-evidence${path.sep}`);
    expect(result.sha256Path).toContain(`${path.sep}.tmp${path.sep}release-evidence${path.sep}`);
    expect(result.markdownPath).toContain(`${path.sep}.tmp${path.sep}release-evidence${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.sha256Path, "utf8")).resolves.toContain("SEEKR_RELEASE_OVERALL");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("does not validate Jetson/Pi hardware");
  });
});
