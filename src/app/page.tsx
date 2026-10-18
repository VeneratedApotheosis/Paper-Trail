"use client";

import { useRouter } from "next/navigation";
import type { Finding, FindingStatus, NormalizedOrder } from "@/lib/contracts";
import { FINDING_STATUS_UPDATES, type AccountResponse, type FindingStatusUpdate, type LedgerResponse } from "@/lib/api/types";
import { encodeIdSegment } from "@/lib/api/ids";
import { countsTowardOwed, isOutstandingFinding } from "@/lib/rules/owed";
import { useAccount, useLedger, useLoadDemo, useSetFindingStatus } from "@/hooks";
import { orderSources } from "@/components/sourceAccounts";
import { AppShell } from "@/components/AppShell";
import { OwedView, type OwedFindingItem } from "@/components/views/OwedView";
import { ErrorState, HeroSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";

// Thin wrapper for "/" (issue #53): reads the live ledger and feeds the props-only OwedView.
// Owed vs "maybe" uses the same rule as the hero total (countsTowardOwed, #77 Option A: drafted findings stay owed).
// Empty store: no auto-load; the user explicitly loads the synthetic demo (#28 DECISION).

// `accounts` (GET /api/account) turns each order's source ids into the mailbox it came from, shown on the finding card (#115).
function splitFindings(
  ledger: LedgerResponse,
  accounts: AccountResponse["accounts"] = [],
): { owedItems: OwedFindingItem[]; maybeItems: OwedFindingItem[]; claimSentItems: OwedFindingItem[] } {
  const ordersById = new Map<string, NormalizedOrder>(ledger.orders.map((order) => [order.id, order]));
  const toItem = (finding: Finding): OwedFindingItem => ({
    finding,
    merchant: ordersById.get(finding.orderId)?.merchant.name ?? "Unknown merchant",
    sources: orderSources(ordersById.get(finding.orderId)?.sources, accounts),
  });
  const outstanding = ledger.findings.filter(isOutstandingFinding);
  // Drafted findings still count toward the total (#77) but are listed under "Claims sent", not as open money.
  const open = outstanding.filter((f) => f.status !== "drafted");
  return {
    owedItems: open.filter((f) => countsTowardOwed(f, ordersById.get(f.orderId))).map(toItem),
    maybeItems: open.filter((f) => !countsTowardOwed(f, ordersById.get(f.orderId))).map(toItem),
    claimSentItems: outstanding.filter((f) => f.status === "drafted").map(toItem),
  };
}

// Full navigation (not router.push): the route starts the Google OAuth redirect (same as ConnectClient).
function startGmailConnect() {
  window.location.href = "/api/auth/google";
}

export default function Home() {
  const router = useRouter();
  const ledger = useLedger();
  const loadDemo = useLoadDemo();
  const account = useAccount();
  const setStatus = useSetFindingStatus();

  // The view offers "Mark resolved" / "Dismiss" on claim-sent rows; only statuses the API accepts are sent.
  function handleSetStatus(findingId: string, status: FindingStatus) {
    if ((FINDING_STATUS_UPDATES as readonly string[]).includes(status)) {
      void setStatus.run(findingId, status as FindingStatusUpdate);
    }
  }

  // useLoadDemo refreshes the shared cache itself, so there is nothing to refetch here.
  async function handleLoadDemo() {
    await loadDemo.run();
  }

  if (loadDemo.pending || ledger.loading) {
    return (
      <AppShell>
        <HeroSkeleton />
      </AppShell>
    );
  }

  const error = loadDemo.error ?? ledger.error;
  if (error || !ledger.data) {
    const retry = loadDemo.error ? handleLoadDemo : ledger.refetch;
    return (
      <AppShell>
        <ErrorState
          title={loadDemo.error ? "Couldn't load the demo data" : "Couldn't load what you're owed"}
          what={error}
          fix="Check that the app server is running, then try again."
          actions={
            <Button type="button" onClick={retry}>
              Try again
            </Button>
          }
        />
      </AppShell>
    );
  }

  const data = ledger.data;
  const { owedItems, maybeItems, claimSentItems } = splitFindings(data, account.data?.accounts);

  return (
    <OwedView
      summary={data.summary}
      owedItems={owedItems}
      maybeItems={maybeItems}
      claimSentItems={claimSentItems}
      onSetStatus={handleSetStatus}
      simulatedLabel={data.labels.simulatedPrice}
      onOpenClaim={(id) => router.push(`/claim/${encodeIdSegment(id)}`)}
      onOpenReview={() => router.push("/review")}
      onBrowseLedger={() => router.push("/ledger")}
      onConnectGmail={data.mode === "empty" ? startGmailConnect : undefined}
      onLoadDemo={data.mode === "empty" ? handleLoadDemo : undefined}
    />
  );
}
