import { Button } from "@/components/ui/Button";
import { WillNotList } from "@/components/WillNotList";
import { formatMoney } from "@/lib/format";

// Pre-auth consent screen content (issue #24). Presentational only: plain, active voice, truthful about the single
// `gmail.readonly` scope and the real Google "unverified app" flow (deepdive_S14 §5). Props-only: both actions are
// callbacks the page wrapper owns, so there is no routing/fetch/mock here.
// Phones: pitch, consent card, will-never list, in that order. From xl: the pitch and will-never list on the left,
// the consent card and the optional example on the right.

/** A labelled, synthetic example of the Owed screen. Optional: the "What you'll see" card renders only when supplied. */
export interface ConsentExample {
  total: number;
  currency: string;
  items: Array<{ label: string; amount: number }>;
}

export interface ConsentExplainerProps {
  onConnect: () => void;
  onTryDemo: () => void;
  demoLoading?: boolean;
  example?: ConsentExample;
}

const pill = "!min-h-[48px] !rounded-full flex-1";

export function ConsentExplainer({ onConnect, onTryDemo, demoLoading, example }: ConsentExplainerProps) {
  return (
    <div className="mx-auto w-full max-w-md animate-fade-rise xl:max-w-[76rem]">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,35rem)_minmax(0,32.5rem)] xl:justify-center xl:gap-x-20 xl:gap-y-6">
        {/* The pitch. */}
        <header className="space-y-5 xl:col-start-1 xl:row-start-1 xl:space-y-6">
          <p className="eyebrow sr-only">Connect your inbox</p>
          <h1 className="font-serif text-[2.375rem] leading-[2.625rem] text-ink xl:text-[3.75rem] xl:leading-[1.03] xl:tracking-[-0.01em]">
            See what your inbox says you&apos;re owed.
          </h1>
          <p className="max-w-[32.5rem] text-base text-ink-muted xl:text-lg xl:leading-7">
            Connect Gmail read-only. PaperTrail lists every receipt as a purchase, then flags{" "}
            <span className="xl:hidden">money you can get back.</span>
            <span className="hidden xl:inline">
              overdue refunds, closing return windows, and price drops. It reads receipts, never your private mail.
            </span>
          </p>
        </header>

        {/* The raised consent card. */}
        <section
          aria-labelledby="scope-heading"
          className="neu-raised flex flex-col gap-4 rounded-lg p-5 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start xl:p-8"
        >
          <p id="scope-heading" className="eyebrow">
            Read-only access
          </p>
          <p className="text-base text-ink">
            PaperTrail asks Google for one scope,{" "}
            <code className="rounded-sm bg-paper-sunk px-1.5 py-0.5 text-sm text-teal-deep">gmail.readonly</code>.
            That is read-only access to find your receipts, nothing more.
          </p>
          <p className="text-[0.75rem] leading-[1.125rem] text-ink-muted">
            Google shows an unverified-app screen because PaperTrail is a test app. Click{" "}
            <strong className="font-semibold text-ink">Advanced</strong>, then{" "}
            <strong className="font-semibold text-ink">Go to PaperTrail</strong> to continue. Access lasts 7 days,
            then you reconnect.
          </p>
          <div className="flex flex-col gap-3 xl:flex-row">
            <Button type="button" onClick={onConnect} className={pill}>
              Connect Gmail
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onTryDemo}
              disabled={demoLoading}
              aria-busy={demoLoading}
              className={pill}
            >
              {demoLoading ? "Loading demo…" : "Try demo data"}
            </Button>
          </div>
          <p className="text-[0.75rem] leading-4 text-ink-muted">
            Demo data is synthetic and labeled as such. No real inbox required.
          </p>
        </section>

        {/* The trust list. */}
        <div className="xl:col-start-1 xl:row-start-2">
          <WillNotList />
        </div>

        {example ? (
          <section
            aria-labelledby="example-heading"
            className="neu-raised flex flex-col gap-3 rounded-lg p-5 xl:col-start-2 xl:row-start-3 xl:p-6"
          >
            <p id="example-heading" className="eyebrow">
              What you&apos;ll see
            </p>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[0.75rem] leading-4 text-ink-muted">You&apos;re owed</p>
                <p className="font-serif text-[2.75rem] font-semibold leading-[3.375rem] tabular-nums text-money">
                  {formatMoney(example.total, example.currency)}
                </p>
              </div>
              <span className="neu-inset mb-1 inline-flex h-6 items-center rounded-full px-3 text-[0.6875rem] font-semibold text-ink-muted">
                Synthetic example
              </span>
            </div>
            <ul>
              {example.items.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center justify-between gap-3 border-t border-rule py-2.5"
                >
                  <span className="text-sm text-ink">{item.label}</span>
                  <span className="font-serif text-base font-semibold tabular-nums text-money">
                    {formatMoney(item.amount, example.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
