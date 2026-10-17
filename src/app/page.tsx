"use client";

import { useRouter } from "next/navigation";
import type { Finding } from "@/lib/contracts";
import { OwedView, type OwedFindingItem } from "@/components/views/OwedView";
import { findings, getOrder, owedSummary, SIMULATED_PRICE_LABEL } from "@/lib/mock/data";
import { findingCountsTowardOwed, merchantName } from "@/lib/view";

// Thin wrapper: supplies the current mock data + navigation to the props-only
// OwedView. ui-wiring (Kenan) replaces the mock source with the live /api/ledger
// here; the view itself stays data-agnostic.
export default function Home() {
  const router = useRouter();
  const summary = owedSummary();
  const open = findings.filter((f) => f.status === "open");
  const toItem = (f: Finding): OwedFindingItem => ({
    finding: f,
    merchant: merchantName(getOrder(f.orderId)),
  });
  const owedItems = open.filter((f) => findingCountsTowardOwed(f, getOrder(f.orderId))).map(toItem);
  const maybeItems = open.filter((f) => !findingCountsTowardOwed(f, getOrder(f.orderId))).map(toItem);

  return (
    <OwedView
      summary={summary}
      owedItems={owedItems}
      maybeItems={maybeItems}
      simulatedLabel={SIMULATED_PRICE_LABEL}
      onOpenClaim={(id) => router.push(`/claim/${id}`)}
      onOpenReview={() => router.push("/review")}
      onBrowseLedger={() => router.push("/ledger")}
    />
  );
}
