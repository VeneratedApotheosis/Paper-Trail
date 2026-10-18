"use client";

import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import type { OrderFieldEdit } from "@/components/ReviewCard";
import { EmptyState, ErrorState, OrderDetailSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { ReviewView } from "@/components/views/ReviewView";
import { invalidate, useLedger } from "@/hooks";
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
  | { kind: "failed"; merchant: string; message: string; savedEdits: number };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function NoticeState({ notice }: { notice: Notice }) {
  switch (notice.kind) {
    case "confirmed":
      return (
        <EmptyState title={`Confirmed ${notice.merchant}`}>
          {notice.owedFindings > 0
            ? `It left the review queue, and ${plural(notice.owedFindings, "finding")} on it now ${
                notice.owedFindings === 1 ? "counts" : "count"
              } toward what you're owed (${notice.owedTotal} in total).`
            : "It left the review queue. No money-back findings apply to it right now."}{" "}
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
          title="Couldn't load your review queue"
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

  async function handleConfirm(orderId: string) {
    const stored = storedById.get(orderId);
    if (!stored || inFlight.current) return;
    inFlight.current = true;
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
    }
  }

  return (
    <AppShell demo={showsDemo}>
      {notice ? <NoticeState notice={notice} /> : null}
      <ReviewView items={shownOrders} onConfirm={handleConfirm} onEditField={handleEditField} />
      {unreadable.length > 0 ? (
        <ErrorState
          title={`${plural(unreadable.length, "email")} couldn't be read automatically`}
          what={`PaperTrail couldn't turn ${unreadable.length === 1 ? "it" : "them"} into ${
            unreadable.length === 1 ? "an order" : "orders"
          }, so ${unreadable.length === 1 ? "it isn't" : "they aren't"} in your ledger or your owed total.`}
          fix={`There is nothing to confirm here. If you think money is owed on ${
            unreadable.length === 1 ? "it" : "one of them"
          }, check that receipt in your inbox.`}
        />
      ) : null}
    </AppShell>
  );
}
