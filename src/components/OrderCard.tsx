import type { NormalizedOrder } from "@/lib/contracts";
import { Chip } from "@/components/ui/Chip";
import { StatusChip } from "@/components/StatusChip";
import { formatMoney, formatShortDate } from "@/lib/format";
import { deriveOrderStatus, merchantName, orderNeedsReview } from "@/lib/view";

// One ledger entry as a soft neumorphic card. Merchant in the serif, source
// domain and date quiet below it, status on the right and the total in the
// deep-teal money serif. Props-only: opening the order is a callback so the
// caller owns navigation (no Link/router in here).
export function OrderCard({
  order,
  onOpen,
}: {
  order: NormalizedOrder;
  onOpen: () => void;
}) {
  const needsReview = orderNeedsReview(order);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="neu-raised flex w-full items-center gap-4 rounded-lg px-5 py-4 text-left transition-shadow hover:shadow-soft-lg"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-serif text-lg text-ink">{merchantName(order)}</span>
        <span className="mt-0.5 block text-sm text-ink-faint">
          {order.merchant.domain ? (
            <span className="truncate">{order.merchant.domain}</span>
          ) : null}
          <span className="block tabular-nums">{formatShortDate(order.placedAt)}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <StatusChip status={deriveOrderStatus(order)} />
        {needsReview ? <Chip tone="review">Needs review</Chip> : null}
      </span>
      <span className="w-28 shrink-0 text-right font-serif text-lg tabular-nums text-money">
        {formatMoney(order.total, order.currency)}
      </span>
    </button>
  );
}
