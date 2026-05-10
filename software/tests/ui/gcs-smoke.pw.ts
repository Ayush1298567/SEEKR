import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "SEEKR GCS" })).toBeVisible();
  await expect(page.getByLabel("Mission map")).toBeVisible();
  await page.getByTitle("Reset mission").click();
  await expect(page.locator(".status-strip .metric").filter({ hasText: "Phase" }).getByText("IDLE")).toBeVisible();
});

test("mission controls, no-fly planning, and command review stay operator-gated", async ({ page }) => {
  await page.getByTitle("Start mission").click();
  await expect(page.locator(".status-strip .metric").filter({ hasText: "Phase" }).getByText("RUNNING")).toBeVisible();

  await page.getByTitle("Add local no-fly zone").click();
  await expect(page.getByRole("dialog", { name: "No-fly zone" })).toBeVisible();
  await page.getByRole("dialog", { name: "No-fly zone" }).getByRole("button", { name: /Add/ }).click();
  await expect(page.locator(".no-fly-box")).toBeVisible();

  await page.getByTitle("Simulate failure").first().click();
  await expect(page.locator(".proposal")).toBeVisible();

  const approveProposal = page.getByTitle("Approve proposal");
  await expect(approveProposal).toBeEnabled();
  await approveProposal.click();
  await expect(page.getByRole("dialog", { name: "Command review" })).toBeVisible();
  await page.getByRole("button", { name: /Approve/ }).last().click();
  await expect(page.getByText(/reassigned|executed/).first()).toBeVisible();
});

