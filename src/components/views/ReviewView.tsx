"use client";

import type { ReactNode } from "react";
import type { ReviewQueueItem } from "@/lib/pipeline/run";
import { Button } from "@/components/ui/Button";
import { ReviewCard, type OrderFieldEdit } from "@/components/ReviewCard";
import { EmptyState } from "@/components/states";
import type { NormalizedOrder } from "@/lib/contracts";

// Props-only view for the needs-review queue. All data arrives as props (typed
// via @/lib/contracts) and every data operation bubbles via callback, so the page
// wrapper (and later ui-wiring) owns queue state + persistence. No fetch, no
// @/lib/api|store|mock|auth, no routing. ReviewCard's inline "isEditing" stays
// local UI state; only queue/confirm data operations leave the view.
export interface ReviewViewProps {
  items: NormalizedOrder[];
  pendingOrderId?: string | null;
  saveStates?: Record<string, "unsaved" | "saving" | "saved">;
  notice?: ReactNode;
  unreadableItems?: ReviewQueueItem[];
  onLoadDemo?: () => void;
  onConfirm: (orderId: string) => void;
  // Field edits bubble as the typed OrderFieldEdit ReviewCard emits (numeric
  // fields stay numbers) so the edit flow is type-safe end to end.
  onEditField: (orderId: string, edit: OrderFieldEdit) => void;
  // "Not a purchase" (#134) on a card; omit to hide the action.
  onNotPurchase?: (orderId: string) => void;
}

export function ReviewView({ items, onConfirm, onEditField, pendingOrderId, saveStates = {}, notice, unreadableItems = [], onLoadDemo, onNotPurchase }: ReviewViewProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="font-serif text-3xl text-ink">Needs a quick check</h1>
        <p className="mt-2 max-w-ledger text-base text-ink-muted">
          We weren&apos;t sure we read these orders correctly. They aren&apos;t counted in what
          you&apos;re owed until you confirm them.
        </p>
      </div>

      {notice ? <div role="status" className="mb-5">{notice}</div> : null}
      {unreadableItems.length ? <section className="neu-inset mb-5 rounded-lg p-5"><h2 className="font-serif text-xl">Emails that need a manual check</h2><p className="mt-2 text-sm">These emails could not become purchases and are excluded from your owed total. Check the receipts in your inbox.</p><ul className="mt-3 space-y-2 text-sm">{unreadableItems.map((item, i) => <li key={`${item.emailId}-${i}`}>{item.emailId}: {item.reason}</li>)}</ul></section> : null}
      {items.length === 0 ? (
        <EmptyState title="Nothing needs a quick check" actions={onLoadDemo ? <Button onClick={onLoadDemo}>Try demo data</Button> : undefined}>
          Orders we aren&apos;t sure about will show up here.
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-muted">
            <span className="font-semibold tabular-nums text-ink">{items.length}</span>{" "}
            order{items.length === 1 ? "" : "s"} left to check.
          </p>
          <div className="flex flex-col gap-6">
            {items.map((order) => (
              <ReviewCard
                key={order.id}
                order={order}
                pending={Boolean(pendingOrderId)}
                saveState={pendingOrderId === order.id ? "saving" : saveStates[order.id]}
                onEdit={onEditField}
                onConfirm={onConfirm}
                onNotPurchase={onNotPurchase}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
