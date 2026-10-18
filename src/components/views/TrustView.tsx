import type { AuditEntry } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { AuditLogTable } from "@/components/AuditLogTable";
import {
  DeleteAllPanel,
  MerchantExcludePanel,
  type DeleteReceipt, type MerchantExcludePanelProps,
} from "@/components/DeleteAllPanel";

export type { DeleteReceipt };

// Props-only view for the Trust page (F1.8): verify exactly what PaperTrail
// stores and what it will never do, inspect the audit log, exclude merchants and
// delete everything. Server-friendly: the static "We store" / "We never" cards
// render here, while the interactive panels are client components that bubble
// every action through callbacks. No fetch, no @/lib/api|store|mock|auth, no
// routing. Data is typed via @/lib/types.
export interface TrustViewProps {
  auditEntries: AuditEntry[];
  merchants: MerchantExcludePanelProps["merchants"];
  excludedMerchants: string[];
  onToggleMerchant: (name: string, exclude: boolean) => void;
  onDeleteAll: () => void;
  deleteReceipt?: DeleteReceipt | null;
  deletePending?: boolean; deleteError?: string | null;
  merchantPending?: boolean; merchantError?: string | null;
  gmailConnected?: boolean;
}

// What the app keeps. Lean copy, no em dashes.
const STORES = [
  "Your purchases as we read them from receipts, and the refunds and deadlines we find from them.",
  "Short evidence quotes from each email, so every number can be traced.",
  "An audit entry for every Gmail fetch, LLM call, approval and deletion.",
];

const NEVER = [
  "Send, delete or label your mail. Scope is read only.",
  "Move money or store full card numbers.",
  "Read non receipt mail or share your data.",
];

export function TrustView({
  auditEntries,
  merchants,
  excludedMerchants,
  onToggleMerchant,
  onDeleteAll,
  deleteReceipt, deletePending, deleteError, merchantPending, merchantError, gmailConnected,
}: TrustViewProps) {
  return (
    <AppShell>
      {/* data-layout="wide" lets the shell use the full desktop width (#133); below xl it is one column. */}
      <div data-layout="wide" className="mx-auto max-w-ledger xl:max-w-none">
        <header className="mb-8">
          <p className="eyebrow">Your data</p>
          <h1 className="mt-2 font-serif text-3xl text-ink xl:text-[2.5rem] xl:leading-tight">Trust and your data</h1>
          <p className="mt-2 max-w-prose font-sans text-base text-ink-muted">
            Exactly what PaperTrail stores and what it will never do, with the controls to prove it.
          </p>
        </header>

        {/* Phones: store and never, audit log, exclude, delete. From xl the audit log takes the left column and the rest stack in the right rail. */}
        <div className="space-y-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start xl:gap-x-8 xl:gap-y-6 xl:space-y-0">
          <div className="grid gap-6 sm:grid-cols-2 xl:col-start-2 xl:row-start-1 xl:grid-cols-1">
            <section aria-labelledby="store-heading" className="neu-raised rounded-xl p-6">
              <p className="eyebrow">We store</p>
              <h2 id="store-heading" className="sr-only">
                What PaperTrail stores
              </h2>
              <ul className="mt-4 space-y-3 font-sans text-sm text-ink">
                {STORES.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-px font-bold text-teal-deep">
                      +
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="never-heading" className="neu-inset rounded-xl p-6">
              <p className="eyebrow">We never</p>
              <h2 id="never-heading" className="sr-only">
                What PaperTrail will never do
              </h2>
              <ul className="mt-4 space-y-3 font-sans text-sm text-ink">
                {NEVER.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-px font-bold text-teal-deep">
                      ✕
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section aria-labelledby="audit-heading" className="neu-raised min-w-0 rounded-xl p-6 xl:col-start-1 xl:row-span-3 xl:row-start-1">
            <p className="eyebrow">Audit log</p>
            <h2 id="audit-heading" className="sr-only">
              Audit log
            </h2>
            <p className="mb-5 mt-2 font-sans text-sm text-ink-muted">
              Every Gmail fetch, LLM call, approval and deletion, newest first.
            </p>
            <AuditLogTable entries={auditEntries} />
          </section>

          <section aria-labelledby="exclude-heading" className="neu-raised rounded-xl p-6 xl:col-start-2 xl:row-start-2">
            <p className="eyebrow">Exclude merchants</p>
            <h2 id="exclude-heading" className="sr-only">
              Exclude merchants from scanning
            </h2>
            <p className="mb-5 mt-2 font-sans text-sm text-ink-muted">
              Turn off any merchant you do not want PaperTrail to scan.
            </p>
            <MerchantExcludePanel
              merchants={merchants}
              excludedMerchants={excludedMerchants}
              onToggleMerchant={onToggleMerchant}
              pending={merchantPending}
              error={merchantError}
            />
          </section>

          <section aria-labelledby="delete-heading" className="neu-raised rounded-xl p-6 xl:col-start-2 xl:row-start-3">
            <p className="eyebrow">Delete everything</p>
            <h2 id="delete-heading" className="sr-only">
              Delete everything
            </h2>
            <p className="mb-5 mt-2 font-sans text-sm text-ink-muted">
              Erase stored data and remove any connected Gmail access, with a confirmation receipt.
            </p>
            <DeleteAllPanel onDeleteAll={onDeleteAll} deleteReceipt={deleteReceipt} pending={deletePending} error={deleteError} gmailConnected={gmailConnected} />
          </section>
        </div>
      </div>
    </AppShell>
  );
}