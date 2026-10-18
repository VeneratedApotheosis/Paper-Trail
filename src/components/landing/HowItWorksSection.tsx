import { INTRO_STEPS } from "@/components/OwedIntro";

// Same three steps shown inside the app's own first-run screen (OwedIntro),
// so the promise on the landing page and the promise inside the product are
// the exact same sentence, not a marketing paraphrase of it.
export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="mx-auto max-w-ledger px-5 py-16 xl:max-w-5xl xl:px-0 xl:py-24">
      <p className="eyebrow mb-3">How it works</p>
      <h2 className="max-w-xl font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Three steps, and you never lose control of your inbox.
      </h2>
      <ol className="mt-10 grid gap-6 sm:grid-cols-3">
        {INTRO_STEPS.map((step, index) => (
          <li key={step} className="neu-raised rounded-lg p-6">
            <span
              aria-hidden
              className="neu-inset mb-4 flex h-9 w-9 items-center justify-center rounded-full font-serif text-base font-bold text-teal-deep"
            >
              {index + 1}
            </span>
            <p className="text-base text-ink">{step}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
