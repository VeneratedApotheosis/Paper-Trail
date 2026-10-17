"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DemoBanner } from "./DemoBanner";

const nav = [
  { href: "/", label: "Owed" },
  { href: "/ledger", label: "Ledger" },
  { href: "/review", label: "Review" },
  { href: "/trust", label: "Trust" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

// Shared chrome. Desktop: a soft left sidebar. Mobile: a neumorphic bottom tab
// bar. Screens wrap their content in <AppShell>.
export function AppShell({ demo = true, children }: { demo?: boolean; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col px-5 py-8 shadow-[inset_-10px_0_24px_rgba(176,188,206,0.35)] md:flex">
        <Link href="/" className="px-2 font-serif text-xl font-semibold text-ink">
          PaperTrail
        </Link>
        <nav className="mt-9 flex flex-col gap-2">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-sm px-4 py-3 text-sm transition-shadow ${
                  active ? "neu-inset font-bold text-teal-deep" : "font-medium text-ink-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-3 px-1">
          <div className="neu-raised-sm flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-ink-muted">
            AS
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">Alex Song</div>
            <div className="text-xs text-ink-faint">Demo data</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {demo ? <DemoBanner /> : null}
        {/* Mobile masthead */}
        <header className="flex items-center justify-between px-5 py-4 md:hidden">
          <Link href="/" className="font-serif text-lg font-semibold text-ink">
            PaperTrail
          </Link>
          <div className="neu-raised-sm flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-ink-muted">
            AS
          </div>
        </header>

        <main className="mx-auto w-full max-w-ledger flex-1 px-5 pb-28 pt-2 md:px-10 md:py-10">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="neu-raised fixed inset-x-4 bottom-4 z-40 flex items-center justify-around rounded-lg px-2 py-2 md:hidden">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
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
