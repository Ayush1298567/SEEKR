import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderGstackBrowserQaMarkdown, summarizeReadiness, writeGstackBrowserQaReport } from "../../../scripts/gstack-browser-qa";

describe("gstack browser QA report", () => {
  it("fails closed when the output directory escapes the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-gstack-browser-qa-test-"));
    try {
      await expect(writeGstackBrowserQaReport({
        root,
        outDir: "../outside-qa-report",
        generatedAt: "2026-05-10T06:40:00Z"
      })).rejects.toThrow("output directory must stay inside the project root");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when generatedAt cannot be used as a safe artifact timestamp", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seekr-gstack-browser-qa-test-"));
    try {
      await expect(writeGstackBrowserQaReport({
        root,
        generatedAt: "2026-05-10T06:40:00Z/../../../escape"
      })).rejects.toThrow("generatedAt must be an ISO UTC timestamp");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders command-safe browser QA evidence with screenshot paths and hardware limitations", () => {
    const markdown = renderGstackBrowserQaMarkdown({
      generatedAt: "2026-05-10T06:40:00Z",
      baseUrl: "http://127.0.0.1:55555",
      dataDir: ".tmp/qa-clean-gstack-test",
      homeScreenshotPath: ".gstack/qa-reports/screenshots/seekr-qa-test-clean-home.png",
      mobileScreenshotPath: ".gstack/qa-reports/screenshots/seekr-qa-test-clean-mobile.png",
      releaseChecksum: "a".repeat(64),
      commandBoundaryStatus: "pass",
      commandBoundaryScannedFileCount: 123,
      commandBoundaryViolationCount: 0,
      readinessSummary: "8 pass, 3 warn, 0 fail, 0 blocking",
      verifyErrors: [],
      verifyEventCount: 0,
      verifyFinalStateHash: "b".repeat(64),
      consoleEvidence: "No browser console errors or warnings were emitted during the clean production-shell run."
    });

    expect(markdown).toContain("Pass for local internal-alpha browser/API QA.");
    expect(markdown).toContain("`commandUploadEnabled` stayed `false`.");
    expect(markdown).toContain(".gstack/qa-reports/screenshots/seekr-qa-test-clean-home.png");
    expect(markdown).toContain(".gstack/qa-reports/screenshots/seekr-qa-test-clean-mobile.png");
    expect(markdown).toContain("command-boundary status pass, 123 scanned files, 0 violations");
    expect(markdown).toContain("does not validate real Jetson Orin Nano hardware");
    expect(markdown).toContain("Real aircraft command upload and hardware actuation remain disabled.");
  });

  it("summarizes readiness checks without treating local warnings as blockers", () => {
    expect(summarizeReadiness({
      checks: [
        { status: "pass", blocking: true },
        { status: "pass", blocking: false },
        { status: "warn", blocking: false },
        { status: "fail", blocking: false }
      ]
    })).toBe("2 pass, 1 warn, 1 fail, 0 blocking");
  });
});
