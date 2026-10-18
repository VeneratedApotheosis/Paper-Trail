"use client";

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
  onConfirm: (orderId: string) => void;
  // Field edits bubble as the typed OrderFieldEdit ReviewCard emits (numeric
  // fields stay numbers) so the edit flow is type-safe end to end.
  onEditField: (orderId: string, edit: OrderFieldEdit) => void;
}

export function ReviewView({ items, onConfirm, onEditField }: ReviewViewProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="font-serif text-3xl text-ink">Needs a quick check</h1>
        <p className="mt-2 max-w-ledger text-base text-ink-muted">
          We weren&apos;t sure we read these orders correctly. They aren&apos;t counted in what
          you&apos;re owed until you confirm them.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState title="Nothing needs a quick check">
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
                onEdit={onEditField}
                onConfirm={onConfirm}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
