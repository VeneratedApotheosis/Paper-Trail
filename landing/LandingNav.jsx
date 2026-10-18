import { Link } from "react-router-dom";
import PrimaryButton from "../PrimaryButton";

const LINKS = [
  { label: "Features", href: "#features" },
  { label: "Trust", href: "#trust" },
  { label: "On your phone", href: "#pwa" },
  { label: "Developers", href: "#developers" },
];

export default function LandingNav() {
  return (
    <header className="sticky top-0 z-40" style={{ background: "var(--paper)" }}>
      <div className="max-w-[1200px] mx-auto px-5 lg:px-12 h-16 flex items-center justify-between">
        <a href="#top" className="font-heading text-[22px] font-semibold tracking-tight text-[color:var(--ink)]">
          PaperTrail
        </a>
        <nav className="hidden md:flex items-center gap-7">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="pt-focus rounded-[99px] px-1 py-1 text-[14px] font-semibold text-[color:var(--ink-muted)] hover:text-[color:var(--teal-deep)]"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <PrimaryButton as={Link} to="/app" className="h-10 px-5 text-[13px]">
          Open the app
        </PrimaryButton>
      </div>
    </header>
  );
}