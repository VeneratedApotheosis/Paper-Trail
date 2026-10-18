"use client";

import type { ReactNode } from "react";
import type { ReviewQueueItem } from "@/lib/pipeline/run";
import { Button } from "@/components/ui/Button";
import { ReviewCard, type OrderFieldEdit } from "@/components/ReviewCard";
import { EmptyState } from "@/components/states";
import type { NormalizedOrder } from "@/lib/contracts";
import { ordersLeftSentence, reviewProgress } from "@/components/reviewProgress";

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
  // How many orders were already checked this session. Optional: the "0 of 3 checked" count only renders when this is
  // supplied; without it the side panel shows only the real queue length.
  checkedCount?: number;
  // "See Owed to you" on the empty state; omit to hide it.
  onOpenOwed?: () => void;
}

function RailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="neu-raised flex flex-col gap-3 rounded-lg p-6">
      <h2 className="font-serif text-xl text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function ReviewView({
  items,
  onConfirm,
  onEditField,
  pendingOrderId,
  saveStates = {},
  notice,
  unreadableItems = [],
  onLoadDemo,
  onNotPurchase,
  checkedCount,
  onOpenOwed,
}: ReviewViewProps) {
  const progress = reviewProgress(items.length, checkedCount);
  return (
    // data-layout="wide" lets the shell use the full desktop width (#133); below xl it is one column.
    <div data-layout="wide" className="mx-auto max-w-ledger space-y-6 xl:max-w-none">
      <header className="space-y-2">
        <h1 className="font-serif text-[2.125rem] leading-[2.375rem] text-ink xl:text-[2.5rem] xl:leading-tight">Needs a quick check</h1>
        <p className="max-w-[40rem] text-base text-ink-muted">
          We weren&apos;t sure we read these orders correctly. They aren&apos;t counted in what
          you&apos;re owed until you confirm them.
          {checkedCount !== undefined ? (
            <span className="xl:hidden"> {progress.heading}.</span>
          ) : null}
        </p>
      </header>

      {notice ? <div role="status">{notice}</div> : null}
      {unreadableItems.length ? (
        <section className="neu-inset rounded-lg p-5">
          <h2 className="font-serif text-xl">Emails that need a manual check</h2>
          <p className="mt-2 text-sm">These emails could not become purchases and are excluded from your owed total. Check the receipts in your inbox.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {unreadableItems.map((item, i) => (
              <li key={`${item.emailId}-${i}`}>{item.emailId}: {item.reason}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="space-y-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start xl:gap-8 xl:space-y-0">
        <div className="min-w-0 space-y-5">
          {items.length === 0 ? (
            <EmptyState
              title="Nothing needs a quick check"
              actions={
                <>
                  {onOpenOwed ? <Button className="!rounded-full" onClick={onOpenOwed}>See Owed to you</Button> : null}
                  {onLoadDemo ? <Button className="!rounded-full" variant={onOpenOwed ? "secondary" : "primary"} onClick={onLoadDemo}>Try demo data</Button> : null}
                </>
              }
            >
              Orders we aren&apos;t sure about will show up here.
            </EmptyState>
          ) : (
            <>
              <p className="text-sm text-ink-muted xl:sr-only">
                <span className="font-semibold tabular-nums text-ink">{items.length}</span>{" "}
                order{items.length === 1 ? "" : "s"} left to check.
              </p>
              <div className="flex flex-col gap-5">
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
        </div>

        {/* Side panel from xl only; phones keep the cards and the one-line summary above. */}
        <aside aria-label="About this queue" className="hidden flex-col gap-5 xl:flex">
          <RailCard title={progress.heading}>
            <div
              className="neu-inset h-2.5 overflow-hidden rounded-full"
              role={progress.percent === null ? undefined : "progressbar"}
              aria-label={progress.percent === null ? undefined : "Orders checked"}
              aria-valuenow={progress.percent ?? undefined}
              aria-valuemin={progress.percent === null ? undefined : 0}
              aria-valuemax={progress.percent === null ? undefined : 100}
            >
              {progress.percent ? (
                <div className="h-full rounded-full bg-gradient-to-r from-teal-bright to-teal" style={{ width: `${progress.percent}%` }} />
              ) : null}
            </div>
            <p className="text-sm text-ink-muted">
              {ordersLeftSentence(items.length)}. These orders are not counted in what you&apos;re owed until you confirm them.
            </p>
          </RailCard>
          <RailCard title="How we decide">
            <p className="text-sm text-ink-muted">
              When we are less than 70% sure we read a total, a date or a status correctly, the order waits here for you.
            </p>
          </RailCard>
          <RailCard title="Why check">
            <p className="text-sm text-ink-muted">
              A wrong total could make a claim ask for the wrong amount. Confirm, or fix the field first.
            </p>
          </RailCard>
        </aside>
      </div>
    </div>
  );
}