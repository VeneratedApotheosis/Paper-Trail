// The trust "will-never" list (scope_features §6): spell out, in plain active
// voice, the things PaperTrail is structurally unable to do. These are not steps
// in a sequence, so render them as an unordered list with one consistent marker.
const items = [
  "Send, delete, or label your mail",
  "Move your money or store your card numbers",
  "Read non-receipt mail or share your data",
];

export function WillNotList() {
  return (
    <section aria-labelledby="will-never-heading" className="neu-inset rounded-lg p-5 xl:p-6">
      <p id="will-never-heading" className="eyebrow">
        PaperTrail will never
      </p>
      <ul role="list" className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-sm text-ink">
            <span
              aria-hidden="true"
              className="mt-[0.4375rem] h-1.5 w-1.5 flex-none rounded-full bg-teal-deep"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
