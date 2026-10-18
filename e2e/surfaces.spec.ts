import { test, expect } from "@playwright/test";

// #147: demo coverage for Promotions, Review "Not a purchase", Owed "Claims sent" and tracking-number groups.
test("synthetic demo: promotions, not a purchase, claims sent and tracking groups", async ({ page, context }) => {
  // Shares the page's cookies, so API calls and the page use the same anonymous store scope (#90).
  const request = page.request;
  await context.route("https://**/*", route => route.abort());
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  expect((await request.post("/api/delete-all")).ok()).toBe(true);
  expect((await request.post("/api/demo")).ok()).toBe(true);

  // Tracking groups (#127): several emails about one package end up on one order that carries its tracking number.
  const ledger = await (await request.get("/api/ledger")).json();
  const tracked = ledger.orders.filter((order: { messageIds?: string[] }) =>
    JSON.stringify(order).includes('"trackingNumber"') && (order.messageIds?.length ?? 0) > 1);
  expect(tracked.length).toBeGreaterThan(0);

  // Promotions (#131): the demo's synthetic promo emails become offers on the page.
  const promotions = await (await request.get("/api/promotions")).json();
  await page.goto("/promotions");
  await expect(page.getByRole("heading", { level: 1, name: "Promotions" })).toBeVisible();
  expect(promotions.promotions.length).toBeGreaterThan(0);
  await expect(page.locator("main li").first()).toBeVisible();

  // Not a purchase (#134): the demo's Review queue is empty, so mark an order through the same route the Review card
  // calls and check it leaves the ledger, the Purchases page and the owed total's inputs.
  const target = ledger.orders.find((order: { id: string }) =>
    !ledger.findings.some((finding: { orderId: string }) => finding.orderId === order.id));
  expect(target).toBeTruthy();
  expect((await request.post(`/api/orders/${encodeURIComponent(target.id)}/not-purchase`)).ok()).toBe(true);
  const after = await (await request.get("/api/ledger")).json();
  expect(after.orders.map((order: { id: string }) => order.id)).not.toContain(target.id);
  expect(after.orders).toHaveLength(ledger.orders.length - 1);
  expect((await page.goto(`/ledger/${encodeURIComponent(target.id)}`))?.status()).toBe(404);

  // Claims sent (#77): an approved claim is listed under "Claims sent" on Owed.
  await page.goto("/");
  await page.getByRole("button", { name: "Draft a claim", exact: true }).first().click();
  await page.getByRole("button", { name: "Approve and copy", exact: true }).click();
  await expect(page.getByText("Approved and copied.", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Claims sent", exact: true })).toBeVisible();
  await expect(page.getByText("Claim sent", { exact: true }).first()).toBeVisible();
});
