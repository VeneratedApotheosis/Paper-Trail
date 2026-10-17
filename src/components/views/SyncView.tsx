"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SyncPreview } from "@/components/SyncPreview";
import { SyncProgress } from "@/components/SyncProgress";

// Props-only view for the manual "Sync now" flow (issue #25). Data + navigation
// arrive as callbacks so the page wrapper (and later ui-wiring) owns them; no
// fetch, no @/lib/api|store|mock|auth, no routing in here. The simulated staged
// progress (SyncProgress) and the no-receipts dev toggle are presentation-only
// local UI state and stay inside the view.
export interface SyncViewProps {
  query: string;
  windowDays?: number;
  onStart: () => void;
  onUpload: (files: FileList) => void;
  onComplete: () => void;
  onCancel: () => void;
}

// Simulated demo numbers, matching the first-sync cap in deepdive §2/§5. No real
// Gmail call happens; the real count is supplied by ui-wiring later.
const DEFAULT_WINDOW_DAYS = 90;
const PREVIEW_MESSAGE_COUNT = 18;

export function SyncView({
  query,
  windowDays = DEFAULT_WINDOW_DAYS,
  onStart,
  onUpload,
  onComplete,
  onCancel,
}: SyncViewProps) {
  const [running, setRunning] = useState(false);
  // Dev affordance: preview the "inbox had no receipts" outcome without waiting
  // for a real empty result. Set on the preview, consumed by the progress run.
  const [simulateNoReceipts, setSimulateNoReceipts] = useState(false);

  function handleStart() {
    setRunning(true);
    onStart();
  }

  function handleCancel() {
    setRunning(false);
    onCancel();
  }

  return (
    <AppShell>
      {running ? (
        <SyncProgress
          query={query}
          totalMessages={PREVIEW_MESSAGE_COUNT}
          simulateNoReceipts={simulateNoReceipts}
          onCancel={handleCancel}
          onComplete={onComplete}
          onUpload={onUpload}
        />
      ) : (
        <SyncPreview
          query={query}
          windowDays={windowDays}
          messageCount={PREVIEW_MESSAGE_COUNT}
          simulateNoReceipts={simulateNoReceipts}
          onToggleNoReceipts={setSimulateNoReceipts}
          onStart={handleStart}
        />
      )}
    </AppShell>
  );
}
