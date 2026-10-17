import { AppShell } from "@/components/AppShell";
import { AuditLogTable } from "@/components/AuditLogTable";
import { DeleteAllPanel, MerchantExcludePanel } from "@/components/DeleteAllPanel";

// Trust page (F1.8): verify exactly what PaperTrail reads/stores and what it will
// never do, inspect the audit log, exclude merchants, and delete everything.
// Server component — the interactive panels manage their own client state.

// What the app reads and stores. Kept inline so this page does not depend on
// components owned by other issues.
const READS = [
  "Receipt-shaped email from your inbox (order, shipping, delivery, return, refund and price-adjustment messages).",
  "The fields we extract from those emails: merchant, order reference, dates, line items, totals, and the last 4 digits of a card when a merchant includes them.",
];

const STORES = [
  "Normalized ledger rows and the findings our rules derive from them.",
  "Short evidence quotes from the source email, so every number can be traced.",
  "An audit entry for every Gmail fetch, LLM call, approval and deletion.",
];

const NEVER = [
  "Never send email on your behalf — scope is read-only (gmail.readonly).",
  "Never move money or make a payment without your explicit tap.",
  "Never store full card numbers — only the last 4 digits a merchant shows.",
  "Never read non-receipt mail — personal and other messages are left untouched.",
  "Never share or sell your data.",
];

export default function TrustPage() {
  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-ink">Trust</h1>
        <p className="mt-1 text-base text-ink-muted">
          Exactly what PaperTrail reads, stores and will never do — and the controls to prove it.
        </p>
      </div>

      <section aria-labelledby="reads-stores-heading" className="mb-10">
        <h2 id="reads-stores-heading" className="font-serif text-xl text-ink">
          What PaperTrail reads and stores
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-rule bg-paper-raised px-5 py-5">
            <p className="col-head mb-3">Reads</p>
            <ul className="space-y-2 text-sm text-ink">
              {READS.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="text-ink-faint">
                    •
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-rule bg-paper-raised px-5 py-5">
            <p className="col-head mb-3">Stores</p>
            <ul className="space-y-2 text-sm text-ink">
              {STORES.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="text-ink-faint">
                    •
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="never-heading" className="mb-10">
        <h2 id="never-heading" className="font-serif text-xl text-ink">
          What PaperTrail will never do
        </h2>
        <ul className="mt-4 space-y-2 text-sm text-ink">
          {NEVER.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true" className="font-medium text-owed">
                ✕
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="audit-heading" className="mb-10">
        <h2 id="audit-heading" className="font-serif text-xl text-ink">
          Audit log
        </h2>
        <p className="mb-4 mt-1 text-sm text-ink-muted">
          Every Gmail fetch, LLM call, approval and deletion, newest first.
        </p>
        <AuditLogTable />
      </section>

      <section aria-labelledby="exclude-heading" className="mb-10">
        <h2 id="exclude-heading" className="font-serif text-xl text-ink">
          Exclude merchants from scanning
        </h2>
        <p className="mb-4 mt-1 text-sm text-ink-muted">
          Turn off any merchant you don&apos;t want PaperTrail to scan.
        </p>
        <MerchantExcludePanel />
      </section>

      <section aria-labelledby="delete-heading" className="mb-4">
        <h2 id="delete-heading" className="font-serif text-xl text-ink">
          Delete everything
        </h2>
        <p className="mb-4 mt-1 text-sm text-ink-muted">
          Revoke Gmail access and erase all stored data, with a confirmation receipt.
        </p>
        <DeleteAllPanel />
      </section>
    </AppShell>
  );
}
