"use client";

import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { LinkButton } from "@/components/ui/Button";
import { formatMoney } from "@/lib/format";

// The one bold moment (design-system.md): the "You're owed $X" figure set in
// Spectral, deep-teal money, centered on a soft raised card. The count-up is
// optional polish and fully respects prefers-reduced-motion (reduced motion
// shows the final value with no animation).
export function HeroCard({
  total,
  currency,
  count,
}: {
  total: number;
  currency: string;
  count: number;
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

  return (
    <section
      aria-labelledby="hero-amount"
      className="neu-raised rounded-xl px-6 py-12 text-center sm:px-12 sm:py-16"
    >
      <p className="eyebrow mb-5">You&apos;re owed</p>
      <p
        id="hero-amount"
        aria-label={`${owedMoney} waiting for you`}
        className="font-serif text-5xl font-semibold tracking-tight text-money tabular-nums sm:text-hero"
      >
        <span aria-hidden>
          {dollars}
          <span className="align-top text-3xl text-ink-muted">.{cents}</span>
        </span>
      </p>
      <p className="mx-auto mt-5 max-w-md text-base text-ink-muted">
        {count > 0
          ? `Across ${count} ${count === 1 ? "finding" : "findings"} from your inbox.`
          : "Nothing to claim right now."}
      </p>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        {count > 0 ? (
          <>
            <LinkButton href="#findings" variant="primary">
              Draft claims
            </LinkButton>
            <LinkButton href="/review" variant="secondary">
              Review
            </LinkButton>
          </>
        ) : (
          // No findings count toward the total (only needs-review items remain),
          // so there is nothing to draft; point the one action at /review.
          <LinkButton href="/review" variant="primary">
            Review these
          </LinkButton>
        )}
      </div>
    </section>
  );
}
