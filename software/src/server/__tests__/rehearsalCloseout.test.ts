import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRehearsalCloseout, writeRehearsalCloseout } from "../../../scripts/rehearsal-closeout";

describe("rehearsal closeout", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-rehearsal-closeout-test-${process.pid}-${Date.now()}`);
    await seedEvidence(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("marks a rehearsal complete only with filled operator fields and valid before/after evidence", async () => {
    const closeout = await buildRehearsalCloseout({
      root,
      ...filledFields()
    });

    expect(closeout).toMatchObject({
      status: "completed",
      freshOperatorCompleted: true,
      commandUploadEnabled: false,
      validation: { ok: true }
    });
    expect(closeout.validation.warnings).toContain("Latest hardware archive is not actual Jetson/Pi validation; keep the closeout scoped to local field-laptop rehearsal only.");
  });

  it("writes completed closeout JSON and Markdown evidence under .tmp", async () => {
    const result = await writeRehearsalCloseout({
      root,
      outDir: ".tmp/rehearsal-notes",
      generatedAt: "2026-05-09T22:00:00.000Z",
      ...filledFields()
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}rehearsal-notes${path.sep}`);
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"freshOperatorCompleted\": true");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Field-Laptop Rehearsal Closeout");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Command upload enabled: false");
  });

  it("blocks closeout when evidence is missing or final hash is malformed", async () => {
    const closeout = await buildRehearsalCloseout({
      root,
      ...filledFields(),
      beforeRunRehearsalEvidencePath: ".tmp/rehearsal-evidence/missing.json",
      finalStateHash: "not-a-hash"
    });

    expect(closeout.validation.ok).toBe(false);
    expect(closeout.validation.blockers).toEqual(expect.arrayContaining([
      "finalStateHash must be a 64-character SHA-256 style hex string.",
      "before-run rehearsal evidence path does not exist: .tmp/rehearsal-evidence/missing.json."
    ]));
    expect(closeout.status).toBe("blocked");
    expect(closeout.freshOperatorCompleted).toBe(false);
    expect(closeout.commandUploadEnabled).toBe(false);
  });
});

function filledFields() {
  return {
    label: "fresh operator run",
    operatorName: "Test Operator",
    machineIdentifier: "field-laptop-1",
    setupStartedAt: "2026-05-09T20:00:00Z",
    acceptanceCompletedAt: "2026-05-09T20:10:00Z",
    beforeRunRehearsalEvidencePath: ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-before.json",
    missionExportCompletedAt: "2026-05-09T20:30:00Z",
    replayId: "replay-seekr-local-v1-10",
    finalStateHash: "a".repeat(64),
    afterRunRehearsalEvidencePath: ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-after.json",
    shutdownCompletedAt: "2026-05-09T20:40:00Z",
    deviationsOrFailures: "none"
  };
}

async function seedEvidence(root: string) {
  await mkdir(path.join(root, ".tmp/release-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/completion-audit"), { recursive: true });
  await mkdir(path.join(root, ".tmp/hardware-evidence"), { recursive: true });
  await mkdir(path.join(root, ".tmp/rehearsal-evidence"), { recursive: true });
  await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
    ok: true,
    commandUploadEnabled: false
  }), "utf8");
  await writeFile(path.join(root, ".tmp/release-evidence/seekr-release-test.json"), JSON.stringify({
    commandUploadEnabled: false,
    overallSha256: "a".repeat(64)
  }), "utf8");
  await writeFile(path.join(root, ".tmp/completion-audit/seekr-completion-audit-test.json"), JSON.stringify({
    commandUploadEnabled: false,
    localAlphaOk: true
  }), "utf8");
  await writeFile(path.join(root, ".tmp/hardware-evidence/seekr-hardware-evidence-test.json"), JSON.stringify({
    commandUploadEnabled: false,
    actualHardwareValidationComplete: false,
    hardwareValidationScope: "off-board-readiness"
  }), "utf8");
  await writeFile(path.join(root, ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-before.json"), JSON.stringify({
    commandUploadEnabled: false,
    validation: { ok: true }
  }), "utf8");
  await writeFile(path.join(root, ".tmp/rehearsal-evidence/seekr-rehearsal-evidence-after.json"), JSON.stringify({
    commandUploadEnabled: false,
    validation: { ok: true }
  }), "utf8");
}
