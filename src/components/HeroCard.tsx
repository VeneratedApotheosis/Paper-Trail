"use client";

import { useEffect, useState, type ReactNode } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/format";

// The one bold moment (design-system.md): the "You're owed $X" figure set in
// Spectral, deep-teal money, on a soft raised card. Left-aligned so the breakdown
// bar and the summary line up under it. The count-up is optional polish and fully
// respects prefers-reduced-motion (reduced motion shows the final value).
export function HeroCard({
  total,
  currency,
  count,
  waitingCount = 0,
  onDraftClaims,
  onReview,
  children,
}: {
  total: number;
  currency: string;
  count: number;
  // Items that need a quick check first (not in the total); shown as a short note.
  waitingCount?: number;
  onDraftClaims: () => void;
  onReview: () => void;
  // The breakdown bar and legend.
  children?: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const [displayed, setDisplayed] = useState(reducedMotion ? total : 0);

  useEffect(() => {
    if (reducedMotion) {
      setDisplayed(total);
      return;
    }
    const controls = animate(0, total, {
      duration: 0.9,
      ease: "easeOut",
      onUpdate: (v) => setDisplayed(v),
    });
    return () => controls.stop();
  }, [total, reducedMotion]);

  const owedMoney = formatMoney(total, currency);
  // Split dollars from cents so the cents read smaller and muted.
  const [dollars, cents] = formatMoney(displayed, currency).split(".");
  const waiting =
    waitingCount > 0 ? ` ${waitingCount} more ${waitingCount === 1 ? "is" : "are"} waiting on a quick check.` : "";

  return (
    <section aria-labelledby="hero-amount" className="neu-raised rounded-xl p-6 sm:p-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-10">
        <div>
          <p className="eyebrow mb-3">You&apos;re owed</p>
          <p
            id="hero-amount"
            aria-label={`${owedMoney} waiting for you`}
            className="font-serif text-[3.5rem] font-semibold leading-none tracking-tight text-money tabular-nums sm:text-hero"
          >
            <span aria-hidden>
              {dollars}
              <span className="align-top text-3xl text-ink-muted">.{cents}</span>
            </span>
          </p>
          <p className="mt-4 max-w-md text-base text-ink-muted">
            {count > 0
              ? `${count} ${count === 1 ? "way" : "ways"} to get money back, found in your inbox.${waiting}`
              : `Nothing to claim right now.${waiting}`}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row md:flex-none">
          {count > 0 ? (
            <>
              <Button type="button" variant="primary" onClick={onDraftClaims} className="w-full sm:w-auto">
                Draft claims
              </Button>
              <Button type="button" variant="secondary" onClick={onReview} className="w-full sm:w-auto">
                Review
              </Button>
            </>
          ) : (
            // Nothing counts toward the total (only items needing a quick check remain),
            // so there is nothing to draft; point the one action at review.
            <Button type="button" variant="primary" onClick={onReview} className="w-full sm:w-auto">
              Review these
            </Button>
          )}
        </div>
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}