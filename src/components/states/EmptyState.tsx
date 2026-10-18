import type { ReactNode } from "react";

// Empty states are invitations to act, not dead ends.
export function EmptyState({
  title,
  children,
  query,
  actions,
}: {
  title: string;
  children?: ReactNode;
  query?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="anim-fade-up neu-raised mx-auto max-w-ledger rounded-xl px-8 py-14 text-center">
      <h2 className="font-serif text-2xl text-ink">{title}</h2>
      {children ? (
        <p className="mx-auto mt-3 max-w-md text-base text-ink-muted">{children}</p>
      ) : null}
      {query ? (
        <p className="mx-auto mt-4 max-w-md text-sm text-ink-faint">
          Searched{" "}
          <code className="neu-inset rounded-sm px-2 py-1 text-ink-muted">{query}</code>
        </p>
      ) : null}
      {actions ? <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </div>
  );
}
