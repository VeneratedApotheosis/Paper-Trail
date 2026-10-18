"use client";

import { useState } from "react";
import type { Finding, FindingKind, NormalizedOrder, OrderEvent } from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { ConfidenceChip } from "@/components/ConfidenceChip";
import { SourceBadge } from "@/components/SourceBadge";
import { orderSources, type SourceAccount } from "@/components/sourceAccounts";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { StatusChip } from "@/components/StatusChip";
import { claimActionLabel, confidenceBarPercent, orderConfidence, sourceCardText } from "@/components/views/orderDetailHelpers";
import { confidenceLabel, countdownLabel, formatDate, formatMoney } from "@/lib/format";
import { deriveOrderStatus, merchantName, orderCorrectedByUser, orderNeedsReview } from "@/lib/view";

// Props-only detail view for one order. All data arrives as props (typed via
// @/lib/contracts) and the only action is the onBack callback, so the page
// wrapper owns data + navigation. No fetch, no @/lib/api, no routing here.
export interface OrderDetailViewProps {
  order: NormalizedOrder;
  findings: Finding[];
  // Label for findings backed by the simulated price feed (hard rule 8).
  // Optional + defaulted so the existing page wrapper keeps compiling until
  // ui-wiring passes the real label.
  simulatedLabel?: string;
  // Linked Gmail accounts (issue #115): `order.sources` ids are shown as the mailbox they came from.
  accounts?: readonly SourceAccount[];
  onBack: () => void;
  // Opens the claim draft for one finding. The Draft a claim button is hidden when this is omitted.
  onOpenClaim?: (findingId: string) => void;
  // "Not a purchase" (#134). Each action is hidden when its callback is omitted. The view asks for a confirmation before
  // calling onMarkNotPurchase; the page wrapper owns the request and reports its state in `feedback`.
  onMarkNotPurchase?: () => void;
  // One timeline email is not about this purchase (shown only for orders built from several emails).
  onMarkEmailNotAboutOrder?: (emailId: string) => void;
  // Undo for the notice shown after either action.
  onRestore?: () => void;
  feedback?: {
    pending: boolean;
    error: string | null;
    // What was just done: the whole purchase was marked (the order is gone, only the notice is shown) or one email.
    notice: "purchase" | "email" | null;
  };
}

// Human labels for each event type (contracts: OrderEventTypeSchema).
const EVENT_LABEL: Record<OrderEvent["type"], string> = {
  placed: "Order placed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  ready_for_pickup: "Ready for pickup",
  delivered: "Delivered",
  return_started: "Return started",
  return_dropped: "Return dropped off",
  return_received: "Return received",
  refund_issued: "Refund issued",
  store_credit: "Store credit issued",
  price_adjust: "Price adjustment",
  cancel: "Cancelled",
};

// Human headline per rule kind (rules R1-R4, deepdive section 4).
const FINDING_LABEL: Record<FindingKind, string> = {
  refund_overdue: "Refund overdue",
  refund_short: "Refund came up short",
  return_deadline: "Return window closing",
  price_drop: "Price dropped",
  rewards_gap: "Rewards missed",
};

