import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Chip } from "@/components/ui/Chip";
import { StatusChip } from "@/components/StatusChip";
import { EmptyState } from "@/components/states";
import type { OrderEvent } from "@/lib/contracts";
import { confidencePercent, formatDate, formatMoney } from "@/lib/format";
import { deriveOrderStatus, merchantName, orderNeedsReview } from "@/lib/view";
import { getOrder } from "@/lib/mock/data";

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

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = getOrder(id);

  if (!order) {
    return (
      <AppShell>
        <EmptyState
          title="Order not found"
          actions={
            <Link
              href="/ledger"
              className="rounded-sm border border-rule bg-paper px-3 py-1.5 text-sm text-ink hover:bg-paper-raised"
            >
              Back to ledger
            </Link>
          }
        >
          We couldn&apos;t find an order with id <code>{id}</code>. It may have been removed.
        </EmptyState>
      </AppShell>
    );
  }

  const needsReview = orderNeedsReview(order);
  const { currency } = order;
  const events = [...order.events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  return (
    <AppShell>
      <Link href="/ledger" className="text-sm text-ink-muted hover:text-ink">
        ← Ledger
      </Link>

      {/* Order header */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={deriveOrderStatus(order)} />
            {needsReview ? <Chip tone="review">Needs review</Chip> : null}
            {order.merchant.domain ? <Chip tone="neutral">{order.merchant.domain}</Chip> : null}
          </div>
          <h1 className="mt-3 font-serif text-3xl text-ink">{merchantName(order)}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {order.orderRef ? <>Order {order.orderRef} · </> : null}
            Placed {formatDate(order.placedAt)}
          </p>
        </div>
        <div className="text-right">
          <div className="col-head">Total</div>
          <div className="mt-1 font-serif text-2xl tabular-nums text-ink">
            {formatMoney(order.total, currency)}
          </div>
        </div>
      </header>

      {/* Total breakdown */}
      <section className="mt-6">
        <h2 className="col-head">Breakdown</h2>
        <dl className="mt-2 max-w-sm space-y-1 text-sm">
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
          <div className="flex items-center justify-between border-t border-rule pt-1 font-medium text-ink">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(order.total, currency)}</dd>
          </div>
        </dl>
      </section>

      {/* Line items */}
      <section className="mt-8">
        <h2 className="col-head">Items</h2>
        <div className="mt-2">
          <div className="flex items-center gap-4 border-b border-rule pb-2">
            <span className="col-head min-w-0 flex-1">Item</span>
            <span className="col-head w-12 text-right">Qty</span>
            <span className="col-head w-24 text-right">Unit price</span>
            <span className="col-head w-20 text-right">Returned</span>
          </div>
          {order.lineItems.map((item) => (
            <div key={item.id} className="flex items-center gap-4 border-b border-rule py-3">
              <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
              <span className="w-12 text-right tabular-nums text-ink-muted">{item.qty}</span>
              <span className="w-24 text-right tabular-nums text-ink">
                {formatMoney(item.unitPrice, currency)}
              </span>
              <span className="w-20 text-right tabular-nums text-ink-muted">
                {item.returnedQty > 0 ? `${item.returnedQty} of ${item.qty}` : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Event timeline */}
      <section className="mt-8">
        <h2 className="col-head">Timeline</h2>
        <ol className="mt-3 space-y-5">
          <li className="flex gap-4">
            <span className="w-24 shrink-0 text-sm tabular-nums text-ink-muted">
              {formatDate(order.placedAt)}
            </span>
            <span className="font-medium text-ink">Order placed</span>
          </li>
          {events.map((event) => (
            <li key={event.id} className="flex gap-4">
              <span className="w-24 shrink-0 text-sm tabular-nums text-ink-muted">
                {formatDate(event.at)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{EVENT_LABEL[event.type]}</span>
                  {event.amount != null ? (
                    <span className="tabular-nums text-ink">
                      {formatMoney(event.amount, currency)}
                    </span>
                  ) : null}
                  <Chip tone="neutral">{confidencePercent(event.conf)} confidence</Chip>
                </div>
                {event.evidence ? (
                  <blockquote className="mt-2 border-l-2 border-rule bg-paper-sunk px-3 py-2 text-sm italic text-ink-muted">
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
