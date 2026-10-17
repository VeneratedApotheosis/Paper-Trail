// Loading skeletons. Inset wells pulse gently; reduced-motion disables the pulse.

function Bar({ className = "" }: { className?: string }) {
  return <div className={`neu-inset animate-pulse rounded-sm ${className}`} />;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <Bar className={className} />;
}

export function LedgerSkeleton() {
  return (
    <div className="mx-auto max-w-ledger space-y-4" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="neu-raised flex items-center justify-between gap-4 rounded-lg px-5 py-5">
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
      <div className="neu-raised rounded-xl p-8">
        <Bar className="mx-auto h-4 w-32" />
        <Bar className="mx-auto mt-4 h-16 w-64" />
      </div>
      <div className="space-y-4 pt-2">
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
      <div className="space-y-3 pt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
