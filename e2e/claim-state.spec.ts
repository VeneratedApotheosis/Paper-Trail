import { expect, test } from "@playwright/test";

test("server-approved claim handoff survives reload and deletion reports the real receipt", async ({ page, context, request }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route("https://**/*", route => route.abort());
  await request.post("/api/delete-all");
  await request.post("/api/demo");
  await page.goto("/");
  await page.getByRole("button", { name: "Draft a claim", exact: true }).first().click();
  await expect(page.getByRole("link", { name: "Open in email", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Approve and copy", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open in email", exact: true })).toHaveAttribute("href", /^mailto:/);
  await page.reload();
  await expect(page.getByText("Claim approved", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in email", exact: true })).toHaveAttribute("href", /^mailto:/);
  await page.getByLabel("Subject", { exact: true }).fill("Unsaved synthetic edit");
  await expect(page.getByRole("link", { name: "Open in email", exact: true })).toHaveCount(0);
  await page.goto("/trust");
  await page.getByRole("button", { name: "Delete everything", exact: true }).click();
  await page.locator("#delete-confirm").fill("DELETE");
  await page.getByRole("button", { name: "Revoke access and erase all data", exact: true }).click();
  await expect(page.getByText("Deletion receipt", { exact: true })).toBeVisible();
  await expect(page.getByText(/No successful Google revocation was reported/)).toBeVisible();
  await expect(page.getByText(/Simulated for the demo/)).toHaveCount(0);
});