export function OrderDetailView({
  order,
  findings,
  simulatedLabel = "Simulated price feed",
  accounts = [],
  onBack,
  onOpenClaim,
  onMarkNotPurchase,
  onMarkEmailNotAboutOrder,
  onRestore,
  feedback = { pending: false, error: null, notice: null },
}: OrderDetailViewProps) {
  const [confirming, setConfirming] = useState(false);
  const needsReview = orderNeedsReview(order);
  const sources = orderSources(order.sources, accounts);
  const { currency } = order;
  const events = [...order.events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex min-h-[44px] items-center self-start text-[0.8125rem] font-semibold text-teal-deep underline-offset-2 hover:underline xl:order-2"
    >
      ← Purchases
    </button>
  );
  const undoNotice = feedback.notice ? (
    <div role="status" className="neu-inset mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-6 py-4">
      <p className="text-sm text-ink">
        {feedback.notice === "purchase"
          ? "Marked as not a purchase. It no longer counts toward what you’re owed, and future syncs skip its emails."
          : "That email no longer counts toward this purchase."}
      </p>
      {onRestore ? (
        <Button variant="secondary" disabled={feedback.pending} onClick={onRestore}>Undo</Button>
      ) : null}
    </div>
  ) : null;
  const feedbackError = feedback.error ? <p role="alert" className="mt-3 text-sm text-ink">{feedback.error}</p> : null;

  // The order is gone from the ledger: only the notice (with Undo) is left to show.
  if (feedback.notice === "purchase") {
    return (
      <AppShell>
        {backButton}
        {undoNotice}
        {feedbackError}
      </AppShell>
    );
  }

  const confidence = orderConfidence(order, findings);
  const card = "neu-raised rounded-lg p-5 xl:p-6";
  const cardTitle = "font-serif text-xl text-ink";

  return (
    <AppShell>
      {/* data-layout="wide" lets the shell use the full desktop width (#133); below xl it is one column. */}
      <div data-layout="wide" className="mx-auto max-w-ledger xl:max-w-none">
        <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between xl:gap-8">
          {backButton}
          <div className="sr-only xl:not-sr-only xl:order-1 xl:space-y-1.5">
            <h1 className="font-serif text-3xl text-ink xl:text-[2.5rem] xl:leading-tight">Purchase details</h1>
            {order.orderRef ? <p className="text-[0.9375rem] text-ink-muted">Order {order.orderRef}</p> : null}
          </div>
        </div>
        {undoNotice}
        {feedbackError}

        {/* One column on a phone (summary, money back, items, timeline); from xl the main card and timeline sit left
            and the money, confidence and source cards sit in a right rail. `contents` + order keeps one DOM copy. */}
        <div className="mt-2 flex flex-col gap-4 xl:mt-5 xl:grid xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start xl:gap-8">
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-5">
            {/* Summary card */}
            <section aria-label="Purchase summary" className="neu-raised order-1 rounded-lg p-5 xl:order-none xl:p-8">
              <header className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between xl:gap-6">
                <div className="min-w-0 space-y-2.5 xl:space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip status={deriveOrderStatus(order)} />
                    {needsReview ? <Chip tone="review">Needs a quick check</Chip> : null}
                    {orderCorrectedByUser(order) ? <Chip tone="saved">Corrected by you</Chip> : null}
                    <SourceBadge sources={sources} full />
                  </div>
                  <h2 className="font-serif text-[1.875rem] leading-9 text-ink xl:text-4xl xl:leading-10">{merchantName(order)}</h2>
                  <p className="text-xs leading-4 text-ink-muted xl:text-[0.8125rem] xl:leading-5">
                    {order.orderRef ? `Order ${order.orderRef}, ` : ""}
                    {order.orderRef ? "placed" : "Placed"} {formatDate(order.placedAt)}
                    {order.merchant.domain ? <span className="hidden xl:block">{order.merchant.domain}</span> : null}
                  </p>
                </div>
                <div className="xl:text-right">
                  <div className="eyebrow sr-only xl:not-sr-only">Total</div>
                  <div className="font-serif text-[2.125rem] font-semibold leading-[2.625rem] tabular-nums text-money">
                    {formatMoney(order.total, currency)}
                  </div>
                  {onMarkNotPurchase && !confirming ? (
                    <Button variant="ghost" className="mt-2 xl:-mr-2" onClick={() => setConfirming(true)}>Not a purchase</Button>
                  ) : null}
                </div>
              </header>

              {onMarkNotPurchase && confirming ? (
                <div role="group" aria-label="Confirm not a purchase" className="neu-inset mt-5 rounded-lg px-5 py-4">
                  <p className="text-sm text-ink">
                    Mark this as not a purchase? It stops counting toward what you’re owed, and future syncs skip its{" "}
                    {order.messageIds.length === 1 ? "email" : `${order.messageIds.length} emails`}. You can undo this right after.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button
                      disabled={feedback.pending}
                      onClick={() => {
                        setConfirming(false);
                        onMarkNotPurchase();
                      }}
                    >
                      Yes, not a purchase
                    </Button>
                    <Button variant="secondary" disabled={feedback.pending} onClick={() => setConfirming(false)}>Cancel</Button>
                  </div>
                </div>
              ) : null}

              {/* Total breakdown */}
              <dl className="mt-3 space-y-2.5 text-[0.8125rem] xl:ml-auto xl:mt-5 xl:w-[16.25rem] xl:space-y-1.5 xl:border-t xl:border-rule xl:pt-2">
                {order.subtotal !== null ? (
                  <BreakdownRow label="Subtotal" value={formatMoney(order.subtotal, currency)} />
                ) : null}
                {order.tax !== null ? (
                  <BreakdownRow label="Tax" value={formatMoney(order.tax, currency)} />
                ) : null}
                {order.shipping !== null ? (
                  <BreakdownRow label="Shipping" value={formatMoney(order.shipping, currency)} />
                ) : null}
                {order.discount !== null ? (
                  <BreakdownRow label="Discount" value={`−${formatMoney(order.discount, currency)}`} />
                ) : null}
              </dl>
            </section>

            {/* Line items */}
            <section aria-label="Items" className={`${card} order-3 space-y-2.5 xl:order-none xl:space-y-0`}>
              <h2 className={`${cardTitle} xl:mb-2`}>Items</h2>
              <ul>
                {order.lineItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-4 py-1 text-[0.8125rem] xl:border-t xl:border-rule xl:py-3 xl:text-[0.9375rem]">
                    <span className="min-w-0 flex-1 text-ink-muted xl:text-ink">
                      {item.name}
                      {item.qty > 1 ? <span className="xl:hidden"> × {item.qty}</span> : null}
                      {item.returnedQty > 0 ? (
                        <span className="block text-xs text-ink-faint">
                          {item.returnedQty} of {item.qty} returned
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden w-12 text-right tabular-nums text-ink-muted xl:block">{item.qty}</span>
                    <span className="text-right tabular-nums text-ink xl:w-24">{formatMoney(item.unitPrice, currency)}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Event timeline */}
            <section aria-label="Timeline" className={`${card} order-4 space-y-2.5 xl:order-none xl:space-y-3`}>
              <h2 className={cardTitle}>Timeline</h2>
              <p className="hidden text-[0.8125rem] text-ink-muted xl:block">
                Each step comes from one email. The quote shows where we read it.
              </p>
              <ol>
                <TimelineRow at={order.placedAt} label="Order placed" last={events.length === 0} />
                {events.map((event, index) => (
                  <TimelineRow
                    key={event.id}
                    at={event.at}
                    label={EVENT_LABEL[event.type]}
                    last={index === events.length - 1}
                    extra={
                      <>
                        {event.amount != null ? (
                          <span className="font-serif tabular-nums text-money">{formatMoney(event.amount, currency)}</span>
                        ) : null}
                        <ConfidenceChip confidence={event.conf} />
                      </>
                    }
                  >
                    {event.evidence ? (
                      <blockquote className="neu-inset rounded-md px-4 py-3 text-[0.8125rem] italic leading-5 text-ink-muted">
                        “{event.evidence}”
                      </blockquote>
                    ) : null}
                    {onMarkEmailNotAboutOrder && order.messageIds.length > 1 ? (
                      <button
                        type="button"
                        disabled={feedback.pending}
                        onClick={() => onMarkEmailNotAboutOrder(event.messageId)}
                        className="inline-flex min-h-[44px] items-center self-start text-sm font-semibold text-teal-deep underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        Not about this purchase
                      </button>
                    ) : null}
                  </TimelineRow>
                ))}
              </ol>
            </section>
          </div>

          <div className="contents xl:flex xl:flex-col xl:gap-5">
            {/* Money you can get back on this order */}
            {findings.length > 0 ? (
              <div className="contents">
                {findings.map((finding, index) => {
                  const action = onOpenClaim ? claimActionLabel(finding.status) : null;
                  const active = finding.status === "open" || finding.status === "drafted";
                  return (
                    <section
                      key={finding.id}
                      className={`${card} order-2 space-y-3 xl:order-none xl:space-y-3.5`}
                      aria-label={`Money you can get back: ${FINDING_LABEL[finding.kind]}`}
                    >
                      <p className="eyebrow">Money you can get back{findings.length > 1 ? ` (${index + 1} of ${findings.length})` : ""}</p>
                      <h2 className="font-serif text-xl text-ink xl:text-[1.375rem] xl:leading-7">{FINDING_LABEL[finding.kind]}</h2>
                      <p className="font-serif text-[1.875rem] font-semibold leading-9 tabular-nums text-money xl:text-[2.75rem] xl:leading-[3.375rem]">
                        {formatMoney(finding.amountAtStake, finding.currency)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {finding.dueAt && active ? <Chip tone="deadline">{countdownLabel(finding.dueAt)}</Chip> : null}
                        <Chip tone="neutral">{confidenceLabel(orderConfidenceOf(finding, order.confMin))}</Chip>
                        {finding.simulated ? <Chip tone="neutral">{simulatedLabel}</Chip> : null}
                      </div>
                      <p className="text-[0.8125rem] leading-5 text-ink-muted">{finding.summary}</p>
                      {finding.evidence.map((e, i) => (
                        <blockquote
                          key={`${e.messageId}-${i}`}
                          className="neu-inset rounded-md p-4 text-[0.8125rem] italic leading-5 text-ink-muted"
                        >
                          “{e.quote}”
                        </blockquote>
                      ))}
                      {action ? (
                        <button
                          type="button"
                          onClick={() => onOpenClaim?.(finding.id)}
                          className="neu-accent inline-flex min-h-[48px] w-full items-center justify-center rounded-full px-6 text-sm font-bold transition-[box-shadow,transform] active:scale-[0.99] xl:min-h-[44px]"
                        >
                          {action}
                        </button>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ) : null}

            <section aria-label="How sure we are" className={`${card} order-5 hidden space-y-3.5 xl:order-none xl:block`}>
              <h2 className={cardTitle}>How sure are we</h2>
              <p className="mt-3.5 text-[0.8125rem] leading-5 text-ink-muted">
                Clear means the dates and amounts in the email were easy to read. Unclear items go to Needs a quick check and are not counted.
              </p>
              <div className="mt-3.5 space-y-1.5">
                <div className="flex items-center justify-between text-[0.8125rem]">
                  <span className="text-ink">Confidence</span>
                  <span className="text-ink-muted">{confidenceLabel(confidence)}</span>
                </div>
                <div
                  role="img"
                  aria-label={`Confidence ${confidenceBarPercent(confidence)} percent`}
                  className="neu-inset h-2 rounded-full"
                >
                  <div className="neu-accent h-2 rounded-full" style={{ width: `${confidenceBarPercent(confidence)}%` }} />
                </div>
              </div>
            </section>

            <section aria-label="Source" className={`${card} order-6 hidden xl:order-none xl:block`}>
              <h2 className={cardTitle}>Source</h2>
              <p className="mt-3.5 text-[0.8125rem] leading-5 text-ink-muted">{sourceCardText(order.messageIds.length, sources)}</p>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// A finding's own confidence when its rule recorded one, otherwise the order's.
function orderConfidenceOf(finding: Finding, fallback: number): number {
  return orderConfidence({ confMin: fallback }, [finding]);
}

function TimelineRow({
  at,
  label,
  last,
  extra,
  children,
}: {
  at: string;
  label: string;
  last: boolean;
  extra?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="hidden w-3 shrink-0 flex-col items-center xl:flex" aria-hidden>
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-teal-deep" />
        {last ? null : <span className="w-0.5 grow bg-rule" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1 xl:pb-4 xl:pt-0">
        <div className="flex items-baseline justify-between gap-3 xl:flex-row-reverse">
          <span className="text-[0.8125rem] tabular-nums text-ink-muted xl:text-xs">{formatDate(at)}</span>
          <span className="flex flex-wrap items-center justify-end gap-2 text-right text-[0.8125rem] text-ink xl:justify-start xl:text-left xl:text-[0.9375rem]">
            {label}
            {extra}
          </span>
        </div>
        {children}
      </div>
    </li>
  );
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}