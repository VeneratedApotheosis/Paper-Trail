"use client";

import { useState } from "react";
import { TrustView, type DeleteReceipt } from "@/components/views/TrustView";
import { auditLog, findings, orders } from "@/lib/mock/data";

// Thin wrapper: supplies the current mock data + optimistic callbacks to the
// props-only TrustView. The real wiring (exclude list persistence +
// POST /api/delete-all) is ui-wiring (Kenan); here the handlers are local only.
export default function TrustPage() {
  const merchants = Array.from(new Set(orders.map((o) => o.merchant.name))).sort();
  const [excludedMerchants, setExcludedMerchants] = useState<string[]>([]);
  const [deleteReceipt, setDeleteReceipt] = useState<DeleteReceipt | null>(null);

  function handleToggleMerchant(name: string, exclude: boolean) {
    setExcludedMerchants((prev) =>
      exclude ? Array.from(new Set([...prev, name])) : prev.filter((m) => m !== name),
    );
  }

  function handleDeleteAll() {
    // Mock-only: simulate the deletion receipt so the demo flow is complete.
    setDeleteReceipt({
      ordersPurged: orders.length,
      findingsPurged: findings.length,
      auditEntriesPurged: auditLog.length,
      completedAt: new Date().toISOString(),
    });
  }

  return (
    <TrustView
      auditEntries={auditLog}
      merchants={merchants}
      excludedMerchants={excludedMerchants}
      onToggleMerchant={handleToggleMerchant}
      onDeleteAll={handleDeleteAll}
      deleteReceipt={deleteReceipt}
    />
  );
}
