// The trust "will-not" list (scope_features §6): spell out, in plain active
// voice, the things PaperTrail is structurally unable to do. These are not steps
// in a sequence, so render them as an unordered list with one consistent marker.
const items = [
  {
    heading: "Never send or reply to mail",
    detail: "Access is read-only. PaperTrail cannot send, delete, label, or mark your mail as read.",
  },
  {
    heading: "Never move your money",
    detail: "You approve and send every claim yourself. PaperTrail only drafts the wording.",
  },
  {
    heading: "Never store full card numbers",
    detail: "Card numbers, phone numbers, and addresses are masked before anything is saved or analysed.",
  },
  {
    heading: "Never read non-receipt mail",
    detail: "It looks only for purchase confirmations, receipts, and refund notices — not personal mail.",
  },
  {
    heading: "Never share your data",
    detail: "Your ledger stays yours. Delete everything at any time and it is gone.",
  },
];

export function WillNotList() {
  return (
    <section aria-labelledby="will-not-heading" className="rounded-lg border border-rule bg-paper-raised px-6 py-6 sm:px-8 sm:py-8">
      <h2 id="will-not-heading" className="font-serif text-xl text-ink">
        What PaperTrail will <span className="text-owed">not</span> do
      </h2>
      <ul role="list" className="mt-5 space-y-4">
        {items.map((item) => (
          <li key={item.heading} className="flex gap-3">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-owed" />
            <div>
              <p className="text-base font-medium text-ink">{item.heading}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
