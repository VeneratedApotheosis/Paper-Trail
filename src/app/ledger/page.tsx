"use client";

import { useRouter } from "next/navigation";
import { LedgerView } from "@/components/views/LedgerView";
import { orders } from "@/lib/mock/data";

// Thin wrapper: supplies the current mock orders + navigation to the props-only
// LedgerView. ui-wiring (Kenan) replaces the mock source with the live
// /api/ledger here; the view itself stays data-agnostic.
export default function LedgerPage() {
  const router = useRouter();

  return (
    <LedgerView
      orders={orders}
      onOpenOrder={(id) => router.push(`/ledger/${id}`)}
    />
  );
}
