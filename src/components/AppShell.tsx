"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { prefetchAudit, prefetchLedger } from "@/hooks/data";
import { resolveShellMode, useShellState } from "@/hooks/shellState";
import { AppShellView } from "./views/AppShellView";

// Thin client wrapper: keeps the existing <AppShell> public API ({ demo?,
// children }) so every call site stays unchanged, and supplies the active path
// plus the real mode/account/labels from <ShellStateProvider> (layout.tsx) to
// the props-only <AppShellView>. A page's explicit `demo` prop still wins. The shell state comes from the shared read
// cache, so mounting it costs no request; hovering a nav link warms the data of the page behind it (issue #108).

function warmDataFor(href: string): void {
  if (href === "/trust") prefetchAudit();
  prefetchLedger();
}

export function AppShell({ demo, children }: { demo?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const shell = useShellState();

  const mode = resolveShellMode(shell?.mode ?? "empty", demo);

  return (
    <AppShellView
      activePath={pathname}
      mode={mode}
      account={shell?.account}
      demoLabel={shell?.demoLabel}
      precomputedExtractionLabel={shell?.precomputedExtractionLabel}
      onLeaveDemo={mode === "demo" ? shell?.onLeaveDemo : undefined}
      onNavIntent={shell ? warmDataFor : undefined}
    >
      {children}
    </AppShellView>
  );
}
