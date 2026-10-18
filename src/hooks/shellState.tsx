"use client";

// App shell state for every page (issue #75): which data the app is showing (store mode), the honest labels, and a
// neutral account line. Loaded once in layout.tsx; <AppShell> reads it, so views that render <AppShell> stay
// props-only and unchanged. The ledger, session and account come from the shared read cache (cache.ts, issue #108): mounting
// <AppShell> costs one shared request each, and every mutation (useAction, `invalidate()`) refetches them, so the banner and
// account follow demo loads, uploads, syncs and deletes immediately.
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AppShellAccount, AppShellMode, AppShellSync } from "@/components/views/AppShellView";
import { resetDemo } from "@/lib/api/client";
import type { LedgerResponse, SessionStatus } from "@/lib/api/types";
import { invalidate } from "./cache";
import { useAccount, useLedger, useSession } from "./data";
import { useGmailSyncControl } from "./gmailSyncControl";

export interface ShellState {
  mode: AppShellMode;
  account?: AppShellAccount;
  demoLabel?: string;
  precomputedExtractionLabel?: string;
}

export interface ShellStateValue extends ShellState {
  /** Clears the demo ledger, then routes to /connect. */
  onLeaveDemo: () => void;
  /** Refetches mode, labels and Gmail status (ledger and session cache keys). */
  refresh: () => void;
  /** The header "Sync emails" button (issue #112): state, progress, confirm and result. */
  sync: AppShellSync;
}

// Never a person's name: the session API exposes no mailbox address, so accounts describe the data source.
export const DEMO_ACCOUNT: AppShellAccount = { initials: "D", name: "Demo data", sublabel: "Synthetic inbox" };
export const GMAIL_CONNECTED_ACCOUNT: AppShellAccount = { initials: "G", name: "Gmail connected", sublabel: "Read-only access" };
export const GMAIL_DISCONNECTED_ACCOUNT: AppShellAccount = { initials: "G", name: "Gmail data", sublabel: "Gmail not connected" };
export const UPLOAD_ACCOUNT: AppShellAccount = { initials: "U", name: "Uploaded receipts", sublabel: "Imported email files" };

function accountFor(mode: AppShellMode, gmailConnected: boolean | null): AppShellAccount | undefined {
  switch (mode) {
    case "demo":
      return DEMO_ACCOUNT;
    case "upload":
      return UPLOAD_ACCOUNT;
    case "gmail":
      return gmailConnected === false ? GMAIL_DISCONNECTED_ACCOUNT : GMAIL_CONNECTED_ACCOUNT;
    case "empty":
      return gmailConnected ? GMAIL_CONNECTED_ACCOUNT : undefined;
  }
}

/** Shell state from the ledger and session responses; null while loading (or failed) means "unknown": no banner. */
export function deriveShellState(
  ledger: Pick<LedgerResponse, "mode" | "labels"> | null,
  session: Pick<SessionStatus, "connected"> | null,
): ShellState {
  const mode: AppShellMode = ledger?.mode ?? "empty";
  return {
    mode,
    account: accountFor(mode, session ? session.connected : null),
    demoLabel: ledger?.labels.demo,
    precomputedExtractionLabel: ledger?.labels.precomputedExtraction ?? undefined,
  };
}

/** An explicit `demo` prop from a page wins over the shared state: true shows the banner, false hides it. */
export function resolveShellMode(sharedMode: AppShellMode, demo: boolean | undefined): AppShellMode {
  if (demo === true) return "demo";
  if (demo === false && sharedMode === "demo") return "empty";
  return sharedMode;
}

const ShellStateContext = createContext<ShellStateValue | null>(null);

/** Null outside <ShellStateProvider> (e.g. isolated previews). */
export function useShellState(): ShellStateValue | null {
  return useContext(ShellStateContext);
}

export function ShellStateProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const ledger = useLedger();
  const session = useSession();
  const account = useAccount();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const sync = useGmailSyncControl(account.data, navigate);

  const refresh = useCallback(() => {
    void invalidate(["ledger", "session"]);
  }, []);

  const onLeaveDemo = useCallback(() => {
    resetDemo()
      .then(async () => {
        await invalidate();
        router.push("/connect");
      })
      // The banner stays up; the refetched mode shows whether demo data is still loaded.
      .catch(() => refresh());
  }, [refresh, router]);

  const value = useMemo<ShellStateValue>(
    () => ({ ...deriveShellState(ledger.data, session.data), onLeaveDemo, refresh, sync }),
    [ledger.data, session.data, onLeaveDemo, refresh, sync],
  );

  return <ShellStateContext.Provider value={value}>{children}</ShellStateContext.Provider>;
}
