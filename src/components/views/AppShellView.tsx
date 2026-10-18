import type { ReactNode } from "react";
import Link from "next/link";
import { DemoBanner } from "@/components/DemoBanner";

// Props-only shared chrome. Desktop: a soft left sidebar. Mobile: a neumorphic
// bottom tab bar. Active nav state is derived from the `activePath` PROP (no
// usePathname/useRouter and no data imports), so the thin <AppShell> wrapper (or
// later ui-wiring) owns pathname + navigation. Declarative <Link> navigation is
// fine here; only hooks/data access are disallowed.
export interface AppShellNavItem {
  href: string;
  label: string;
}

export interface AppShellAccount {
  initials: string;
  name: string;
  sublabel?: string;
}

// Which data the app is showing. Drives the demo banner and keeps chrome honest
// (AGENTS.md: synthetic data is always labelled as such).
export type AppShellMode = "empty" | "demo" | "upload" | "gmail";

export interface AppShellViewProps {
  children: ReactNode;
  activePath: string;
  nav?: AppShellNavItem[];
  account?: AppShellAccount;
  mode: AppShellMode;
  demoLabel?: string;
  // Shown next to the demo label when extractions came from seed labels, not an LLM.
  precomputedExtractionLabel?: string;
  onLeaveDemo?: () => void;
  // Called with the nav item's href when the user is about to open it (hover, focus, touch), so the wrapper can warm data.
  onNavIntent?: (href: string) => void;
}

const defaultNav: AppShellNavItem[] = [
  { href: "/", label: "Owed" },
  { href: "/ledger", label: "Ledger" },
  { href: "/review", label: "Review" },
  { href: "/trust", label: "Trust" },
];

const DEFAULT_DEMO_LABEL = "Demo data \u2014 synthetic, not real purchases";

function isActive(activePath: string, href: string): boolean {
  return href === "/" ? activePath === "/" : activePath.startsWith(href);
}

export function AppShellView({
  children,
  activePath,
  nav = defaultNav,
  account,
  mode,
  demoLabel = DEFAULT_DEMO_LABEL,
  precomputedExtractionLabel,
  onLeaveDemo,
  onNavIntent,
}: AppShellViewProps) {
  const showDemoBanner = mode === "demo";

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col px-5 py-8 shadow-[inset_-10px_0_24px_rgba(176,188,206,0.35)] md:flex">
        <Link href="/" className="px-2 font-serif text-xl font-semibold text-ink">
          PaperTrail
        </Link>
        <nav className="mt-9 flex flex-col gap-2">
          {nav.map((item) => {
            const active = isActive(activePath, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => onNavIntent?.(item.href)}
                onFocus={() => onNavIntent?.(item.href)}
                onTouchStart={() => onNavIntent?.(item.href)}
                className={`rounded-sm px-4 py-3 text-sm transition-shadow ${
                  active ? "neu-inset font-bold text-teal-deep" : "font-medium text-ink-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {account ? (
          <div className="mt-auto flex items-center gap-3 px-1">
            <div className="neu-raised-sm flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-ink-muted">
              {account.initials}
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">{account.name}</div>
              {account.sublabel ? <div className="text-xs text-ink-faint">{account.sublabel}</div> : null}
            </div>
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {showDemoBanner ? (
          <DemoBanner
            label={demoLabel}
            precomputedExtractionLabel={precomputedExtractionLabel}
            onLeaveDemo={onLeaveDemo}
          />
        ) : null}
        {/* Mobile masthead */}
        <header className="flex items-center justify-between px-5 py-4 md:hidden">
          <Link href="/" className="font-serif text-lg font-semibold text-ink">
            PaperTrail
          </Link>
          {account ? (
            <div className="neu-raised-sm flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-ink-muted">
              {account.initials}
            </div>
          ) : null}
        </header>

        <main className="mx-auto w-full max-w-ledger flex-1 px-5 pb-28 pt-2 md:px-10 md:py-10">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="neu-raised fixed inset-x-4 bottom-4 z-40 flex items-center justify-around rounded-lg px-2 py-2 md:hidden">
          {nav.map((item) => {
            const active = isActive(activePath, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => onNavIntent?.(item.href)}
                onFocus={() => onNavIntent?.(item.href)}
                onTouchStart={() => onNavIntent?.(item.href)}
                className={`rounded-sm px-4 py-2 text-xs font-bold transition-shadow ${
                  active ? "neu-inset text-teal-deep" : "text-ink-muted"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
