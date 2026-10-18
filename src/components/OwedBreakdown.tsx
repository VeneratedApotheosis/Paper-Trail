import type { FindingKind } from "@/lib/contracts";
import { formatMoney } from "@/lib/format";
import type { KindGroup } from "@/components/owedGroups";

// Colour keys for the breakdown. All from the one teal family plus a neutral, so the
// bar never reads as traffic lights.
const SEGMENT: Record<FindingKind, string> = {
  return_deadline: "bg-teal-deep",
  refund_overdue: "bg-teal",
  price_drop: "bg-teal-bright",
  refund_short: "bg-ink-faint",
  rewards_gap: "bg-ink-muted",
};

// What the owed total is made of: one inset bar and a legend that names every segment.
export function OwedBreakdown({ groups, currency }: { groups: KindGroup[]; currency: string }) {
  if (groups.length === 0) return null;
  const summary = groups.map((g) => `${g.label} ${formatMoney(g.total, currency)}`).join(", ");
  return (
    <div className="space-y-3">
      <div role="img" aria-label={`Breakdown: ${summary}`} className="neu-inset rounded-full p-[3px]">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {groups.map((g) => (
            <span key={g.kind} className={`${SEGMENT[g.kind]} min-w-1`} style={{ flexGrow: Math.max(g.total, 1) }} />
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
        {groups.map((g) => (
          <li key={g.kind} className="inline-flex items-center gap-2">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${SEGMENT[g.kind]}`} />
            <span>
              <span className="font-semibold tabular-nums text-ink">{formatMoney(g.total, currency)}</span> {g.label.toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}