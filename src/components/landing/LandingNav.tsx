import Link from "next/link";

// Sticky marketing nav. Plain anchors to the sections below plus one real nav
// link into the app. No fetch, no auth, no client state — matches the
// read-only, nothing-hidden tone of the rest of PaperTrail.
const SECTION_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "What it finds", href: "#findings" },
  { label: "Trust", href: "#trust" },
];

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-ledger items-center justify-between px-5 xl:max-w-5xl xl:px-0">
        <a href="#top" className="font-serif text-xl font-semibold text-ink">
          PaperTrail
        </a>
        <nav aria-label="Page sections" className="hidden items-center gap-6 sm:flex">
          {SECTION_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-sm py-1 text-sm font-semibold text-ink-muted transition-colors hover:text-teal-deep"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <Link
          href="/"
          className="neu-accent inline-flex min-h-[40px] items-center justify-center rounded-lg px-4 text-sm font-bold transition-[box-shadow,transform] active:scale-[0.99]"
        >
          Open the app
        </Link>
      </div>
    </header>
  );
}
