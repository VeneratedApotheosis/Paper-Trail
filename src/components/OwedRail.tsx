import { countdownLabel, formatMoney } from "@/lib/format";
import { KIND_LABELS, type OwedRowLike, type StoreTotal } from "@/components/owedGroups";
import { Chip } from "@/components/ui/Chip";

const monthDay = (iso: string) => {
  const d = new Date(iso);
  return {
    month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(d).toUpperCase(),
    day: new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(d),
  };
};

function DateBlock({ iso }: { iso: string }) {
  const { month, day } = monthDay(iso);
  return (
    <span className="neu-inset flex h-[52px] w-12 flex-none flex-col items-center justify-center rounded-md" aria-hidden>
      <span className="text-[10px] font-bold leading-none tracking-wider text-ink-muted">{month}</span>
      <span className="font-serif text-xl leading-6 text-ink">{day}</span>
    </span>
  );
}

// Desktop rail card: deadlines still ahead, soonest first.
export function ClosingSoonCard({ rows, now }: { rows: readonly (OwedRowLike & { finding: { dueAt: string | null } })[]; now?: Date }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Closing this week" className="neu-raised space-y-4 rounded-lg p-6">
      <h2 className="font-serif text-xl text-ink">Closing soon</h2>
      <ul className="space-y-4">
        {rows.map(({ finding, merchant }) => (
          <li key={finding.id} className="flex items-center gap-3.5">
            {finding.dueAt ? <DateBlock iso={finding.dueAt} /> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{merchant}</span>
              <span className="block truncate text-sm text-ink-muted">
                {KIND_LABELS[finding.kind]}, {formatMoney(finding.amountAtStake, finding.currency)}
              </span>
            </span>
            {finding.dueAt ? <Chip tone="deadline">{countdownLabel(finding.dueAt, now)}</Chip> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Phone version of the same list: a short row of cards you can swipe, shown above the findings.
export function ClosingStrip({ rows, now }: { rows: readonly OwedRowLike[]; now?: Date }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Closing soon" className="space-y-3">
      <h2 className="font-serif text-xl text-ink">Closing soon</h2>
      <ul className="-mx-1.5 flex gap-3 overflow-x-auto px-1.5 pb-3 pt-1.5">
        {rows.slice(0, 4).map(({ finding, merchant }) => (
          <li key={finding.id} className="neu-raised-sm flex w-32 flex-none flex-col items-start gap-1 rounded-md p-3.5">
            {finding.dueAt ? (
              <span className="text-xs font-semibold text-ink-muted">
                {monthDay(finding.dueAt).month} {monthDay(finding.dueAt).day}
              </span>
            ) : null}
            <span className="w-full truncate text-sm font-semibold text-ink">{merchant}</span>
            {finding.dueAt ? <Chip tone="deadline">{countdownLabel(finding.dueAt, now)}</Chip> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Where the money comes from. Bars are proportional to the biggest store.
export function StoresCard({ stores, currency }: { stores: StoreTotal[]; currency: string }) {
  if (stores.length === 0) return null;
  const max = Math.max(...stores.map((s) => s.total), 1);
  return (
    <section aria-label="Where it comes from" className="neu-raised space-y-4 rounded-lg p-6">
      <h2 className="font-serif text-xl text-ink">Where it comes from</h2>
      <ul className="space-y-3.5">
        {stores.map((s) => (
          <li key={s.merchant} className="space-y-1.5">
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink">{s.merchant}</span>
              <span className="tabular-nums text-ink-muted">{formatMoney(s.total, currency)}</span>
            </span>
            <span className="neu-inset block rounded-full p-[2px]">
              <span className="block h-1.5 rounded-full bg-teal-deep" style={{ width: `${Math.max(6, Math.round((s.total / max) * 100))}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// A true sequence, so the numbers are meaningful.
export function NextStepsCard() {
  const steps = ["Pick a finding and read the evidence.", "Approve the drafted email.", "Send it yourself. PaperTrail never sends."];
  return (
    <section aria-label="What happens next" className="neu-raised space-y-4 rounded-lg p-6">
      <h2 className="font-serif text-xl text-ink">What happens next</h2>
      <ol className="space-y-3 text-sm leading-5 text-ink">
        {steps.map((text, i) => (
          <li key={text} className="flex gap-3">
            <span aria-hidden className="font-serif font-semibold text-teal-deep">{i + 1}</span>
            {text}
          </li>
        ))}
      </ol>
    </section>
  );
}