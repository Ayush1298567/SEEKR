import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLocalAiPrepare, localAiPrepareFreshForAcceptance, localAiPrepareManifestOk, localAiPrepareMatchesAcceptanceModel, writeLocalAiPrepare } from "../../../scripts/local-ai-prepare";

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

  it("matches prepared model evidence against acceptance strict AI model", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      generatedAt: "2026-05-11T12:01:00.000Z",
      execFileImpl: async () => ({ stdout: "success", stderr: "" })
    });
    const acceptance = {
      generatedAt: Date.parse("2026-05-11T12:00:00.000Z"),
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest"
      }
    };

    expect(localAiPrepareMatchesAcceptanceModel(manifest, acceptance)).toBe(true);
    expect(localAiPrepareFreshForAcceptance(manifest, acceptance)).toBe(true);
    expect(localAiPrepareMatchesAcceptanceModel(manifest, {
      generatedAt: Date.parse("2026-05-11T12:00:00.000Z"),
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "mistral:latest"
      }
    })).toBe(false);
    expect(localAiPrepareFreshForAcceptance({
      ...manifest,
      generatedAt: "2026-05-11T11:59:59.999Z"
    }, acceptance)).toBe(false);
  });

  it("rejects local AI prepare evidence that did not run an Ollama pull command", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      ollamaCommand: "curl",
      execFileImpl: async () => ({ stdout: "pretend model prepared", stderr: "" })
    });
    const acceptance = {
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest"
      }
    };

    expect(manifest).toMatchObject({
      ok: true,
      prepareCommand: ["curl", "pull", "llama3.2"]
    });
    expect(localAiPrepareManifestOk(manifest)).toBe(false);
    expect(localAiPrepareMatchesAcceptanceModel(manifest, acceptance)).toBe(false);
  });

  it("rejects relative lookalike Ollama executable paths in prepare evidence", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      ollamaCommand: "./tools/ollama",
      execFileImpl: async () => ({ stdout: "pretend model prepared", stderr: "" })
    });

    expect(manifest).toMatchObject({
      ok: true,
      prepareCommand: ["./tools/ollama", "pull", "llama3.2"]
    });
    expect(localAiPrepareManifestOk(manifest)).toBe(false);
  });

  it("fails closed before execution for unsafe model arguments", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      model: "--help",
      execFileImpl: async () => {
        throw new Error("should not execute unsafe model argument");
      }
    });

    expect(manifest).toMatchObject({
      ok: false,
      status: "blocked-local-ai-model",
      pullAttempted: false,
      prepareCommand: ["ollama", "pull", "--help"]
    });
    expect(manifest.checks.find((check) => check.id === "ollama-model-prep")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("unsafe Ollama model argument")
    });
    expect(localAiPrepareManifestOk(manifest)).toBe(false);
  });

  it("rejects copied local AI prepare evidence with unsafe model arguments", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      execFileImpl: async () => ({ stdout: "success", stderr: "" })
    });

    expect(localAiPrepareManifestOk({
      ...manifest,
      model: "--help",
      pullModel: "--help",
      prepareCommand: ["ollama", "pull", "--help"],
      checks: manifest.checks.map((check) => ({
        ...check,
        evidence: ["package.json scripts.ai:prepare", "ollama pull --help"]
      }))
    })).toBe(false);
    expect(localAiPrepareManifestOk({
      ...manifest,
      model: "llama3.2;rm",
      pullModel: "llama3.2;rm",
      prepareCommand: ["ollama", "pull", "llama3.2;rm"],
      checks: manifest.checks.map((check) => ({
        ...check,
        evidence: ["package.json scripts.ai:prepare", "ollama pull llama3.2;rm"]
      }))
    })).toBe(false);
    expect(localAiPrepareManifestOk({
      ...manifest,
      model: "llama3.2 latest",
      pullModel: "llama3.2 latest",
      prepareCommand: ["ollama", "pull", "llama3.2 latest"],
      checks: manifest.checks.map((check) => ({
        ...check,
        evidence: ["package.json scripts.ai:prepare", "ollama pull llama3.2 latest"]
      }))
    })).toBe(false);
  });

  it("fails closed before execution for shell-metacharacter model arguments", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      model: "llama3.2;rm",
      execFileImpl: async () => {
        throw new Error("should not execute shell-metacharacter model argument");
      }
    });

    expect(manifest).toMatchObject({
      ok: false,
      status: "blocked-local-ai-model",
      pullAttempted: false,
      prepareCommand: ["ollama", "pull", "llama3.2;rm"]
    });
    expect(manifest.checks.find((check) => check.id === "ollama-model-prep")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("unsafe Ollama model argument")
    });
  });

  it("rejects local AI prepare evidence with extra pull arguments or missing command evidence", async () => {
    const manifest = await buildLocalAiPrepare({
      root,
      execFileImpl: async () => ({ stdout: "success", stderr: "" })
    });
    const acceptance = {
      strictLocalAi: {
        ok: true,
        provider: "ollama",
        model: "llama3.2:latest"
      }
    };

    expect(localAiPrepareManifestOk({
      ...manifest,
      prepareCommand: ["ollama", "pull", "--insecure", "llama3.2"]
    })).toBe(false);
    expect(localAiPrepareManifestOk({
      ...manifest,
      checks: manifest.checks.map((check) => ({
        ...check,
        evidence: ["package.json scripts.ai:prepare"]
      }))
    })).toBe(false);
    expect(localAiPrepareMatchesAcceptanceModel({
      ...manifest,
      prepareCommand: ["ollama", "pull", "--insecure", "llama3.2"]
    }, acceptance)).toBe(false);
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
