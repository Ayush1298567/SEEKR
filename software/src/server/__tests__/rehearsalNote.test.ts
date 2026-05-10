import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRehearsalNote, writeRehearsalNote } from "../../../scripts/rehearsal-note";

describe("rehearsal note", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `seekr-rehearsal-note-test-${process.pid}-${Date.now()}`);
    await seedEvidence(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds a fill-in operator note without marking the fresh-operator rehearsal complete", async () => {
    const note = await buildRehearsalNote({
      root,
      label: "fresh operator dry run",
      operator: "Test Operator",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(note).toMatchObject({
      status: "template",
      freshOperatorCompleted: false,
      commandUploadEnabled: false,
      validation: { ok: true }
    });
    expect(note.evidence.rehearsalEvidencePaths).toHaveLength(2);
    expect(note.requiredOperatorFields).toEqual(expect.arrayContaining([
      "acceptance_completed_at",
      "mission_export_completed_at",
      "final_state_hash",
      "shutdown_completed_at"
    ]));
    expect(note.validation.warnings).toContain("Latest hardware archive is not actual Jetson/Pi validation; keep it labeled as setup/readiness evidence only.");
  });

  it("writes JSON and Markdown note artifacts under .tmp", async () => {
    const result = await writeRehearsalNote({
      root,
      outDir: ".tmp/rehearsal-notes",
      label: "alpha rehearsal",
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(result.jsonPath).toContain(`${path.sep}.tmp${path.sep}rehearsal-notes${path.sep}`);
    expect(result.markdownPath).toContain("alpha-rehearsal");
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain("\"freshOperatorCompleted\": false");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Required operator fields");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("Command upload enabled: false");
  });

  it("blocks the note when acceptance evidence is unsafe", async () => {
    await writeFile(path.join(root, ".tmp/acceptance-status.json"), JSON.stringify({
      ok: true,
      commandUploadEnabled: true
    }), "utf8");

    const note = await buildRehearsalNote({
      root,
      generatedAt: "2026-05-09T21:00:00.000Z"
    });

    expect(note.validation.ok).toBe(false);
    expect(note.validation.blockers).toContain("Acceptance status is missing, failing, or does not prove commandUploadEnabled false.");
    expect(note.commandUploadEnabled).toBe(false);
  });
});

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
    localAlphaOk: true,
    complete: false,
    commandUploadEnabled: false
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
