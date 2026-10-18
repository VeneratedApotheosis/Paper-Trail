// Same "We store" / "We never" copy as the real Trust page (TrustView.tsx),
// kept in sync by hand since that page's arrays aren't exported. If those
// change, update both.
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

export function TrustHighlights() {
  return (
    <section id="trust" className="mx-auto max-w-ledger px-5 py-16 xl:max-w-5xl xl:px-0 xl:py-24">
      <p className="eyebrow mb-3">Your data</p>
      <h2 className="max-w-xl font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Built so you stay in control of your inbox and your money.
      </h2>
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <section aria-labelledby="landing-store-heading" className="neu-raised rounded-xl p-6">
          <p className="eyebrow">We store</p>
          <h3 id="landing-store-heading" className="sr-only">
            What PaperTrail stores
          </h3>
          <ul className="mt-4 space-y-3 text-sm text-ink">
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

        <section aria-labelledby="landing-never-heading" className="neu-inset rounded-xl p-6">
          <p className="eyebrow">We never</p>
          <h3 id="landing-never-heading" className="sr-only">
            What PaperTrail never does
          </h3>
          <ul className="mt-4 space-y-3 text-sm text-ink">
            {NEVER.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-px font-bold text-ink-muted">
                  ✕
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
