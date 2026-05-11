import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeLocalSetup } from "../../../scripts/local-setup";

describe("local plug-and-play setup", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-local-setup-test-${process.pid}-${Date.now()}`);
    await mkdir(root, { recursive: true });
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
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates local env and rehearsal data artifacts without enabling commands", async () => {
    const result = await writeLocalSetup({
      root,
      generatedAt: "2026-05-10T10:00:00.000Z"
    });

    expect(result.manifest).toMatchObject({
      ok: true,
      status: "ready-local-setup",
      commandUploadEnabled: false,
      envFilePath: ".env",
      envCreated: true,
      envAlreadyExisted: false,
      dataDirPath: ".tmp/rehearsal-data"
    });
    await expect(readFile(path.join(root, ".env"), "utf8")).resolves.toContain("SEEKR_AI_PROVIDER=ollama");
    const dataDir = await stat(path.join(root, ".tmp/rehearsal-data"));
    expect(dataDir.isDirectory()).toBe(true);
    expect(result.manifest.checks.find((check) => check.id === "safety-boundary")).toMatchObject({
      status: "pass"
    });
    expect(result.manifest.nextCommands).toEqual(expect.arrayContaining([
      "npm run ai:prepare",
      "npm run rehearsal:start"
    ]));
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("npm run ai:prepare");
  });

  it("does not overwrite an existing env file", async () => {
    await writeFile(path.join(root, ".env"), "SEEKR_AI_PROVIDER=ollama\nCUSTOM_KEEP=1\n", "utf8");

    const result = await writeLocalSetup({
      root,
      generatedAt: "2026-05-10T10:00:00.000Z"
    });

    expect(result.manifest).toMatchObject({
      ok: true,
      envCreated: false,
      envAlreadyExisted: true
    });
    await expect(readFile(path.join(root, ".env"), "utf8")).resolves.toContain("CUSTOM_KEEP=1");
  });

  it("blocks env output paths outside the project root", async () => {
    const result = await writeLocalSetup({
      root,
      envFile: "../outside.env",
      generatedAt: "2026-05-10T10:00:00.000Z"
    });

    expect(result.manifest).toMatchObject({
      ok: false,
      status: "blocked-local-setup",
      commandUploadEnabled: false
    });
    expect(result.manifest.checks.find((check) => check.id === "env-file")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("must stay inside the project root")
    });
  });

  it("blocks setup when env example defaults are missing", async () => {
    await writeFile(path.join(root, ".env.example"), "SEEKR_AI_PROVIDER=rules\n", "utf8");

    const result = await writeLocalSetup({
      root,
      generatedAt: "2026-05-10T10:00:00.000Z"
    });

    expect(result.manifest.ok).toBe(false);
    expect(result.manifest.checks.find((check) => check.id === "env-example")).toMatchObject({
      status: "fail",
      details: expect.stringContaining("SEEKR_AI_PROVIDER=ollama")
    });
  });
});
