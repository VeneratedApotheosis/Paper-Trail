"use client";

import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { formatMoney } from "@/lib/format";

// A money figure that counts up once when it first appears (same motion as the HeroCard figure).
// First render shows the final amount on server and client, so there is no hydration mismatch;
// reduced motion keeps the final amount and never animates. Screen readers get the final amount only.
export function CountUpMoney({ amount, currency }: { amount: number; currency: string }) {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(amount);

  useEffect(() => {
    if (reducedMotion) {
      setShown(amount);
      return;
    }
    const controls = animate(0, amount, { duration: 0.7, ease: "easeOut", onUpdate: (v) => setShown(v) });
    return () => controls.stop();
  }, [amount, reducedMotion]);

  return (
    <span aria-label={formatMoney(amount, currency)}>
      <span aria-hidden>{formatMoney(shown, currency)}</span>
    </span>
  );
}
