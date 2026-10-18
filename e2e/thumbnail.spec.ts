import { test } from "@playwright/test";
import path from "node:path";

// TEMPORARY capture spec for the Devpost thumbnail. Not for commit (e2e/** is
// Kenan's area). Produces 2400x1600 (3:2) raw screenshots in /screenshots.
const OUT = path.resolve(__dirname, "..", "screenshots");

test.use({
  viewport: { width: 1200, height: 800 }, // 3:2 logical frame
  deviceScaleFactor: 2, // -> 2400x1600 output
  colorScheme: "light",
});

async function settle(page: import("@playwright/test").Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => (document as Document).fonts.ready);
  await page.waitForTimeout(500);
}

test("capture devpost thumbnail screens", async ({ page, context }) => {
  test.setTimeout(180000);
  const request = page.request;
  // Keep everything local: block external calls, grant clipboard for claim flow.
  await context.route("https://**/*", route => route.abort());
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await request.post("/api/delete-all");

  // 1) Hero: owed total + breakdown, top finding's evidence expanded.
  await page.goto("/");
  // Signed-out visitors land on /welcome; wait for hydration before clicking.
  await page.waitForLoadState("networkidle");
  const demoBtn = page.getByRole("button", { name: "Try demo data", exact: true });
  await demoBtn.waitFor();
  await page.waitForTimeout(1000);
  await demoBtn.click();
  await page.locator("#hero-amount").waitFor({ timeout: 60000 });
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "Why?", exact: true }).click();
  await firstCard.getByText("What your emails say", { exact: true }).waitFor();
  await settle(page);
  await page.screenshot({ path: path.join(OUT, "01-hero-owed.png") });

  // 2) Order detail: receipt -> ledger row.
  await page.goto("/ledger");
  await page.getByRole("heading", { name: "Purchases", exact: true }).waitFor();
  await page.getByRole("button").filter({ hasText: /\$/ }).first().click();
  await page.waitForURL(/\/ledger\//);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await settle(page);
  await page.screenshot({ path: path.join(OUT, "02-order-detail.png") });

  // 3) Claim draft: human-in-the-loop, never auto-send.
  await page.goto("/");
  const card = page.locator("article").first();
  await card.getByRole("button", { name: "Draft a claim", exact: true }).click();
  await page.waitForURL(/\/claim\//);
  await page.getByRole("button", { name: "Approve and copy", exact: true }).waitFor();
  await settle(page);
  await page.screenshot({ path: path.join(OUT, "03-claim-draft.png") });
});
