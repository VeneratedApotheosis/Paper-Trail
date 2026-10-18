import { Button } from "@/components/ui/Button";

// First-run intro for an empty store (#107): three plain steps, then the two ways
// to start. Props-only: both choices are callbacks the page wires (OAuth start,
// demo load). A choice is only rendered when its callback is supplied.
export const INTRO_STEPS = [
  "We read your receipt emails (read-only).",
  "We find money you can get back: late refunds, closing return windows, price drops.",
  "You approve a claim email and send it yourself. We never send anything.",
] as const;

export function OwedIntro({
  onConnectGmail,
  onLoadDemo,
}: {
  onConnectGmail?: () => void;
  onLoadDemo?: () => void;
}) {
  return (
    <section
      aria-labelledby="intro-heading"
      className="neu-raised mx-auto max-w-ledger rounded-xl px-8 py-12 sm:px-12"
    >
      <h1 id="intro-heading" className="text-center font-serif text-3xl text-ink">
        Find money your receipts say you&apos;re owed
      </h1>
      <ol className="mx-auto mt-8 max-w-md space-y-4">
        {INTRO_STEPS.map((step, index) => (
          <li key={step} className="flex items-start gap-4">
            <span
              aria-hidden
              className="neu-inset flex h-8 w-8 flex-none items-center justify-center rounded-full font-serif text-base font-bold text-teal-deep"
            >
              {index + 1}
            </span>
            <span className="pt-1 text-base text-ink">{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        {onConnectGmail ? (
          <Button type="button" onClick={onConnectGmail}>
            Connect Gmail
          </Button>
        ) : null}
        {onLoadDemo ? (
          <Button type="button" variant="secondary" onClick={onLoadDemo}>
            Try demo data
          </Button>
        ) : null}
      </div>
      <p className="mt-4 text-center text-sm text-ink-faint">
        Demo data is synthetic. No real inbox needed.
      </p>
    </section>
  );
}
