import { Chip, type ChipTone } from "@/components/ui/Chip";
import type { OrderDisplayStatus } from "@/lib/view";

// Map a derived order status to a Chip tone. Restraint by design: green (saved)
// marks money returned; every in-progress/neutral state stays quiet so a single
// signal colour keeps one meaning (design-system.md).
const STATUS_TONE: Record<OrderDisplayStatus, ChipTone> = {
  ordered: "neutral",
  shipped: "neutral",
  delivered: "neutral",
  "return in progress": "neutral",
  returned: "neutral",
  refunded: "saved",
  cancelled: "neutral",
};

function titleCase(status: OrderDisplayStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function StatusChip({ status }: { status: OrderDisplayStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{titleCase(status)}</Chip>;
}
