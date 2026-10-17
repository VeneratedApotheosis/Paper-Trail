import type { ReactNode } from "react";

// Empty states are invitations to act, not dead ends (frontend-design-skill:
// "An empty screen is an invitation to act.").
export function EmptyState({
  title,
  children,
  query,
  actions,
}: {
  title: string;
  children?: ReactNode; // plain-language explanation
  query?: string; // the Gmail query used, shown so "no results" has context
  actions?: ReactNode; // e.g. demo-mode / .eml import buttons
}) {
  return (
    <div className="mx-auto max-w-ledger rounded-lg border border-rule bg-paper-raised px-8 py-12 text-center">
      <hr className="perf-rule mx-auto mb-8 w-24" />
      <h2 className="font-serif text-2xl text-ink">{title}</h2>
      {children ? <p className="mx-auto mt-3 max-w-md text-base text-ink-muted">{children}</p> : null}
      {query ? (
        <p className="mx-auto mt-4 max-w-md text-sm text-ink-faint">
          Searched: <code className="rounded-sm bg-paper-sunk px-1.5 py-0.5 text-ink-muted">{query}</code>
        </p>
      ) : null}
      {actions ? <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </div>
  );
}
