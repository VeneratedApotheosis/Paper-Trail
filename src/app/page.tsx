"use client";

import { useRouter } from "next/navigation";
import type { Finding, NormalizedOrder } from "@/lib/contracts";
import type { LedgerResponse } from "@/lib/api/types";
import { encodeIdSegment } from "@/lib/api/ids";
import { countsTowardOwed, isOutstandingFinding } from "@/lib/rules/owed";
import { useLedger, useLoadDemo } from "@/hooks";
import { AppShell } from "@/components/AppShell";
import { OwedView, type OwedFindingItem } from "@/components/views/OwedView";
import { ErrorState, HeroSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";

// Thin wrapper for "/" (issue #53): reads the live ledger and feeds the props-only OwedView.
// Owed vs "maybe" uses the same rule as the hero total (countsTowardOwed, #77 Option A: drafted findings stay owed).
// Empty store: no auto-load; the user explicitly loads the synthetic demo (#28 DECISION).

function splitFindings(ledger: LedgerResponse): { owedItems: OwedFindingItem[]; maybeItems: OwedFindingItem[] } {
  const ordersById = new Map<string, NormalizedOrder>(ledger.orders.map((order) => [order.id, order]));
  const toItem = (finding: Finding): OwedFindingItem => ({
    finding,
    merchant: ordersById.get(finding.orderId)?.merchant.name ?? "Unknown merchant",
  });
  const outstanding = ledger.findings.filter(isOutstandingFinding);
  return {
    owedItems: outstanding.filter((f) => countsTowardOwed(f, ordersById.get(f.orderId))).map(toItem),
    maybeItems: outstanding.filter((f) => !countsTowardOwed(f, ordersById.get(f.orderId))).map(toItem),
  };
}

export default function Home() {
  const router = useRouter();
  const ledger = useLedger();
  const loadDemo = useLoadDemo();

  async function handleLoadDemo() {
    const result = await loadDemo.run();
    if (result) ledger.refetch();
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
          title={loadDemo.error ? "Couldn't load the demo data" : "Couldn't load your ledger"}
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
  const { owedItems, maybeItems } = splitFindings(data);

  return (
    <OwedView
      summary={data.summary}
      owedItems={owedItems}
      maybeItems={maybeItems}
      simulatedLabel={data.labels.simulatedPrice}
      onOpenClaim={(id) => router.push(`/claim/${encodeIdSegment(id)}`)}
      onOpenReview={() => router.push("/review")}
      onBrowseLedger={() => router.push("/ledger")}
      onLoadDemo={data.mode === "empty" ? handleLoadDemo : undefined}
    />
  );
}
