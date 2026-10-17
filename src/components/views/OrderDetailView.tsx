"use client";

import type { Finding, FindingKind, NormalizedOrder, OrderEvent } from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { Chip } from "@/components/ui/Chip";
import { StatusChip } from "@/components/StatusChip";
import { confidencePercent, formatDate, formatMoney } from "@/lib/format";
import { deriveOrderStatus, merchantName, orderNeedsReview } from "@/lib/view";

// Props-only detail view for one order. All data arrives as props (typed via
// @/lib/contracts) and the only action is the onBack callback, so the page
// wrapper owns data + navigation. No fetch, no @/lib/api, no routing here.
export interface OrderDetailViewProps {
  order: NormalizedOrder;
  findings: Finding[];
  onBack: () => void;
}

// Human labels for each event type (contracts: OrderEventTypeSchema).
const EVENT_LABEL: Record<OrderEvent["type"], string> = {
  shipped: "Shipped",
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

export function OrderDetailView({ order, findings, onBack }: OrderDetailViewProps) {
  const needsReview = orderNeedsReview(order);
  const { currency } = order;
  const events = [...order.events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  return (
    <AppShell>
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium text-ink-muted hover:text-ink"
      >
        ← Ledger
      </button>

      {/* Summary card */}
      <section className="neu-raised mt-4 rounded-lg px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={deriveOrderStatus(order)} />
              {needsReview ? <Chip tone="review">Needs review</Chip> : null}
            </div>
            <h1 className="mt-3 font-serif text-3xl text-ink">{merchantName(order)}</h1>
            <p className="mt-1 text-sm text-ink-faint">
              {order.merchant.domain ? (
                <span className="block">{order.merchant.domain}</span>
              ) : null}
              {order.orderRef ? (
                <span className="block">Order {order.orderRef}</span>
              ) : null}
              <span className="block">Placed {formatDate(order.placedAt)}</span>
            </p>
          </div>
          <div className="text-right">
            <div className="eyebrow">Total</div>
            <div className="mt-1 font-serif text-2xl tabular-nums text-money">
              {formatMoney(order.total, currency)}
            </div>
          </div>
        </header>

        {/* Total breakdown */}
        <dl className="mt-6 max-w-sm space-y-1 text-sm">
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
          <div className="flex items-center justify-between border-t border-rule pt-2 font-medium text-ink">
            <dt>Total</dt>
            <dd className="font-serif tabular-nums text-money">{formatMoney(order.total, currency)}</dd>
          </div>
        </dl>

        {/* Line items */}
        <div className="mt-7">
          <h2 className="eyebrow">Items</h2>
          <div className="mt-3">
            <div className="flex items-center gap-4 pb-2">
              <span className="eyebrow min-w-0 flex-1">Item</span>
              <span className="eyebrow w-12 text-right">Qty</span>
              <span className="eyebrow w-24 text-right">Unit price</span>
              <span className="eyebrow w-20 text-right">Returned</span>
            </div>
            {order.lineItems.map((item) => (
              <div key={item.id} className="flex items-center gap-4 border-t border-rule py-3">
                <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
                <span className="w-12 text-right tabular-nums text-ink-muted">{item.qty}</span>
                <span className="w-24 text-right tabular-nums text-ink">
                  {formatMoney(item.unitPrice, currency)}
                </span>
                <span className="w-20 text-right tabular-nums text-ink-muted">
                  {item.returnedQty > 0 ? `${item.returnedQty} of ${item.qty}` : "none"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Findings on this order */}
      {findings.length > 0 ? (
        <section
          className="neu-raised mt-6 rounded-lg px-6 py-6"
          aria-label="Findings on this order"
        >
          <h2 className="eyebrow">Findings</h2>
          <ul className="mt-4 space-y-6">
            {findings.map((finding) => (
              <li key={finding.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{FINDING_LABEL[finding.kind]}</span>
                  <span className="font-serif tabular-nums text-money">
                    {formatMoney(finding.amountAtStake, finding.currency)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-muted">{finding.summary}</p>
                {finding.evidence.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {finding.evidence.map((e, i) => (
                      <li
                        key={`${e.messageId}-${i}`}
                        className="neu-inset rounded-sm px-4 py-3 text-sm italic text-ink-muted"
                      >
                        “{e.quote}”
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Event timeline */}
      <section className="neu-raised mt-6 rounded-lg px-6 py-6">
        <h2 className="eyebrow">Timeline</h2>
        <ol className="mt-4 space-y-6">
          <li className="flex gap-4">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-teal" aria-hidden />
            <span className="w-24 shrink-0 text-sm tabular-nums text-ink-faint">
              {formatDate(order.placedAt)}
            </span>
            <span className="font-medium text-ink">Order placed</span>
          </li>
          {events.map((event) => (
            <li key={event.id} className="flex gap-4">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-teal" aria-hidden />
              <span className="w-24 shrink-0 text-sm tabular-nums text-ink-faint">
                {formatDate(event.at)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{EVENT_LABEL[event.type]}</span>
                  {event.amount != null ? (
                    <span className="font-serif tabular-nums text-money">
                      {formatMoney(event.amount, currency)}
                    </span>
                  ) : null}
                  <Chip tone="neutral">{confidencePercent(event.conf)} confidence</Chip>
                </div>
                {event.evidence ? (
                  <blockquote className="neu-inset mt-3 rounded-sm px-4 py-3 text-sm italic text-ink-muted">
                    “{event.evidence}”
                  </blockquote>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </AppShell>
  );
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-ink-muted">
      <dt>{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}
