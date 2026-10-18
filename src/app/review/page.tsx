"use client";

import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import type { OrderFieldEdit } from "@/components/ReviewCard";
import { EmptyState, ErrorState, OrderDetailSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { ReviewView } from "@/components/views/ReviewView";
import { invalidate, useLedger, useMarkNotPurchase, useRestoreOrder } from "@/hooks";
import type { NormalizedOrder } from "@/lib/contracts";
import { formatMoney } from "@/lib/format";
import { countsTowardOwed, orderNeedsReview } from "@/lib/rules/owed";
import { postReviewConfirm, postReviewEdit } from "./reviewApi";
import { applyEdits, bufferEdit, itemsWithoutOrder, saveEditsThenConfirm } from "./reviewFlow";

// Thin wrapper for "/review" (issue #65): the queue is GET /api/ledger's orders that need review (the same filter as
// GET /api/review) plus its reviewQueue. Field edits are buffered here and saved only on Confirm (see reviewFlow.ts),
// through POST /api/review/:id/edit and /confirm (#47). Queue items without an order can't be shown as a card, so
// they are counted in a notice instead of dropped (hard rule 5).

type Notice =
  | { kind: "confirmed"; merchant: string; owedFindings: number; owedTotal: string }
  | { kind: "invalid_edit"; message: string }
  | { kind: "stale"; merchant: string; message: string }
  | { kind: "failed"; merchant: string; message: string; savedEdits: number }
  | { kind: "not_purchase"; orderId: string; merchant: string; owedTotal: string }
  | { kind: "restored"; merchant: string }
  | { kind: "not_purchase_failed"; message: string };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function NoticeState({ notice, onUndo, undoDisabled }: { notice: Notice; onUndo: (orderId: string) => void; undoDisabled: boolean }) {
  switch (notice.kind) {
    case "not_purchase":
      return (
        <EmptyState
          title={`Marked ${notice.merchant} as not a purchase`}
          actions={<Button type="button" variant="secondary" disabled={undoDisabled} onClick={() => onUndo(notice.orderId)}>Undo</Button>}
        >
          It left your purchases and no longer counts toward what you&apos;re owed ({notice.owedTotal} in total). Future syncs skip
          its emails. The change is logged to your audit trail.
        </EmptyState>
      );
    case "restored":
      return (
        <EmptyState title={`${notice.merchant} is back`}>
          It counts as a purchase again. If it needs a quick check it shows up below.
        </EmptyState>
      );
    case "not_purchase_failed":
      return <ErrorState title="Couldn't mark it as not a purchase" what={notice.message} fix="Nothing was changed." />;
    case "confirmed":
      return (
        <EmptyState title={`Confirmed ${notice.merchant}`}>
          {notice.owedFindings > 0
            ? `This purchase is confirmed, and ${plural(notice.owedFindings, "finding")} on it now ${
                notice.owedFindings === 1 ? "counts" : "count"
              } toward what you're owed (${notice.owedTotal} in total).`
            : "This purchase is confirmed. No money is owed on it right now."}{" "}
          The confirmation is logged to your audit trail.
        </EmptyState>
      );
    case "invalid_edit":
      return <ErrorState title="Check your edits" what={notice.message} fix="Nothing was saved. Fix the field, then confirm again." />;
    case "stale":
      return (
        <ErrorState
          title={`${notice.merchant} changed since you opened it`}
          what={notice.message}
          fix="The latest version is shown below and your unsaved edits were cleared. Check it, then confirm again."
        />
      );
    case "failed":
      return (
        <ErrorState
          title={`Couldn't confirm ${notice.merchant}`}
          what={notice.message}
          fix={`${
            notice.savedEdits > 0
              ? `${plural(notice.savedEdits, "edit")} saved; the rest are still shown below.`
              : "Nothing was saved."
          } It stays out of your owed total until you confirm it.`}
        />
      );
  }
}

export default function ReviewPage() {
  const ledger = useLedger();
  const [pendingEdits, setPendingEdits] = useState<Record<string, OrderFieldEdit[]>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const markNotPurchase = useMarkNotPurchase();
  const restoreOrder = useRestoreOrder();
  const [lastAction, setLastAction] = useState<"mark" | "restore" | null>(null);

  const showsDemo = ledger.data?.mode === "demo";

  if (ledger.loading) {
    return (
      <AppShell demo={showsDemo}>
        <OrderDetailSkeleton />
      </AppShell>
    );
  }

  if (ledger.error || !ledger.data) {
    return (
      <AppShell demo={false}>
        <ErrorState
          title="Couldn't load purchases to check"
          what={ledger.error}
          fix="Check that the app server is running, then try again."
          actions={
            <Button type="button" onClick={ledger.refetch}>
              Try again
            </Button>
          }
        />
      </AppShell>
    );
  }

  const storedOrders = ledger.data.orders.filter(orderNeedsReview);
  const unreadable = itemsWithoutOrder(ledger.data.reviewQueue, storedOrders);
  const storedById = new Map<string, NormalizedOrder>(storedOrders.map((order) => [order.id, order]));
  const shownOrders = storedOrders.map((order) => applyEdits(order, pendingEdits[order.id] ?? []));

  function handleEditField(orderId: string, edit: OrderFieldEdit) {
    const stored = storedById.get(orderId);
    if (!stored) return;
    setPendingEdits((prev) => ({ ...prev, [orderId]: bufferEdit(stored, prev[orderId] ?? [], edit) }));
  }

  async function handleNotPurchase(orderId: string) {
    const stored = storedById.get(orderId);
    if (!stored || inFlight.current) return;
    inFlight.current = true;
    setPendingOrderId(orderId);
    setNotice(null);
    setLastAction("mark");
    try {
      const response = await markNotPurchase.run(orderId);
      if (!response) return;
      setPendingEdits((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      setNotice({ kind: "not_purchase", orderId, merchant: response.merchant, owedTotal: formatMoney(response.summary.owedTotal, response.summary.currency) });
    } finally {
      inFlight.current = false;
      setPendingOrderId(null);
    }
  }

  async function handleUndoNotPurchase(orderId: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLastAction("restore");
    try {
      const response = await restoreOrder.run(orderId);
      if (response) setNotice({ kind: "restored", merchant: response.merchant });
    } finally {
      inFlight.current = false;
    }
  }

  async function handleConfirm(orderId: string) {
    const stored = storedById.get(orderId);
    if (!stored || inFlight.current) return;
    inFlight.current = true;
    setPendingOrderId(orderId);
    setNotice(null);
    const sent = pendingEdits[orderId] ?? [];
    const merchant = stored.merchant.name;
    try {
      const outcome = await saveEditsThenConfirm(stored, sent, { edit: postReviewEdit, confirm: postReviewConfirm });
      if (outcome.status === "invalid_edit") {
        setNotice({ kind: "invalid_edit", message: outcome.message });
        return;
      }
      // Saved edits and confirmations change the ledger, audit log and owed total: refresh every cached read.
      await invalidate();
      if (outcome.status === "confirmed" || outcome.status === "stale") {
        setPendingEdits((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      } else {
        // Saved edits are now part of the stored order; edits typed during the request stay buffered.
        const saved = new Set(sent.slice(0, outcome.savedEdits));
        setPendingEdits((prev) => ({ ...prev, [orderId]: (prev[orderId] ?? []).filter((edit) => !saved.has(edit)) }));
      }
      if (outcome.status === "confirmed") {
        const { order, findings, summary } = outcome.response;
        setNotice({
          kind: "confirmed",
          merchant: order.merchant.name,
          owedFindings: findings.filter((finding) => countsTowardOwed(finding, order)).length,
          owedTotal: formatMoney(summary.owedTotal, summary.currency),
        });
      } else if (outcome.status === "stale") {
        setNotice({ kind: "stale", merchant, message: outcome.message });
      } else {
        setNotice({ kind: "failed", merchant, message: outcome.message, savedEdits: outcome.savedEdits });
      }
    } finally {
      inFlight.current = false;
      setPendingOrderId(null);
    }
  }

  const actionError = lastAction === "mark" ? markNotPurchase.error : lastAction === "restore" ? restoreOrder.error : null;
  const shownNotice: Notice | null = notice ?? (actionError ? { kind: "not_purchase_failed", message: actionError } : null);

  return (
    <AppShell demo={showsDemo}>
      <ReviewView items={shownOrders} onConfirm={handleConfirm} onEditField={handleEditField}
        pendingOrderId={pendingOrderId}
        saveStates={Object.fromEntries(Object.entries(pendingEdits).filter(([, edits]) => edits.length).map(([id]) => [id, "unsaved" as const]))}
        onNotPurchase={handleNotPurchase}
        notice={shownNotice ? <NoticeState notice={shownNotice} onUndo={handleUndoNotPurchase} undoDisabled={restoreOrder.pending} /> : null} unreadableItems={unreadable} />
    </AppShell>
  );
}
