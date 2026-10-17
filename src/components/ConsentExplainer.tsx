import { LinkButton } from "@/components/ui/Button";
import { WillNotList } from "@/components/WillNotList";

// Pre-auth consent screen content (issue #24). Presentational only — all copy is
// plain, active voice, and truthful about the single `gmail.readonly` scope and
// the real Google "unverified app" flow (deepdive_S14 §5). No client hooks.
export function ConsentExplainer() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="col-head text-ink-muted">Connect your inbox</p>
        <h1 className="font-serif text-3xl text-ink">
          PaperTrail reads your receipts to find money you&apos;re owed
        </h1>
        <p className="max-w-ledger text-lg text-ink-muted">
          Connect Gmail and PaperTrail turns every purchase email into a ledger row,
          then checks each one for overdue refunds, closing return windows, and price
          drops — so you can claim what&apos;s yours.
        </p>
      </header>

      {/* Criterion 1: the single scope, in plain language. */}
      <section
        aria-labelledby="scope-heading"
        className="rounded-lg border border-rule bg-paper-sunk px-6 py-6 sm:px-8 sm:py-8"
      >
        <h2 id="scope-heading" className="font-serif text-xl text-ink">
          One permission, read-only
        </h2>
        <p className="mt-3 text-base text-ink">
          PaperTrail asks Google for a single scope:{" "}
          <code className="rounded-sm bg-paper-raised px-1.5 py-0.5 text-sm text-ink-muted">
            gmail.readonly
          </code>
          . That is read-only access to find your receipts.
        </p>
        <p className="mt-2 text-base text-ink-muted">
          With this scope PaperTrail <strong className="text-ink">cannot</strong> send,
          delete, label, or mark your mail as read. It can only look.
        </p>
      </section>

      {/* Criterion 2 */}
      <WillNotList />

      {/* Criterion 3: the "unverified app" heads-up, framed calmly and truthfully. */}
      <section
        aria-labelledby="unverified-heading"
        className="rounded-lg border border-deadline/30 bg-deadline-tint/50 px-6 py-6 sm:px-8 sm:py-8"
      >
        <h2 id="unverified-heading" className="font-serif text-xl text-ink">
          Heads-up: Google will show an &ldquo;unverified app&rdquo; screen
        </h2>
        <p className="mt-3 text-base text-ink">
          PaperTrail is a dev/test app, so Google has not run it through public
          verification yet. During sign-in you&apos;ll see a warning that the app
          isn&apos;t verified. That&apos;s expected. To continue:
        </p>
        <ol className="mt-4 space-y-2 text-base text-ink">
          <li className="flex gap-3">
            <span aria-hidden="true" className="font-medium text-ink-muted">1.</span>
            <span>
              Click <strong className="text-ink">Advanced</strong>.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden="true" className="font-medium text-ink-muted">2.</span>
            <span>
              Click <strong className="text-ink">Go to PaperTrail (unsafe)</strong>.
            </span>
          </li>
        </ol>
        <p className="mt-4 text-sm text-ink-muted">
          Access is still limited to the single read-only scope above, and test-user
          access expires after 7 days — you can reconnect any time.
        </p>
      </section>

      {/* Criterion 4: primary + secondary actions. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <LinkButton href="/sync">Connect Gmail</LinkButton>
        <LinkButton href="/ledger" variant="secondary">
          Try demo data
        </LinkButton>
      </div>
      <p className="text-sm text-ink-faint">
        Demo data is synthetic and labeled as such — no real inbox required.
      </p>
    </div>
  );
}
