"use client";

import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { formatMoney } from "@/lib/format";

// The one bold moment (design-system.md): the "$X waiting for you" figure in
// Fraunces, vermilion = owed. Count-up is optional polish and fully respects
// prefers-reduced-motion — reduced motion shows the final value with no animation.
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

  return (
    <section
      aria-labelledby="hero-amount"
      className="relative overflow-hidden rounded-lg border border-rule bg-paper-raised px-6 py-10 text-center shadow-raised sm:px-10 sm:py-14"
    >
      <p className="col-head mb-4">You&apos;re owed</p>
      <p
        id="hero-amount"
        aria-label={`${owedMoney} waiting for you`}
        className="font-serif text-hero font-semibold tracking-tight text-owed tabular-nums"
      >
        <span aria-hidden>{formatMoney(displayed, currency)}</span>
      </p>
      <p className="mx-auto mt-4 max-w-md text-lg text-ink-muted">
        waiting for you
        {count > 0 ? (
          <>
            {" "}
            across {count} {count === 1 ? "finding" : "findings"} your inbox turned up.
          </>
        ) : (
          "."
        )}
      </p>
      <hr className="perf-rule mx-auto mt-10 w-32" />
    </section>
  );
}
