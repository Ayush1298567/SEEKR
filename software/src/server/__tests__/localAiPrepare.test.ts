import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLocalAiPrepare, writeLocalAiPrepare } from "../../../scripts/local-ai-prepare";

describe("local AI model preparation", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-local-ai-prepare-test-${process.pid}-${Date.now()}`);
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs ollama pull for the default model and writes read-only evidence", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const result = await writeLocalAiPrepare({
      root,
      generatedAt: "2026-05-11T12:00:00.000Z",
      execFileImpl: async (file, args) => {
        calls.push({ file, args });
        return { stdout: "success", stderr: "" };
      }
    });

    expect(calls).toEqual([{ file: "ollama", args: ["pull", "llama3.2"] }]);
    expect(result.manifest).toMatchObject({
      ok: true,
      status: "ready-local-ai-model",
      commandUploadEnabled: false,
      provider: "ollama",
      model: "llama3.2:latest",
      pullModel: "llama3.2",
      pullAttempted: true,
      prepareCommand: ["ollama", "pull", "llama3.2"]
    });
    expect(result.manifest.nextCommands).toEqual(expect.arrayContaining([
      "npm run doctor",
      "npm run test:ai:local"
    ]));
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("ollama pull llama3.2");
  });

  it("supports custom local model preparation", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      model: "mistral:latest",
      execFileImpl: async () => ({ stdout: "pulled mistral", stderr: "" })
    });

    expect(manifest).toMatchObject({
      ok: true,
      model: "mistral:latest",
      pullModel: "mistral:latest",
      prepareCommand: ["ollama", "pull", "mistral:latest"]
    });
  });

  it("can record the required command without pulling in check-only mode", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      checkOnly: true,
      execFileImpl: async () => {
        throw new Error("should not execute");
      }
    });

    expect(manifest).toMatchObject({
      ok: true,
      status: "ready-local-ai-model",
      pullAttempted: false
    });
    expect(manifest.checks.find((check) => check.id === "ollama-model-prep")).toMatchObject({
      status: "pass",
      details: expect.stringContaining("Check-only")
    });
  });

  it("fails closed when Ollama model preparation fails", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      execFileImpl: async () => {
        const error = new Error("ollama unavailable") as Error & { stderr: string };
        error.stderr = "could not connect to Ollama";
        throw error;
      }
    });

    expect(manifest).toMatchObject({
      ok: false,
      status: "blocked-local-ai-model",
      commandUploadEnabled: false
    });
    expect(manifest.checks.find((check) => check.id === "ollama-model-prep")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("could not connect to Ollama")
    });
    expect(manifest.nextCommands).toContain("Install/start Ollama, then rerun npm run ai:prepare.");
  });
});
