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

// Shared page chrome: masthead + nav + optional demo banner. Screens wrap their
// content in <AppShell>. Keeps nav and the demo label consistent everywhere.
export function AppShell({ demo = true, children }: { demo?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen">
      {demo ? <DemoBanner /> : null}
      <header className="border-b border-rule bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-ledger items-center justify-between px-4 py-3">
          <Link href="/" className="font-serif text-lg font-semibold tracking-tight text-ink">
            PaperTrail
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {nav.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded px-3 py-1.5 transition-colors ${
                    active ? "bg-paper-sunk font-medium text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-ledger px-4 py-8">{children}</main>
    </div>
  );
}
