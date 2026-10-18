import { expect, test } from "@playwright/test";

test("detail loading boundaries preserve real 404s and known synthetic details", async ({ page }) => {
  // Shares the page's cookies, so API calls and the page use the same anonymous store scope (#90).
  const request = page.request;
  await request.post("/api/demo");
  for (const path of ["/ledger/unknown-synthetic-id", "/claim/unknown-synthetic-id"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  }
  const ledger = await (await request.get("/api/ledger")).json();
  const finding = ledger.findings.find((item: { kind: string }) => item.kind === "refund_overdue");
  for (const path of [`/ledger/${encodeURIComponent(finding.orderId)}`, `/claim/${encodeURIComponent(finding.id)}`]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).not.toContainText(/not found/i);
  }
});
