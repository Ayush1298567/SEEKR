import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  resolveArtifactOutDir,
  resolveProjectInputPath,
  safeFileNamePart,
  safeIsoTimestampForFileName
} from "../../../scripts/artifact-paths";

describe("artifact path helpers", () => {
  it("renders ISO UTC timestamps as single filename segments", () => {
    expect(safeIsoTimestampForFileName("2026-05-10T06:56:38Z")).toBe("2026-05-10T06-56-38Z");
    expect(safeIsoTimestampForFileName("2026-05-10T06:56:38.123Z")).toBe("2026-05-10T06-56-38-123Z");
  });

  it("rejects timestamps that could steer artifact paths", () => {
    expect(() => safeIsoTimestampForFileName("2026-05-10T06:56:38Z/../../../escape")).toThrow(
      "generatedAt must be an ISO UTC timestamp"
    );
    expect(() => safeIsoTimestampForFileName("2026-05-10T06:56:38+00:00")).toThrow(
      "generatedAt must be an ISO UTC timestamp"
    );
    expect(() => safeIsoTimestampForFileName("2026-02-30T06:56:38Z")).toThrow(
      "generatedAt must be an ISO UTC timestamp"
    );
  });

  it("resolves artifact output directories only inside the project root", () => {
    const root = path.resolve("/tmp/seekr-root");

    expect(resolveArtifactOutDir(root, ".tmp/evidence")).toBe(path.join(root, ".tmp/evidence"));
    expect(() => resolveArtifactOutDir(root, "../escape")).toThrow("artifact output directory must stay inside");
    expect(() => resolveArtifactOutDir(root, "/tmp/escape")).toThrow("artifact output directory must stay inside");
  });

  it("resolves artifact input paths only inside the project root", () => {
    const root = path.resolve("/tmp/seekr-root");

    expect(resolveProjectInputPath(root, ".tmp/evidence.json")).toBe(path.join(root, ".tmp/evidence.json"));
    expect(resolveProjectInputPath(root, path.join(root, ".tmp/evidence.json"))).toBe(path.join(root, ".tmp/evidence.json"));
    expect(() => resolveProjectInputPath(root, "../escape.json")).toThrow("artifact input path must stay inside");
    expect(() => resolveProjectInputPath(root, "/tmp/escape.json")).toThrow("artifact input path must stay inside");
    expect(() => resolveProjectInputPath(root, " ")).toThrow("artifact input path is required");
  });

  it("renders caller labels as safe single filename parts", () => {
    expect(safeFileNamePart("Internal Alpha", "fallback")).toBe("internal-alpha");
    expect(safeFileNamePart("../escape", "fallback")).toBe("..-escape");
    expect(safeFileNamePart(".", "fallback")).toBe("fallback");
    expect(safeFileNamePart("..", "fallback")).toBe("fallback");
    expect(safeFileNamePart("###", "fallback")).toBe("fallback");
    expect(safeFileNamePart("###", "../bad fallback")).toBe("..-bad-fallback");
    expect(safeFileNamePart("###", "..")).toBe("artifact");
  });

  it("keeps evidence writer scripts on the shared output-directory guard", () => {
    const scriptsDir = path.resolve(__dirname, "../../../scripts");
    const writerScripts = readdirSync(scriptsDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({ name, source: readFileSync(path.join(scriptsDir, name), "utf8") }))
      .filter(({ source }) => source.includes("DEFAULT_OUT_DIR"));

    expect(writerScripts.length).toBeGreaterThan(10);
    for (const { name, source } of writerScripts) {
      expect(source, name).toContain("resolveArtifactOutDir");
      expect(source, name).not.toContain("path.resolve(root, options.outDir");
      expect(source, name).not.toContain("path.resolve(cwd, options.outDir");
    }
  });

  it("keeps evidence writer scripts on the shared filename-part sanitizer", () => {
    const scriptsDir = path.resolve(__dirname, "../../../scripts");
    const writerScripts = readdirSync(scriptsDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({ name, source: readFileSync(path.join(scriptsDir, name), "utf8") }))
      .filter(({ source }) => source.includes("safeIsoTimestampForFileName"));

    expect(writerScripts.length).toBeGreaterThan(10);
    for (const { name, source } of writerScripts) {
      expect(source, name).not.toContain("function sanitizeForFileName");
    }
  });
});
