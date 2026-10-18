"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { DemoBanner } from "@/components/DemoBanner";
import { ShellSyncControl, type AppShellSync } from "@/components/ShellSyncControl";

export type {
  AppShellSync,
  AppShellSyncAccountProgress,
  AppShellSyncConfirm,
  AppShellSyncNotice,
  AppShellSyncNoticeAccount,
  AppShellSyncProgress,
  AppShellSyncState,
} from "@/components/ShellSyncControl";

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
  // Global "Sync emails" button in the header (issue #112). Omit to render the shell without it (isolated previews).
  sync?: AppShellSync;
  // Called with the nav item's href when the user is about to open it (hover, focus, touch), so the wrapper can warm data.
  onNavIntent?: (href: string) => void;
}

const defaultNav: AppShellNavItem[] = [
  { href: "/", label: "Owed to you" },
  { href: "/ledger", label: "Purchases" },
  { href: "/promotions", label: "Promotions" },
  { href: "/review", label: "Review" },
  { href: "/trust", label: "Trust" },
  { href: "/account", label: "Account" },
];

const DEFAULT_DEMO_LABEL = "Demo data: synthetic";

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
  sync,
  onNavIntent,
}: AppShellViewProps) {
  const showDemoBanner = mode === "demo";

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col px-5 py-8 shadow-[inset_-10px_0_24px_rgba(176,188,206,0.35)] md:flex">
        <Link href="/" className="inline-flex min-h-[44px] items-center px-2 font-serif text-xl font-semibold text-ink">
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

      <div className="group/shell flex min-w-0 flex-1 flex-col">
        {showDemoBanner ? (
          <DemoBanner
            label={demoLabel}
            precomputedExtractionLabel={precomputedExtractionLabel}
            onLeaveDemo={onLeaveDemo}
          />
        ) : null}
        {/* Masthead: wordmark + account on mobile; on desktop only the sync control (fixed height, no layout shift) */}
        <header
          className={`relative mx-auto flex min-h-[4.25rem] w-full max-w-ledger items-center justify-between gap-3 px-5 py-3 group-has-[[data-layout=wide]]/shell:max-w-[76rem] md:justify-end md:px-12 md:pt-6 ${
            sync ? "" : "md:hidden"
          }`}
        >
          <Link href="/" className="inline-flex min-h-[44px] items-center font-serif text-lg font-semibold text-ink md:hidden">
            PaperTrail
          </Link>
          <div className="flex items-center gap-3">
            {sync ? <ShellSyncControl sync={sync} /> : null}
            {account ? (
              <div className="neu-raised-sm flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-ink-muted md:hidden">
                {account.initials}
              </div>
            ) : null}
          </div>
        </header>

        <main
          className={`mx-auto w-full max-w-ledger flex-1 px-5 pb-28 pt-2 group-has-[[data-layout=wide]]/shell:max-w-[76rem] md:px-12 md:pb-10 ${sync ? "md:pt-4" : "md:pt-10"}`}
        >
          {children}
        </main>

        <MobileNav nav={nav} activePath={activePath} onNavIntent={onNavIntent} />
      </div>
    </div>
  );
}

// Pages that move behind "More" on phones so the bar stays at five tabs (six do not fit at 390px).
const MORE_HREFS = ["/trust", "/account"];

function MobileNav({
  nav,
  activePath,
  onNavIntent,
}: {
  nav: AppShellNavItem[];
  activePath: string;
  onNavIntent?: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const more = nav.filter((item) => MORE_HREFS.includes(item.href));
  const primary = more.length > 0 ? nav.filter((item) => !MORE_HREFS.includes(item.href)) : nav;
  const moreActive = more.some((item) => isActive(activePath, item.href));

  // Navigating closes the sheet; so do Escape and a tap outside it.
  useEffect(() => setOpen(false), [activePath]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPress = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  const tab = (active: boolean) =>
    `flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-sm px-1 text-xs font-bold transition-shadow ${
      active ? "neu-inset text-teal-deep" : "text-ink-muted"
    }`;
  const intent = (href: string) => ({
    onMouseEnter: () => onNavIntent?.(href),
    onFocus: () => onNavIntent?.(href),
    onTouchStart: () => onNavIntent?.(href),
  });

  return (
    <nav ref={rootRef} aria-label="Main" className="neu-raised fixed inset-x-4 bottom-4 z-40 flex items-center justify-around gap-1 rounded-lg px-2 py-2 md:hidden">
      {primary.map((item) => {
        const active = isActive(activePath, item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} {...intent(item.href)} className={tab(active)}>
            {item.label}
          </Link>
        );
      })}
      {more.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="more-nav-sheet"
            onClick={() => setOpen((v) => !v)}
            className={tab(moreActive || open)}
          >
            More
          </button>
          <ul
            id="more-nav-sheet"
            hidden={!open}
            className="neu-raised absolute bottom-full right-0 mb-3 w-56 space-y-1 rounded-lg bg-paper p-2"
          >
            {more.map((item) => {
              const active = isActive(activePath, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    {...intent(item.href)}
                    className={`flex min-h-[44px] items-center rounded-sm px-4 text-sm font-bold ${active ? "neu-inset text-teal-deep" : "text-ink hover:text-teal-deep"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </nav>
  );
}