"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorState, LedgerSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { TrustView } from "@/components/views/TrustView";
import { useAction, useAudit, useLedger } from "@/hooks";
import { deleteAll, excludeMerchant, includeMerchant } from "@/lib/api/client";
import type { LedgerResponse } from "@/lib/api/types";

// Thin wrapper for "/trust" (issue #69): real audit log (GET /api/audit), merchant exclusions
// (POST/DELETE /api/merchants/exclude) and delete-all (POST /api/delete-all, same origin).
//
// The deletion receipt is NOT passed to TrustView: DeleteAllPanel's receipt always says "OAuth token revoked" and
// "Simulated for the demo. No real data was deleted", both false for the real response. The real receipt (time,
// purged counts, whether the token was revoked) is the single `delete` audit entry the API leaves behind, which the
// refetched audit log shows. Real receipt props on DeleteAllPanel are an INTERFACE request for the view owner.

// Same normalization as normalizeMerchantKey (src/lib/pipeline/run.ts, which pulls Node-only ingestion code into a
// client bundle): the API returns excluded merchants as these lowercase keys.
function merchantKey(name: string): string {
  return name.trim().toLowerCase();
}

interface MerchantList {
  merchants: string[];
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
    merchants: [...merchants].sort((a, b) => a.localeCompare(b)),
    excludedMerchants,
  };
}

/** One mutation for the merchant checkbox, so pending/error state covers both directions. */
function setMerchantExcluded(name: string, shouldExclude: boolean) {
  return shouldExclude ? excludeMerchant(name) : includeMerchant(name);
}

export default function TrustPage() {
  const ledger = useLedger();
  const audit = useAudit();
  const deletion = useAction(deleteAll);
  const merchantToggle = useAction(setMerchantExcluded);
  const [excludedNames, setExcludedNames] = useState<Record<string, string>>({});
  // useAction keeps its error until the next run; "Back to your data" hides it until then.
  const [actionErrorDismissed, setActionErrorDismissed] = useState(false);

  function refetchAll() {
    ledger.refetch();
    audit.refetch();
  }

  async function handleToggleMerchant(name: string, shouldExclude: boolean) {
    if (merchantToggle.pending || deletion.pending) return;
    if (shouldExclude) setExcludedNames((prev) => ({ ...prev, [merchantKey(name)]: name }));
    setActionErrorDismissed(false);
    // useAction refreshes the shared cache (ledger and audit) after a successful toggle.
    await merchantToggle.run(name, shouldExclude);
  }

  async function handleDeleteAll() {
    if (deletion.pending || merchantToggle.pending) return;
    setActionErrorDismissed(false);
    if (!(await deletion.run())) return;
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

  // `deletion.pending` (which also covers the post-delete cache refresh) swaps in the skeleton, which remounts
  // DeleteAllPanel out of its confirm step. Merchant toggles keep the view.
  if (!ledger.data || !audit.data || deletion.pending) {
    return (
      <AppShell demo={showsDemo}>
        <LedgerSkeleton />
      </AppShell>
    );
  }

  const actionError = actionErrorDismissed ? null : (deletion.error ?? merchantToggle.error);
  if (actionError) {
    const deleteFailed = deletion.error !== null;
    return (
      <AppShell demo={showsDemo}>
        <ErrorState
          title={deleteFailed ? "Couldn't delete your data" : "Couldn't update merchant exclusions"}
          what={actionError}
          fix="Go back to your data and try again."
          actions={
            <Button type="button" onClick={() => setActionErrorDismissed(true)}>
              Back to your data
            </Button>
          }
        />
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
    />
  );
}
