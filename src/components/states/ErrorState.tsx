import type { ReactNode } from "react";

// Errors say what went wrong and how to fix it. No apology, no vague wording.
export function ErrorState({
  title,
  what,
  fix,
  actions,
}: {
  title: string;
  what?: ReactNode;
  fix?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div role="alert" className="neu-raised mx-auto max-w-ledger rounded-xl px-8 py-12 text-center">
      <h2 className="font-serif text-2xl text-ink">{title}</h2>
      {what ? <p className="mx-auto mt-3 max-w-md text-base text-ink">{what}</p> : null}
      {fix ? <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{fix}</p> : null}
      {actions ? <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </div>
  );
}
