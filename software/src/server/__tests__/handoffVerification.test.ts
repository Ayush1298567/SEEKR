import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHandoffVerification, writeHandoffVerification } from "../../../scripts/handoff-verify";

describe("handoff verification", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-handoff-verify-test-${process.pid}-${Date.now()}`);
    await mkdir(path.join(root, ".tmp/handoff-index"), { recursive: true });
    await mkdir(path.join(root, ".tmp/demo-readiness"), { recursive: true });
    await mkdir(path.join(root, ".tmp/bench-evidence-packet"), { recursive: true });
    await seedVerifiedHandoff(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("verifies linked handoff artifact digests without claiming completion", async () => {
    const manifest = await buildHandoffVerification({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      status: "pass",
      commandUploadEnabled: false,
      indexPath,
      indexLocalAlphaOk: true,
      indexComplete: false,
      digestCount: 3,
      safetyBoundary: {
        realAircraftCommandUpload: false,
        hardwareActuationEnabled: false,
        runtimePolicyInstalled: false
      },
      validation: {
        ok: true,
        blockers: []
      }
    });
    expect(manifest.validation.warnings).toContain("Handoff index is local-alpha ready but still incomplete on real-world evidence.");
    expect(manifest.digests.every((digest) => digest.status === "pass")).toBe(true);
  });

  it("writes JSON and Markdown verification artifacts", async () => {
    const result = await writeHandoffVerification({
      root,
      outDir: ".tmp/handoff-index",
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}handoff-index${path.sep}`);
    expect(result.markdownPath).toContain(`${path.sep}.tmp${path.sep}handoff-index${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"commandUploadEnabled\": false");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"digestCount\": 3");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("SEEKR Handoff Verification");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Digest verification");
  });

  it("fails when a linked artifact no longer matches its recorded digest", async () => {
    await writeFile(path.join(root, demoPath), JSON.stringify({ changed: true }), "utf8");

    const manifest = await buildHandoffVerification({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.commandUploadEnabled).toBe(false);
    expect(manifest.validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("File bytes or SHA-256 no longer match the handoff index")
    ]));
    expect(manifest.digests.find((digest) => digest.path === demoPath)).toMatchObject({
      status: "fail"
    });
  });

  it("fails when the handoff index changes its safety boundary", async () => {
    const index = JSON.parse(await readFile(path.join(root, indexPath), "utf8"));
    index.safetyBoundary.runtimePolicyInstalled = "pending";
    await writeFile(path.join(root, indexPath), JSON.stringify(index), "utf8");

    const manifest = await buildHandoffVerification({
      root,
      generatedAt: "2026-05-09T20:00:00.000Z"
    });

    expect(manifest.status).toBe("fail");
    expect(manifest.validation.blockers).toContain("Handoff index safety boundary authorization fields must remain false.");
    expect(manifest.safetyBoundary.runtimePolicyInstalled).toBe(false);
  });
});

const indexPath = ".tmp/handoff-index/seekr-handoff-index-internal-alpha-2026-05-09T19-00-00-000Z.json";
const acceptancePath = ".tmp/acceptance-status.json";
const demoPath = ".tmp/demo-readiness/seekr-demo-readiness-internal-alpha.json";
const benchPath = ".tmp/bench-evidence-packet/seekr-bench-evidence-packet-jetson-bench.json";

async function seedVerifiedHandoff(root: string) {
  const acceptance = JSON.stringify({ ok: true, commandUploadEnabled: false });
  const demo = JSON.stringify({ status: "ready-local-alpha", commandUploadEnabled: false });
  const bench = JSON.stringify({ status: "ready-for-bench-prep", commandUploadEnabled: false });
  await writeFile(path.join(root, acceptancePath), acceptance, "utf8");
  await writeFile(path.join(root, demoPath), demo, "utf8");
  await writeFile(path.join(root, benchPath), bench, "utf8");

  await writeFile(path.join(root, indexPath), JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-09T19:00:00.000Z",
    status: "ready-local-alpha-handoff",
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false,
    validation: { ok: true, warnings: [], blockers: [] },
    safetyBoundary: {
      realAircraftCommandUpload: false,
      hardwareActuationEnabled: false,
      runtimePolicyInstalled: false
    },
    hardwareClaims: {
      jetsonOrinNanoValidated: false,
      raspberryPi5Validated: false,
      realMavlinkBenchValidated: false,
      realRos2BenchValidated: false,
      hilFailsafeValidated: false,
      isaacJetsonCaptureValidated: false,
      hardwareActuationAuthorized: false
    },
    artifactDigests: [
      digest(acceptancePath, acceptance),
      digest(demoPath, demo),
      digest(benchPath, bench)
    ]
  }), "utf8");
}

function digest(filePath: string, content: string) {
  return {
    path: filePath,
    bytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex")
  };
}
