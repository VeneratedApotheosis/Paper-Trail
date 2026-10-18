import { Button } from "@/components/ui/Button";
import { WillNotList } from "@/components/WillNotList";

// Pre-auth consent screen content (issue #24). Presentational only — all copy is
// plain, active voice, and truthful about the single `gmail.readonly` scope and
// the real Google "unverified app" flow (deepdive_S14 §5). Props-only: both
// actions are callbacks the page wrapper owns, so there is no routing/fetch/mock
// here. Neumorphic soft-UI: headline + trust list on the left, a raised consent
// card with the read-only scope, the unverified heads-up, and the actions.
export interface ConsentExplainerProps {
  onConnect: () => void;
  onTryDemo: () => void;
  demoLoading?: boolean;
}

export function ConsentExplainer({ onConnect, onTryDemo, demoLoading }: ConsentExplainerProps) {
  return (
    <div className="mx-auto w-full max-w-5xl animate-fade-rise">
      <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
        {/* Left: the pitch and the trust list. */}
        <header className="space-y-6">
          <p className="eyebrow">Connect your inbox</p>
          <h1 className="font-serif text-3xl text-ink sm:text-[3.25rem] sm:leading-[1.02]">
            See what your inbox says you&apos;re owed.
          </h1>
          <p className="max-w-md text-lg text-ink-muted">
            Connect Gmail read-only and PaperTrail lists every receipt as a
            purchase, then flags overdue refunds, closing return windows, and price drops.
            It reads receipts, never your private mail.
          </p>
          {/* Criterion 2: the trust list. */}
          <WillNotList />
        </header>

        {/* Right: the raised consent card. */}
        <section
          aria-labelledby="scope-heading"
          className="neu-raised rounded-xl px-7 py-8 sm:px-9 sm:py-10"
        >
          {/* Criterion 1: the single scope, in plain language. */}
          <p id="scope-heading" className="eyebrow">
            Read-only access
          </p>
          <p className="mt-3 text-base text-ink">
            PaperTrail asks Google for one scope,{" "}
            <code className="rounded-sm bg-paper-sunk px-1.5 py-0.5 text-sm text-teal-deep">
              gmail.readonly
            </code>
            . That is read-only access to find your receipts, nothing more.
          </p>

          {/* Criterion 3: the "unverified app" heads-up, framed calmly. */}
          <p className="mt-5 text-sm text-ink-muted">
            Google shows an unverified-app screen because PaperTrail is a test app.
            Click <strong className="font-semibold text-ink">Advanced</strong>, then{" "}
            <strong className="font-semibold text-ink">Go to PaperTrail</strong> to
            continue. Access lasts 7 days, then you reconnect.
          </p>

          {/* Criterion 4: primary + secondary actions, both callbacks. "Connect
              Gmail" starts the real OAuth flow (#3) via the wrapper; "Try demo
              data" loads demo mode (#4) and shows a loading state. */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button type="button" onClick={onConnect} className="flex-1">
              Connect Gmail
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onTryDemo}
              disabled={demoLoading}
              aria-busy={demoLoading}
              className="flex-1"
            >
              {demoLoading ? "Loading demo…" : "Try demo data"}
            </Button>
          </div>
          <p className="mt-4 text-sm text-ink-faint">
            Demo data is synthetic and labeled as such. No real inbox required.
          </p>
        </section>
      </div>
    </div>
  );
}
