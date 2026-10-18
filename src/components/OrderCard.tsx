import type { NormalizedOrder } from "@/lib/contracts";
import { Chip } from "@/components/ui/Chip";
import { SourceBadge } from "@/components/SourceBadge";
import type { OrderSource } from "@/components/sourceAccounts";
import { StatusChip } from "@/components/StatusChip";
import { formatMoney, formatShortDate } from "@/lib/format";
import { deriveOrderStatus, merchantName, orderNeedsReview } from "@/lib/view";

// One purchase as a soft neumorphic card. Merchant in the serif, source
// domain and date quiet below it, status on the right and the total in the
// deep-teal money serif. Props-only: opening the order is a callback so the
// caller owns navigation (no Link/router in here).
export function OrderCard({
  order,
  sources,
  onOpen,
}: {
  order: NormalizedOrder;
  // Mailboxes the purchase came from (issue #115); omitted for demo and uploaded purchases.
  sources?: readonly OrderSource[];
  onOpen: () => void;
}) {
  const needsReview = orderNeedsReview(order);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="neu-raised grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 rounded-lg p-5 text-left transition-shadow hover:shadow-soft-lg md:grid-cols-[minmax(0,1fr)_auto_7rem] md:items-center md:py-4"
    >
      <span className="min-w-0">
        <span className="block font-serif text-lg text-ink md:truncate">{merchantName(order)}</span>
        <span className="mt-0.5 block text-sm text-ink-faint">
          {order.merchant.domain ? <span className="block truncate">{order.merchant.domain}</span> : null}
          <span className="block tabular-nums">{formatShortDate(order.placedAt)}</span>
        </span>
        {sources && sources.length > 0 ? (
          <span className="mt-1.5 flex">
            <SourceBadge sources={sources} />
          </span>
        ) : null}
      </span>
      <span className="text-right font-serif text-lg tabular-nums text-money md:order-3">
        {formatMoney(order.total, order.currency)}
      </span>
      <span className="col-span-2 flex flex-wrap items-center gap-2 md:order-2 md:col-span-1 md:justify-end">
        <StatusChip status={deriveOrderStatus(order)} />
        {needsReview ? <Chip tone="review">Needs a quick check</Chip> : null}
      </span>
    </button>  );
}
