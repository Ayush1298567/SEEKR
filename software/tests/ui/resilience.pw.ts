import { expect, test } from "@playwright/test";

test("startup retries when the state API is late", async ({ page }) => {
  let stateAttempts = 0;
  await page.route("**/api/state", async (route) => {
    stateAttempts += 1;
    if (stateAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "SEEKR GCS" })).toBeVisible();
  await expect.poll(() => stateAttempts).toBeGreaterThan(1);
});

test("artifact surfaces show API errors inside a modal", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "SEEKR GCS" })).toBeVisible();
  await page.getByTitle("Reset mission").click();
  await expect(page.locator(".status-strip .metric").filter({ hasText: "Phase" }).getByText("IDLE")).toBeVisible();

  await page.route("**/api/missions/*/report", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "report unavailable" }) });
  });

  await page.getByTitle("Generate mission report").click();
  const statusDialog = page.getByRole("dialog", { name: "Mission report status" });
  await expect(statusDialog).toBeVisible();
  await expect(statusDialog.getByText("Artifact unavailable")).toBeVisible();
  await expect(statusDialog.getByText(/503|report unavailable/)).toBeVisible();
  await statusDialog.getByRole("button", { name: "Close" }).click();
  await expect(statusDialog).toBeHidden();
});

test("operator shell fits field laptop viewports", async ({ page }) => {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1024, height: 700 }
  ]) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SEEKR GCS" })).toBeVisible();
    await expect(page.getByLabel("Mission map")).toBeVisible();
    await expect(page.locator(".control-row")).toBeVisible();
    await expect(page.locator(".audit-bar")).toBeVisible();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    expect(horizontalOverflow, `${size.width}x${size.height} should not horizontally overflow`).toBe(false);
  }
});
