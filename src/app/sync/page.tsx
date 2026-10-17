"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SyncPreview } from "@/components/SyncPreview";
import { SyncProgress } from "@/components/SyncProgress";

// Manual "Sync now" entry (issue #25). The first-sync cap and Gmail query mirror
// deepdive §2/§5: receipt-like query, last 90 days, ≤300 messages, 429 backoff.
// All counts here are simulated demo numbers — no real Gmail call happens.
const GMAIL_QUERY = "newer_than:90d category:purchases";
const PREVIEW_MESSAGE_COUNT = 18;

// This page is interactive (timers, cancel, reduced-motion branch), so the whole
// flow is a client component rather than a server page that renders one.
export default function SyncPage() {
  const [running, setRunning] = useState(false);
  // Dev affordance: preview the "inbox had no receipts" outcome without waiting
  // for a real empty result. Set on the preview, consumed by the progress run.
  const [simulateNoReceipts, setSimulateNoReceipts] = useState(false);

  return (
    <AppShell>
      {running ? (
        <SyncProgress
          totalMessages={PREVIEW_MESSAGE_COUNT}
          simulateNoReceipts={simulateNoReceipts}
          onCancel={() => setRunning(false)}
        />
      ) : (
        <SyncPreview
          query={GMAIL_QUERY}
          messageCount={PREVIEW_MESSAGE_COUNT}
          simulateNoReceipts={simulateNoReceipts}
          onToggleNoReceipts={setSimulateNoReceipts}
          onStart={() => setRunning(true)}
        />
      )}
    </AppShell>
  );
}
