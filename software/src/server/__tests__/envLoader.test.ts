import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLocalEnv, parseEnvContent } from "../env";

const managedKeys = [
  "SEEKR_AI_PROVIDER",
  "SEEKR_OLLAMA_URL",
  "SEEKR_OLLAMA_MODEL",
  "SEEKR_OLLAMA_TIMEOUT_MS",
  "SEEKR_DATA_DIR",
  "SEEKR_LOAD_DOTENV",
  "SEEKR_ENV_FILE"
];

describe("local env loader", () => {
  let root: string;
  let previous: Record<string, string | undefined>;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-env-loader-test-${process.pid}-${Date.now()}`);
    await mkdir(root, { recursive: true });
    previous = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]));
    for (const key of managedKeys) delete process.env[key];
  });

  afterEach(async () => {
    for (const key of managedKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(root, { recursive: true, force: true });
  });

  it("fills unset server AI settings from a project-local .env", async () => {
    await writeFile(path.join(root, ".env"), [
      "SEEKR_AI_PROVIDER=ollama",
      "SEEKR_OLLAMA_URL=\"http://127.0.0.1:11434\"",
      "SEEKR_OLLAMA_MODEL=llama3.2:latest",
      "SEEKR_OLLAMA_TIMEOUT_MS=20000 # local default",
      "export SEEKR_DATA_DIR=data/operator",
      ""
    ].join("\n"), "utf8");

    const result = loadLocalEnv({ root });

    expect(result).toMatchObject({
      loaded: true,
      applied: expect.arrayContaining(["SEEKR_AI_PROVIDER", "SEEKR_OLLAMA_URL", "SEEKR_OLLAMA_MODEL", "SEEKR_OLLAMA_TIMEOUT_MS", "SEEKR_DATA_DIR"])
    });
    expect(process.env.SEEKR_AI_PROVIDER).toBe("ollama");
    expect(process.env.SEEKR_OLLAMA_URL).toBe("http://127.0.0.1:11434");
    expect(process.env.SEEKR_OLLAMA_TIMEOUT_MS).toBe("20000");
    expect(process.env.SEEKR_DATA_DIR).toBe("data/operator");
  });

  it("does not override explicit environment variables", async () => {
    process.env.SEEKR_AI_PROVIDER = "rules";
    await writeFile(path.join(root, ".env"), "SEEKR_AI_PROVIDER=ollama\n", "utf8");

    const result = loadLocalEnv({ root });

    expect(result.skipped).toContain("SEEKR_AI_PROVIDER");
    expect(process.env.SEEKR_AI_PROVIDER).toBe("rules");
  });

  it("ignores env files outside the project root", async () => {
    const outside = path.join(os.tmpdir(), `seekr-outside-env-${process.pid}.env`);
    await writeFile(outside, "SEEKR_AI_PROVIDER=ollama\n", "utf8");

    const result = loadLocalEnv({ root, file: outside });

    expect(result).toMatchObject({ loaded: false, reason: "outside-root" });
    expect(process.env.SEEKR_AI_PROVIDER).toBeUndefined();
    await rm(outside, { force: true });
  });

  it("parses comments, export prefixes, and quoted values", () => {
    expect(parseEnvContent([
      "# comment",
      "export SEEKR_AI_PROVIDER=ollama",
      "SEEKR_OLLAMA_URL='http://127.0.0.1:11434'",
      "SEEKR_OLLAMA_TIMEOUT_MS=20000 # trailing comment",
      ""
    ].join("\n"))).toEqual([
      ["SEEKR_AI_PROVIDER", "ollama"],
      ["SEEKR_OLLAMA_URL", "http://127.0.0.1:11434"],
      ["SEEKR_OLLAMA_TIMEOUT_MS", "20000"]
    ]);
  });
});
