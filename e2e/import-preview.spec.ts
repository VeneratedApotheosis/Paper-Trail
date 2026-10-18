import { expect, test } from "@playwright/test";

test("anonymous import preview displays the Gmail query once", async ({ page, request }) => {
  const response = await request.get("/api/prefilter");
  const { query } = await response.json() as { query: string };
  await page.goto("/sync");
  await expect(page.getByRole("heading", { name: "Import receipts or try the demo" })).toBeVisible();
  await expect(page.getByText(query, { exact: true })).toHaveCount(1);
  await expect(page.getByText(query, { exact: false })).toHaveCount(1);
});
