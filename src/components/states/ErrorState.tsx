import type { ReactNode } from "react";

// Errors say what went wrong and how to fix it — no apology, no vague wording
// (frontend-design-skill: "Errors don't apologize").
export function ErrorState({
  title,
  what,
  fix,
  actions,
}: {
  title: string; // what went wrong, plainly
  what?: ReactNode; // specifics (e.g. "Gmail returned 429 — too many requests")
  fix?: ReactNode; // how to fix / what happens next
  actions?: ReactNode; // retry / re-consent buttons
}) {
  return (
    <div
      role="alert"
      className="mx-auto max-w-ledger rounded-lg border border-owed/30 bg-owed-tint/50 px-8 py-10 text-center"
    >
      <h2 className="font-serif text-2xl text-ink">{title}</h2>
      {what ? <p className="mx-auto mt-3 max-w-md text-base text-ink">{what}</p> : null}
      {fix ? <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{fix}</p> : null}
      {actions ? <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </div>
  );
}
