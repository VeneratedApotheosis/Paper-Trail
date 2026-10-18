"use client";

import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/Button";

// getOrderForRequest throws when the session or auth DB can't be read (fail closed); show it and offer a retry.
export default function OrderDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AppShell>
      <ErrorState
        title="Couldn't load this order"
        what="The ledger could not be read for this request."
        fix="Try again. If it keeps failing, reload the demo or reconnect Gmail."
        actions={<Button onClick={reset}>Try again</Button>}
      />
    </AppShell>
  );
}
