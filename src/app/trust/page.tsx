import { AppShell } from "@/components/AppShell";
import { AuditLogTable } from "@/components/AuditLogTable";
import { DeleteAllPanel, MerchantExcludePanel } from "@/components/DeleteAllPanel";

// Trust page (F1.8): verify exactly what PaperTrail stores and what it will never
// do, inspect the audit log, exclude merchants, and delete everything. Server
// component. The interactive panels manage their own client state.

// What the app keeps. Kept inline so this page does not depend on components
// owned by other issues. Lean copy, no em dashes.
const STORES = [
  "Normalized ledger rows and the findings our rules derive from them.",
  "Short evidence quotes from each email, so every number can be traced.",
  "An audit entry for every Gmail fetch, LLM call, approval and deletion.",
];

const NEVER = [
  "Send, delete or label your mail. Scope is read only.",
  "Move money or store full card numbers.",
  "Read non receipt mail or share your data.",
];

export default function TrustPage() {
  return (
    <AppShell>
      <header className="mb-8">
        <p className="eyebrow">Your data</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">Trust and your data</h1>
        <p className="mt-2 max-w-prose font-sans text-base text-ink-muted">
          Exactly what PaperTrail stores and what it will never do, with the controls to prove it.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
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

      <section aria-labelledby="audit-heading" className="neu-raised mt-6 rounded-xl p-6">
        <p className="eyebrow">Audit log</p>
        <h2 id="audit-heading" className="sr-only">
          Audit log
        </h2>
        <p className="mb-5 mt-2 font-sans text-sm text-ink-muted">
          Every Gmail fetch, LLM call, approval and deletion, newest first.
        </p>
        <AuditLogTable />
      </section>

      <section aria-labelledby="exclude-heading" className="neu-raised mt-6 rounded-xl p-6">
        <p className="eyebrow">Exclude merchants</p>
        <h2 id="exclude-heading" className="sr-only">
          Exclude merchants from scanning
        </h2>
        <p className="mb-5 mt-2 font-sans text-sm text-ink-muted">
          Turn off any merchant you do not want PaperTrail to scan.
        </p>
        <MerchantExcludePanel />
      </section>

      <section aria-labelledby="delete-heading" className="neu-raised mt-6 rounded-xl p-6">
        <p className="eyebrow">Delete everything</p>
        <h2 id="delete-heading" className="sr-only">
          Delete everything
        </h2>
        <p className="mb-5 mt-2 font-sans text-sm text-ink-muted">
          Revoke Gmail access and erase all stored data, with a confirmation receipt.
        </p>
        <DeleteAllPanel />
      </section>
    </AppShell>
  );
}
