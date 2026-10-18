import { expect, test } from "@playwright/test";

test("evaluation loads real API scores and retries a failed request", async ({ page }) => {
  // Shares the page's cookies, so API calls and the page use the same anonymous store scope (#90).
  const request = page.request;
  const report = await (await request.get("/api/eval")).json();
  let fail = true;
  await page.route("**/api/eval", route => fail
    ? route.fulfill({ status: 503, body: "Unavailable" })
    : route.continue());
  await page.goto("/eval");
  await expect(page.getByText("Couldn't load the evaluation", { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How well we recognize receipts" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Headline metrics" })).toContainText(`${Math.round(report.classification.splits.holdout.accuracy * 100)}%`);
  await expect(page.getByText(/AI extraction accuracy was not measured/)).toBeVisible();
});
