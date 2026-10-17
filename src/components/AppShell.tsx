"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShellView } from "./views/AppShellView";

// Thin client wrapper: keeps the existing <AppShell> public API ({ demo?,
// children }) so every call site stays unchanged, and supplies the active path
// to the props-only <AppShellView>.
export function AppShell({ demo = true, children }: { demo?: boolean; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <AppShellView activePath={pathname} demo={demo}>
      {children}
    </AppShellView>
  );
}