test("evidence review and spatial preview render correctly", async ({ page }) => {
  await page.request.post("/api/ingest/fixtures/detection/evidence-linked-detection");
  await expect(page.getByText("motion anomaly")).toBeVisible();
  await page.getByTitle("Open evidence details").click();
  await expect(page.getByRole("dialog", { name: "Evidence detail" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTitle("Confirm detection").click();

  await page.request.post("/api/ingest/fixtures/spatial/rubble-gaussian-splat");
  await page.request.post("/api/ingest/fixtures/spatial/vps-pose-fix");
  await expect(page.getByText("Gaussian Splat")).toBeVisible();
  await expect(page.getByText("VPS Pose")).toBeVisible();
  await expect(page.locator(".spatial-marker").first()).toBeVisible();
  await page.getByTitle("Open in 3D viewer").first().click();
  await expect(page.getByRole("dialog", { name: "Spatial viewer" })).toBeVisible();
  await expect(page.locator(".spatial-canvas")).toBeVisible();
  await expect.poll(() => spatialCanvasHasBrightPixels(page)).toBe(true);
  await page.setViewportSize({ width: 390, height: 740 });
  await expect(page.locator(".spatial-canvas")).toBeVisible();
  await expect.poll(() => spatialCanvasHasBrightPixels(page)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByText(/generated preview|asset preview/)).toBeVisible();
  await page.getByTitle("Close spatial viewer").click();
  await page.getByTitle("Import spatial manifest").click();
  await expect(page.getByText("Gaussian Splat").first()).toBeVisible();
  await page.getByTitle("Hide Spatial").click();
  await expect(page.locator(".spatial-marker")).toHaveCount(0);
  await page.getByTitle("Show Spatial").click();
  await expect(page.locator(".spatial-marker").first()).toBeVisible();
});

test("artifacts, readiness, source health, replay, and map layers work after export", async ({ page }) => {
  await page.getByTitle("Start mission").click();
  await expect(page.locator(".status-strip .metric").filter({ hasText: "Phase" }).getByText("RUNNING")).toBeVisible();

  await page.getByTitle("Generate passive read-only plan").click();
  await expect(page.getByRole("dialog", { name: "Passive plan" })).toBeVisible();
  await expect(page.getByText("passive-read-only")).toBeVisible();
  await expect(page.getByText("Next Actions")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Passive plan" })).toBeHidden();

  await page.getByTitle("Generate operator input request").click();
  await expect(page.getByRole("dialog", { name: "Operator input request" })).toBeVisible();
  await expect(page.getByText("operator-input-request")).toBeVisible();
  await page.getByRole("dialog", { name: "Operator input request" }).getByRole("button", { name: "Close" }).click();

  await page.getByTitle("Export mission package").click();
  await expect(page.getByLabel("Replay manifest")).not.toHaveValue("");
  await page.reload();
  await expect(page.getByRole("heading", { name: "SEEKR GCS" })).toBeVisible();
  await expect(page.getByTitle("Start selected replay")).toBeEnabled();
  await expect(page.getByTitle("Copy mission id and build version")).toBeVisible();

  await page.getByTitle("Open readiness checklist").click();
  const readinessDialog = page.getByRole("dialog", { name: "Readiness" });
  await expect(readinessDialog).toBeVisible();
  await expect(readinessDialog.getByTitle("Copy mission", { exact: true })).toBeVisible();
  await expect(readinessDialog.getByTitle("Copy build", { exact: true })).toBeVisible();
  await expect(readinessDialog.getByTitle("Copy final hash", { exact: true })).toBeVisible();
  await expect(readinessDialog.getByTitle("Copy replay", { exact: true })).toBeVisible();
  await expect(page.getByText("Hash-chain verification")).toBeVisible();
  await expect(page.getByText("Persisted replay availability")).toBeVisible();
  await expect(page.locator(".readiness-check strong").filter({ hasText: /^Source health$/ })).toBeVisible();
  await expect(page.locator(".readiness-check strong").filter({ hasText: /^Runtime config$/ })).toBeVisible();
  await expect(page.getByText("Local AI status")).toBeVisible();
  await expect(page.getByText("Safety boundary")).toBeVisible();
  await readinessDialog.getByRole("button", { name: "Close" }).click();

  await page.getByTitle("Open source health").click();
  await expect(page.getByRole("dialog", { name: "Source health" })).toBeVisible();
  await expect(page.getByText("Operator Commands")).toBeVisible();
  await expect(page.getByText(/command channel/)).toBeVisible();
  await page.getByRole("dialog", { name: "Source health" }).getByRole("button", { name: "Close" }).click();

  await page.getByTitle("Export incident log").click();
  await expect(page.getByRole("dialog", { name: "Incident log" })).toBeVisible();
  await expect(page.getByText("SEEKR Incident Log")).toBeVisible();
  await expect(page.getByText("Final state hash")).toBeVisible();
  await page.getByRole("dialog", { name: "Incident log" }).getByRole("button", { name: "Close" }).click();

  await page.getByTitle("Generate mission report").click();
  await expect(page.getByRole("dialog", { name: "Mission report" })).toBeVisible();
  await expect(page.getByText("Final state hash")).toBeVisible();
  await expect(page.getByText("Spatial Asset Summary")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByTitle("Start selected replay").click();
  await expect(page.getByText(/REPLAY/)).toBeVisible();
  await page.getByTitle("Seek replay start").click();
  await expect(page.locator(".replay-seq")).toHaveText(/^0\//);
  await page.getByTitle("Seek replay to current sequence").click();

  await page.getByTitle("Hide Occupancy").click();
  await page.getByTitle("Show Occupancy").click();
  await expect(page.getByLabel("Mission map")).toBeVisible();
});

async function spatialCanvasHasBrightPixels(page: import("@playwright/test").Page) {
  return page.locator(".spatial-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(4);
    for (let xIndex = 1; xIndex < 6; xIndex += 1) {
      for (let yIndex = 1; yIndex < 6; yIndex += 1) {
        const x = Math.floor((width * xIndex) / 6);
        const y = Math.floor((height * yIndex) / 6);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        if (pixels[0] + pixels[1] + pixels[2] > 120) return true;
      }
    }
    return false;
  });
}
