import Link from "next/link";
import type { NormalizedOrder } from "@/lib/contracts";
import { Chip } from "@/components/ui/Chip";
import { StatusChip } from "@/components/StatusChip";
import { formatMoney, formatShortDate } from "@/lib/format";
import { deriveOrderStatus, merchantName, orderNeedsReview } from "@/lib/view";

// One ledger entry: a hairline-ruled row, not a card. Date and amount use
// tabular figures so columns align down the ledger.
export function OrderCard({ order }: { order: NormalizedOrder }) {
  const needsReview = orderNeedsReview(order);
  return (
    <Link
      href={`/ledger/${order.id}`}
      className="flex items-center gap-4 border-b border-rule px-2 py-4 transition-colors hover:bg-paper-raised"
    >
      <span className="w-20 shrink-0 text-sm tabular-nums text-ink-muted">
        {formatShortDate(order.placedAt)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{merchantName(order)}</span>
        {order.merchant.domain ? (
          <span className="mt-1 inline-flex">
            <Chip tone="neutral">{order.merchant.domain}</Chip>
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <StatusChip status={deriveOrderStatus(order)} />
        {needsReview ? <Chip tone="review">Needs review</Chip> : null}
      </span>
      <span className="w-28 shrink-0 text-right font-medium tabular-nums text-ink">
        {formatMoney(order.total, order.currency)}
      </span>
    </Link>
  );
}
