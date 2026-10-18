import { test, expect } from "@playwright/test";

test("synthetic demo: findings, evidence, claim approval, purchases and delete", async ({ page, context, request }, testInfo) => {
  const external: string[] = [];
  await context.route("https://**/*", route => { external.push(route.request().url()); return route.abort(); });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // This dedicated server has no account cookies or real credentials. Reset
  // synthetic state through its actual API, never the developer's port 3000.
  expect((await request.post("/api/delete-all")).ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo data", exact: true }).click();
  const headline = page.getByRole("heading", { level: 1, name: /You are owed/ });
  await expect(headline).toContainText("1,774.23");
  await expect(page.getByText(/synthetic/i).first()).toBeVisible();
  const before = await headline.innerText();
  const card = page.locator("article").first();
  await card.getByRole("button", { name: "Why?", exact: true }).click();
  await expect(card.getByText("What your emails say", { exact: true })).toBeVisible();
  await expect(card.locator("li").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("demo-findings.png"), fullPage: true });
  await card.getByRole("button", { name: "Draft a claim", exact: true }).click();
  await expect(page).toHaveURL(/\/claim\//);
  await page.getByRole("button", { name: "Approve and copy", exact: true }).click();
  await expect(page.getByText("Approved and copied to clipboard", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(headline).toHaveText(before);
  const approvedLedger = await (await request.get("/api/ledger")).json();
  expect(approvedLedger.summary.claimSentCount).toBe(1);
  expect(approvedLedger.findings.filter((finding: { status: string }) => finding.status === "drafted")).toHaveLength(1);
  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Purchases", exact: true })).toBeVisible();
  await page.getByRole("button").filter({ hasText: /\$/ }).first().click();
  await expect(page).toHaveURL(/\/ledger\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("order-detail.png"), fullPage: true });
  await page.goto("/trust");
  await page.getByRole("button", { name: "Delete everything", exact: true }).click();
  await page.locator("#delete-confirm").fill("DELETE");
  await page.getByRole("button", { name: "Revoke access and erase all data", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/ledger")).json()).orders.length).toBe(0);
  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "No purchases yet", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("deleted-empty.png"), fullPage: true });
  expect(external).toEqual([]);
});
