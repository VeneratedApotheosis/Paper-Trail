// PaperTrail guided demo tour (~3 minutes).
//
// A human-paced, headed Playwright walkthrough that starts from the welcome
// screen and clicks through the whole product story, slow enough to film:
//
//   Try the demo -> owed hero -> a Return window finding -> Why? ->
//   Draft a claim -> edit the date in the letter -> Save -> Approve ->
//   Purchases list -> open the first order -> Promotions -> Trust ->
//   Delete everything.
//
// Usage (run the app first, e.g. `npm run dev`):
//   node demo-tour.mjs
//
// Env knobs:
//   BASE_URL   where the app is served          (default http://localhost:3000)
//   PACE       pause multiplier, 1 = ~3 min      (default 1)
//   SLOWMO     ms added to every Playwright op   (default 60)
//   HEADLESS   "1" to run without a window       (default headed)
//   VIDEO      "1" to record a .webm to ./demo-recording
//
// It records nothing by default; set VIDEO=1 to capture the tour.

import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const PACE = Number(process.env.PACE ?? "1.2");
const SLOWMO = Number(process.env.SLOWMO ?? "60");
const HEADLESS = process.env.HEADLESS === "1";
const VIDEO = process.env.VIDEO === "1";

// Pause helper: every narrative beat is `beat(seconds)`, scaled by PACE so the
// whole tour can be sped up or slowed down without re-tuning each number.
const beat = (seconds) => new Promise((r) => setTimeout(r, seconds * 1000 * PACE));

// Smooth, eye-trackable scrolling: lots of small steps instead of one jump.
async function smoothScroll(page, totalPx, { steps = 24, perStep = 55 } = {}) {
  const chunk = totalPx / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, chunk);
    await beat(perStep / 1000);
  }
}

async function scrollTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await beat(0.4);
}

