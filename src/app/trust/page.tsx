"use client";

import type { MerchantItem } from "@/components/DeleteAllPanel";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorState, LedgerSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { TrustView, type DeleteReceipt } from "@/components/views/TrustView";
import { useAction, useAudit, useLedger, useSession } from "@/hooks";
import { deleteAll, excludeMerchant, includeMerchant } from "@/lib/api/client";
import type { LedgerResponse } from "@/lib/api/types";

// Thin wrapper for "/trust" (issue #69): real audit log (GET /api/audit), merchant exclusions
// (POST/DELETE /api/merchants/exclude) and delete-all (POST /api/delete-all, same origin).
//
// Same normalization as normalizeMerchantKey (src/lib/pipeline/run.ts, which pulls Node-only ingestion code into a
// client bundle): the API returns excluded merchants as these lowercase keys.
function merchantKey(name: string): string {
  return name.trim().toLowerCase();
}

interface MerchantList {
  merchants: MerchantItem[];
  excludedMerchants: string[];
}

// Excluded merchants' orders are hidden by the API, so they are listed from the excluded keys, under the display
// name remembered when the user excluded them here (or the raw key after a reload).
function buildMerchantList(ledger: LedgerResponse, excludedNames: Record<string, string>): MerchantList {
  const names = new Map<string, string>();
  for (const order of ledger.orders) names.set(merchantKey(order.merchant.name), order.merchant.name);
  const excludedMerchants = ledger.excludedMerchants.map((key) => names.get(key) ?? excludedNames[key] ?? key);
  const merchants = new Set([...names.values(), ...excludedMerchants]);
  return {
    merchants: [...merchants].sort((a, b) => a.localeCompare(b)).map(name => ({ key: merchantKey(name), displayName: name, excluded: ledger.excludedMerchants.includes(merchantKey(name)) })),
    excludedMerchants,
  };
}

/** One mutation for the merchant checkbox, so pending/error state covers both directions. */
function setMerchantExcluded(name: string, shouldExclude: boolean) {
  return shouldExclude ? excludeMerchant(name) : includeMerchant(name);
}

export default function TrustPage() {
  const ledger = useLedger();
  const session = useSession();
  const [receipt, setReceipt] = useState<DeleteReceipt | null>(null);
  const audit = useAudit();
  const deletion = useAction(deleteAll);
  const merchantToggle = useAction(setMerchantExcluded);
  const [excludedNames, setExcludedNames] = useState<Record<string, string>>({});

  function refetchAll() {
    ledger.refetch();
    audit.refetch();
  }

  async function handleToggleMerchant(name: string, shouldExclude: boolean) {
    if (merchantToggle.pending) return;
    if (shouldExclude) setExcludedNames((prev) => ({ ...prev, [merchantKey(name)]: ledger.data?.orders.find(order => merchantKey(order.merchant.name) === merchantKey(name))?.merchant.name ?? name }));

    // useAction refreshes the shared cache (ledger and audit) after a successful toggle.
    await merchantToggle.run(name, shouldExclude);
  }

  async function handleDeleteAll() {
    if (deletion.pending || merchantToggle.pending) return;

    const result = await deletion.run();
    if (!result) return;
    setReceipt(result);
    setExcludedNames({});
    // Only the delete record remains: useAction already refetched the audit log, which is the real receipt.
  }

  const showsDemo = ledger.data?.mode === "demo";
  const loadError = ledger.error ?? audit.error;

  if (loadError) {
    return (
      <AppShell demo={false}>
        <ErrorState
          title="Couldn't load your data controls"
          what={loadError}
          fix="Check that the app server is running, then try again."
          actions={
            <Button type="button" onClick={refetchAll}>
              Try again
            </Button>
          }
        />
      </AppShell>
    );
  }

  // Keep the controls mounted during mutations so pending state and receipts stay visible.
  if (!ledger.data || !audit.data) {
    return (
      <AppShell demo={showsDemo}>
        <LedgerSkeleton />
      </AppShell>
    );
  }

  const { merchants, excludedMerchants } = buildMerchantList(ledger.data, excludedNames);

  return (
    <TrustView
      auditEntries={audit.data}
      merchants={merchants}
      excludedMerchants={excludedMerchants}
      onToggleMerchant={handleToggleMerchant}
      onDeleteAll={handleDeleteAll}
      deleteReceipt={receipt}
      deletePending={deletion.pending}
      deleteError={deletion.error}
      merchantPending={merchantToggle.pending || deletion.pending}
      merchantError={merchantToggle.error}
      gmailConnected={session.data?.connected ?? false}
    />
  );
}
