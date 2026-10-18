"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { resolveShellMode, useShellState } from "@/hooks/shellState";
import { AppShellView } from "./views/AppShellView";

// Thin client wrapper: keeps the existing <AppShell> public API ({ demo?,
// children }) so every call site stays unchanged, and supplies the active path
// plus the real mode/account/labels from <ShellStateProvider> (layout.tsx) to
// the props-only <AppShellView>. A page's explicit `demo` prop still wins.
export function AppShell({ demo, children }: { demo?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const shell = useShellState();
  const refresh = shell?.refresh;

  // Pages remount the shell when they switch between loading and loaded views,
  // so the mode follows demo loads, uploads, syncs and deletes.
  useEffect(() => {
    refresh?.();
  }, [refresh]);

  const mode = resolveShellMode(shell?.mode ?? "empty", demo);

  return (
    <AppShellView
      activePath={pathname}
      mode={mode}
      account={shell?.account}
      demoLabel={shell?.demoLabel}
      precomputedExtractionLabel={shell?.precomputedExtractionLabel}
      onLeaveDemo={mode === "demo" ? shell?.onLeaveDemo : undefined}
    >
      {children}
    </AppShellView>
  );
}