// Type into a field one character at a time so it reads like a person editing.
async function retype(locator, value) {
  await locator.click();
  await locator.press("Control+A");
  await locator.press("Delete");
  await locator.pressSequentially(value, { delay: 35 });
}

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOWMO });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "no-preference",
    ...(VIDEO ? { recordVideo: { dir: "demo-recording", size: { width: 1440, height: 900 } } } : {}),
  });

  // Clipboard is used by "Approve and copy"; grant it so nothing blocks.
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
  } catch {
    // Older Chromium / non-chromium: ignore, the tour still runs.
  }

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  // ---------------------------------------------------------------- 1. Welcome
  await page.goto(`${BASE_URL}/welcome`, { waitUntil: "networkidle" });
  await beat(3.5); // let the hero land

  const tryDemo = page.getByRole("button", { name: "Try the demo", exact: true }).first();
  await tryDemo.waitFor();
  await scrollTo(page, tryDemo);
  await beat(1.5);
  await tryDemo.click();

  // The demo loader populates the store, then routes to "/". Wait for the hero number.
  await page.locator("#hero-amount").waitFor({ timeout: 60000 });
  await beat(4); // "You're owed $X" reveal

  // ------------------------------------------------------------- 2. Owed hero
  await smoothScroll(page, 650, { steps: 26 });
  await beat(2.5);

  // Find a "Return window closing" finding card and bring it into view.
  const returnCard = page
    .locator("article")
    .filter({ hasText: "Return window closing" })
    .first();

  let whyTarget = returnCard;
  if ((await returnCard.count()) === 0) {
    // Fall back to the first finding card if the demo seed has no return window.
    whyTarget = page.locator("article").first();
  }
  await scrollTo(page, whyTarget);
  await beat(2.5);

  // --------------------------------------------------------------- 3. Why?
  const why = whyTarget.getByRole("button", { name: "Why?", exact: true });
  await why.click();
  await beat(1);
  // The evidence quote expands below the card; read it.
  await smoothScroll(page, 260, { steps: 12 });
  await beat(5); // read the evidence

  // ----------------------------------------------------------- 4. Draft claim
  const draft = whyTarget.getByRole("button", { name: "Draft a claim", exact: true });
  await scrollTo(page, draft);
  await beat(1.5);
  await draft.click();

  await page.waitForURL(/\/claim\//, { timeout: 30000 });
  const approve = page.getByRole("button", { name: "Approve and copy", exact: true });
  await approve.waitFor();
  await beat(3.5); // read the drafted letter

  // Scroll through the letter + finding + steps rail.
  await smoothScroll(page, 420, { steps: 18 });
  await beat(3);

  // --------------------------------------------- 5. Edit the date in the letter
  const body = page.getByLabel("Message");
  await scrollTo(page, body);
  const original = (await body.inputValue()) ?? "";

  // Swap a date-looking token for a corrected one, so "Save changes" lights up.
  // Matches "January 5", "Jan 5, 2026", "01/05/2026", "2026-01-05", etc.
  const dateRe =
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
  const CORRECTED = "November 30, 2026";
  let edited;
  if (dateRe.test(original)) {
    edited = original.replace(dateRe, CORRECTED);
  } else {
    // No date in the body: append a dated postscript so the edit is visible.
    edited = `${original.trimEnd()}\n\nPlease action this by ${CORRECTED}.`;
  }
  await retype(body, edited);
  await beat(2.5); // let the viewer see the corrected date

  // ----------------------------------------------------------- 6. Save changes
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await scrollTo(page, save);
  await save.click();
  await beat(2.5);

  // --------------------------------------------------------------- 7. Approve
  await approve.scrollIntoViewIfNeeded();
  await beat(1);
  await approve.click();
  await page.getByText(/Approved/i).first().waitFor({ timeout: 15000 });
  await beat(4.5); // "Approved and copied. You send it yourself."

  await smoothScroll(page, 300, { steps: 14 });
  await beat(2.5);

  // ------------------------------------------------------------- 8. Purchases
  await page.getByRole("link", { name: "Purchases", exact: true }).first().click();
  await page.getByRole("heading", { name: "Purchases", exact: true }).waitFor();
  await beat(3); // the full ledger

  await smoothScroll(page, 700, { steps: 28 });
  await beat(3);
  // Back up a touch so the first rows are in frame before we open one.
  await smoothScroll(page, -500, { steps: 16 });
  await beat(1.5);

  // ----------------------------------------------------- 9. Open the first order
  const firstOrder = page.getByRole("button").filter({ hasText: /\$/ }).first();
  await scrollTo(page, firstOrder);
  await beat(1);
  await firstOrder.click();
  await page.waitForURL(/\/ledger\//, { timeout: 30000 });
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await beat(3.5); // receipt -> ledger row detail

  await smoothScroll(page, 600, { steps: 24 });
  await beat(3);

  // ------------------------------------------------------------- 10. Promotions
  await page.getByRole("link", { name: "Promotions", exact: true }).first().click();
  await page.getByRole("heading", { level: 1, name: "Promotions" }).waitFor();
  await beat(3);
  await smoothScroll(page, 450, { steps: 18 });
  await beat(3);

  // ----------------------------------------------------------------- 11. Trust
  await page.getByRole("link", { name: "Trust", exact: true }).first().click();
  await page.getByRole("heading", { name: "Trust and your data", exact: true }).waitFor();
  await beat(3); // "We store / We never"
  await smoothScroll(page, 350, { steps: 14 });
  await beat(2.5); // audit log
  await smoothScroll(page, 500, { steps: 20 });
  await beat(2.5);

  // --------------------------------------------------------- 12. Delete everything
  const deleteBtn = page.getByRole("button", { name: "Delete everything", exact: true }).first();
  await scrollTo(page, deleteBtn);
  await beat(1.5);
  await deleteBtn.click();

  const confirmInput = page.getByLabel(/Type .* to confirm/i);
  await confirmInput.waitFor();
  await beat(1.5);
  await confirmInput.pressSequentially("DELETE", { delay: 110 });
  await beat(1.5);

  const confirmDelete = page.getByRole("button", { name: "Revoke access and erase all data", exact: true });
  await confirmDelete.click();

  // Deletion receipt confirms the erase; let it sit on screen to close the tour.
  await page.getByText("Deletion receipt", { exact: true }).waitFor({ timeout: 20000 });
  await beat(5);

  if (VIDEO) await context.close(); // flush the video file
  await browser.close();
}

main().catch((err) => {
  console.error("demo-tour failed:", err);
  process.exit(1);
});
