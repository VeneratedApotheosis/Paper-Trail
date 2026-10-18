import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SyncView, type SyncViewProps } from "@/components/views/SyncView";
import * as fixtures from "@/components/views/fixtures/sync";

// Renders SyncView (#104) for every fixture phase, so the Gmail phases are checked without a live OAuth session.
vi.mock("next/navigation", () => ({ usePathname: () => "/sync" }));
// Vitest compiles .tsx with the classic JSX runtime (tsconfig keeps JSX for Next), which needs a global React.
Object.assign(globalThis, { React });

/** Visible text only, with entities decoded, so assertions read like the screen. */
function render(props: SyncViewProps): string {
  return renderToStaticMarkup(createElement(SyncView, props))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const { syncViewErrorFixtures, ...phaseFixtures } = fixtures;
const allFixtures: Array<[string, SyncViewProps]> = [
  ...Object.entries(phaseFixtures),
  ...Object.entries(syncViewErrorFixtures).map(([kind, props]): [string, SyncViewProps] => [`error ${kind}`, props]),
];

describe("SyncView fixtures", () => {
  it.each(allFixtures)("%s shows no simulated numbers or fake stages", (_name, props) => {
    const text = render(props);
    for (const fake of ["simulated", "Simulated", "300", "47", "tokens redacted", "rate limit", "18 matching"]) {
      expect(text).not.toContain(fake);
    }
  });

  it("Gmail preview shows the real query, estimate, fetch count, cap, and Start only", () => {
    const text = render(fixtures.syncViewGmailPreviewFixture);
    expect(text).toContain(fixtures.syncViewGmailPreviewFixture.preview!.query);
    expect(text).toContain("50 of about 120 matching");
    expect(text).toContain("Last 90 days, up to 50 messages per run");
    expect(text).toContain("Start sync");
    expect(text).not.toContain("Import .eml");
    expect(text).not.toContain("Try demo data");
    expect(text).not.toContain("Dev:");
  });

  it("import preview shows Import and Try demo data, no Start or message counts", () => {
    const text = render(fixtures.syncViewImportPreviewFixture);
    expect(text).toContain("Import .eml / .mbox");
    expect(text).toContain("Try demo data");
    expect(text).toContain("Connect Gmail");
    expect(text).toContain(fixtures.syncViewImportPreviewFixture.preview!.description!);
    expect(text).not.toContain("Start sync");
    expect(text).not.toContain("Messages to fetch");
  });

  it("shows the dev toggle only with showDevToggle", () => {
    expect(render(fixtures.syncViewFixture)).toContain("Dev: show the no-receipts screen");
    expect(render({ ...fixtures.syncViewFixture, showDevToggle: false })).not.toContain("Dev:");
  });

  it("progress renders only the counts it is given", () => {
    expect(render(fixtures.syncViewSyncingStartFixture)).toContain("Starting the sync");
    const listing = render(fixtures.syncViewSyncingListingFixture);
    expect(listing).toContain("Listing matching messages in Gmail");
    expect(listing).not.toContain("messages fetched");
    const fetching = render(fixtures.syncViewSyncingFetchingFixture);
    expect(fetching).toContain("21 / 50 messages fetched");
    expect(fetching).toContain("1 message skipped");
    expect(renderToStaticMarkup(createElement(SyncView, fixtures.syncViewSyncingFetchingFixture))).toContain(
      'aria-valuenow="42"',
    );
    expect(render(fixtures.syncViewSyncingProcessingFixture)).toContain("Redacting, classifying and extracting receipts");
    expect(renderToStaticMarkup(createElement(SyncView, fixtures.syncViewSyncingProcessingFixture))).not.toContain(
      "progressbar",
    );
  });

  it("result shows the real counts and opens the ledger", () => {
    const gmail = render(fixtures.syncViewGmailResultFixture);
    expect(gmail).toContain("Found 3 things worth a look");
    expect(gmail).toContain(
      "Fetched 50 messages (stopped at the 50-message limit; 1 could not be parsed). Found 9 orders, 2 to review.",
    );
    expect(gmail).toContain("Open what you're owed");
    const imported = render(fixtures.syncViewImportResultFixture);
    expect(imported).toContain("Import complete");
    expect(imported).toContain("Read 2 emails from 2 files. Found 1 order.");
  });

  it("no receipts shows the real counts with the right next step", () => {
    const gmail = render(fixtures.syncViewGmailNoReceiptsFixture);
    expect(gmail).toContain("No receipts found in this inbox");
    expect(gmail).toContain("Fetched 12 messages, but none looked like a purchase.");
    expect(gmail).toContain("Back to sync");
    const imported = render(fixtures.syncViewImportNoReceiptsFixture);
    expect(imported).toContain("Read 3 emails from 2 files (1 could not be parsed), but none looked like a purchase.");
    expect(imported).toContain("Import .eml / .mbox");
    expect(imported).toContain("Try demo data");
  });

  it("errors show title, what, fix, and the action for their kind", () => {
    const errors = syncViewErrorFixtures;
    const reconnect = render(errors.reconnect);
    expect(reconnect).toContain("Your Gmail connection expired");
    expect(reconnect).toContain("Reconnect Gmail, then start the sync again.");
    expect(reconnect).toContain("Reconnect Gmail");
    expect(reconnect).not.toContain("Try again");
    expect(render(errors.access_denied)).toMatch(/Reconnect Gmail.*Try again/);
    expect(render(errors.already_running)).toMatch(/Open what you're owed.*Back to sync/);
    for (const kind of ["timeout", "rate_limited", "unreachable", "failed"] as const) {
      expect(render(errors[kind])).toContain("Try again");
    }
    const importFailed = render(errors.import_failed);
    expect(importFailed).toContain("Import .eml / .mbox");
    expect(importFailed).toContain("Try demo data");
    expect(render({ ...errors.import_failed, preview: null })).toContain("Try again");
  });
});
