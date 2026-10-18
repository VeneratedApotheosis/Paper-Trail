import { test, type Page, type BrowserContext } from "@playwright/test";
import path from "node:path";

// TEMPORARY capture spec for Devpost screenshots (desktop + mobile). Not for
// commit (e2e/** is Kenan's area) — delete before pushing. Writes PNGs to
// /screenshots.
const OUT = path.resolve(__dirname, "..", "screenshots");

async function settle(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => (document as Document).fonts.ready);
  await page.waitForTimeout(500);
}

async function resetAndSeed(page: Page, context: BrowserContext) {
  await context.route("https://**/*", route => route.abort());
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const request = page.request;
  await request.post("/api/delete-all");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const demoBtn = page.getByRole("button", { name: "Try demo data", exact: true });
  await demoBtn.waitFor();
  await page.waitForTimeout(1000);
  await demoBtn.click();
  await page.locator("#hero-amount").waitFor({ timeout: 60000 });
}

// ---------------------------------------------------------------------------
// Desktop: 1440x900 @2x, standard laptop screenshot ratio for most shots.
// ---------------------------------------------------------------------------
test.describe("desktop", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });

  test("capture desktop screens", async ({ page, context }) => {
    test.setTimeout(180000);
    await resetAndSeed(page, context);

    // 1) Owed hero with top finding's evidence expanded.
    const firstCard = page.locator("article").first();
    await firstCard.getByRole("button", { name: "Why?", exact: true }).click();
    await firstCard.getByText("What your emails say", { exact: true }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "desktop-01-owed-hero.png") });

    // 2) Full ledger of purchases.
    await page.goto("/ledger");
    await page.getByRole("heading", { name: "Purchases", exact: true }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "desktop-02-ledger.png"), fullPage: true });

    // 3) Order detail: receipt -> ledger row.
    await page.goto("/ledger");
    await page.getByRole("button").filter({ hasText: /\$/ }).first().click();
    await page.waitForURL(/\/ledger\//);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "desktop-03-order-detail.png") });

    // 4) Claim draft: human-in-the-loop, never auto-send.
    await page.goto("/");
    const card = page.locator("article").first();
    await card.getByRole("button", { name: "Draft a claim", exact: true }).click();
    await page.waitForURL(/\/claim\//);
    await page.getByRole("button", { name: "Approve and copy", exact: true }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "desktop-04-claim-draft.png") });

    // 5) Promotions page.
    await page.goto("/promotions");
    await page.getByRole("heading", { level: 1, name: "Promotions" }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "desktop-05-promotions.png") });

    // 6) Welcome / landing screen (signed-out).
    await context.clearCookies();
    await page.goto("/welcome");
    await page.getByRole("button", { name: "Try demo data", exact: true }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "desktop-06-welcome.png") });
  });
});

// ---------------------------------------------------------------------------
// Mobile: iPhone-ish viewport @3x.
// ---------------------------------------------------------------------------
test.describe("mobile", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    colorScheme: "light",
    isMobile: true,
    hasTouch: true,
  });

  test("capture mobile screens", async ({ page, context }) => {
    test.setTimeout(180000);
    await resetAndSeed(page, context);

    // 1) Owed hero.
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "mobile-01-owed-hero.png") });

    // 2) Evidence expanded on top finding.
    const firstCard = page.locator("article").first();
    await firstCard.getByRole("button", { name: "Why?", exact: true }).click();
    await firstCard.getByText("What your emails say", { exact: true }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "mobile-02-evidence.png") });

    // 3) Ledger list.
    await page.goto("/ledger");
    await page.getByRole("heading", { name: "Purchases", exact: true }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "mobile-03-ledger.png") });

    // 4) Order detail.
    await page.getByRole("button").filter({ hasText: /\$/ }).first().click();
    await page.waitForURL(/\/ledger\//);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "mobile-04-order-detail.png") });

    // 5) Claim draft.
    await page.goto("/");
    const card = page.locator("article").first();
    await card.getByRole("button", { name: "Draft a claim", exact: true }).click();
    await page.waitForURL(/\/claim\//);
    await page.getByRole("button", { name: "Approve and copy", exact: true }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "mobile-05-claim-draft.png") });
  });
});

// ---------------------------------------------------------------------------
// 3:2 hero thumbnail (Devpost cover image), 2400x1600 output.
// ---------------------------------------------------------------------------
test.describe("thumbnail", () => {
  test.use({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });

  test("capture 3:2 cover image", async ({ page, context }) => {
    test.setTimeout(180000);
    await resetAndSeed(page, context);
    const firstCard = page.locator("article").first();
    await firstCard.getByRole("button", { name: "Why?", exact: true }).click();
    await firstCard.getByText("What your emails say", { exact: true }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "00-cover-3x2.png") });
  });
});
