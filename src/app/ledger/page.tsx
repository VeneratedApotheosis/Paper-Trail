"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ErrorState, LedgerSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { LedgerView } from "@/components/views/LedgerView";
import { useLedger, useLoadDemo } from "@/hooks";
import { encodeIdSegment } from "@/lib/api/ids";

// Thin wrapper (issue #57): reads GET /api/ledger (excluded merchants are already dropped by the API) and hands
// the orders to the props-only LedgerView. Real ids contain ':', so order links are encoded path segments.
export default function LedgerPage() {
  const router = useRouter();
  const ledger = useLedger();
  const demo = useLoadDemo();

  // useLoadDemo refreshes the shared cache itself, so there is nothing to refetch here.
  async function loadDemoAndRefetch() {
    await demo.run();
  }

  const showsDemo = ledger.data?.mode === "demo";

  if (ledger.loading || demo.pending) {
    return (
      <AppShell demo={showsDemo}>
        <LedgerSkeleton />
      </AppShell>
    );
  }

  if (ledger.error || !ledger.data) {
    return (
      <AppShell demo={false}>
        <ErrorState
          title="Couldn't load your ledger"
          what={ledger.error}
          fix="Check that the app server is running, then try again."
          actions={
            <Button type="button" onClick={ledger.refetch}>
              Try again
            </Button>
          }
        />
      </AppShell>
    );
  }

  if (demo.error) {
    return (
      <AppShell demo={showsDemo}>
        <ErrorState
          title="Couldn't load the demo inbox"
          what={demo.error}
          actions={
            <Button type="button" onClick={loadDemoAndRefetch}>
              Try again
            </Button>
          }
        />
      </AppShell>
    );
  }

  return (
    <LedgerView
      orders={ledger.data.orders}
      onOpenOrder={(id) => router.push(`/ledger/${encodeIdSegment(id)}`)}
      // Only an empty store offers the demo: loading it would replace an uploaded or Gmail ledger.
      onLoadDemo={ledger.data.mode === "empty" ? loadDemoAndRefetch : undefined}
    />
  );
}
