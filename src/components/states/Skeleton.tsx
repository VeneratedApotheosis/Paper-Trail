// Loading skeletons. Respects reduced-motion via globals.css (pulse is a plain
// opacity animation that is disabled under prefers-reduced-motion).

function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-paper-sunk ${className}`} />;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <Bar className={className} />;
}

export function LedgerSkeleton() {
  return (
    <div className="mx-auto max-w-ledger space-y-px" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 bg-paper-raised px-4 py-4">
          <Bar className="h-4 w-40" />
          <Bar className="h-4 w-20" />
          <Bar className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}

export function HeroSkeleton() {
  return (
    <div className="mx-auto max-w-ledger space-y-6" aria-hidden>
      <Bar className="mx-auto h-4 w-32" />
      <Bar className="mx-auto h-16 w-72" />
      <div className="space-y-3 pt-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Bar key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

export function OrderDetailSkeleton() {
  return (
    <div className="mx-auto max-w-ledger space-y-4" aria-hidden>
      <Bar className="h-7 w-56" />
      <Bar className="h-4 w-40" />
      <div className="space-y-2 pt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
