"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { formatDate } from "@/lib/format";
import { auditLog, findings, orders } from "@/lib/mock/data";

// Data controls for the Trust page (F1.8). Two client panels live here because
// the Trust page is a server component and both need local client state; they
// are the user's "control my data" surface (exclude merchants + delete all).

// Shared destructive button: vermilion (`owed`) is the one destructive signal.
const destructive =
  "inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium bg-owed text-paper transition-colors hover:bg-owed/90 disabled:cursor-not-allowed disabled:opacity-50";

// --- Per-merchant exclude ----------------------------------------------------
// Lets the user exclude a merchant from future scanning. State is client-only
// for now; persistence is pending the backend (exclude list → next sync query).
export function MerchantExcludePanel() {
  const merchants = useMemo(
    () => Array.from(new Set(orders.map((o) => o.merchant.name))).sort(),
    [],
  );
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

  function toggle(name: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div>
      <ul className="border-t border-rule">
        {merchants.map((name) => {
          const isExcluded = excluded.has(name);
          return (
            <li
              key={name}
              className="flex items-center justify-between gap-4 border-b border-rule px-2 py-3"
            >
              <span className="flex items-center gap-2 text-sm text-ink">
                {name}
                {isExcluded ? <Chip tone="neutral">Excluded</Chip> : null}
              </span>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={isExcluded}
                  onChange={() => toggle(name)}
                  className="h-4 w-4 accent-owed"
                  aria-label={`Exclude ${name} from scanning`}
                />
                Exclude from scanning
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-label text-ink-faint">
        Excluded merchants are skipped on the next scan. This choice is not saved yet —
        persistence is pending the backend.
      </p>
    </div>
  );
}

// --- Delete everything -------------------------------------------------------
type DeleteStage = "idle" | "confirming" | "done";

const CONFIRM_WORD = "DELETE";

export function DeleteAllPanel() {
  const [stage, setStage] = useState<DeleteStage>("idle");
  const [typed, setTyped] = useState("");
  const [purgedAt, setPurgedAt] = useState<string | null>(null);

  function startConfirm() {
    setTyped("");
    setStage("confirming");
  }

  function cancel() {
    setTyped("");
    setStage("idle");
  }

  function confirmDelete() {
    // Real action (backend #12 / #3): POST /api/delete-all. That endpoint revokes
    // the stored OAuth token with Google and purges every stored row (orders,
    // findings, drafts, audit), then returns a receipt. Here we only SIMULATE
    // success so the UI flow is demonstrable without touching real data.
    setPurgedAt(new Date().toISOString());
    setStage("done");
  }

  if (stage === "done" && purgedAt) {
    return (
      <div className="rounded-lg border border-rule bg-paper-sunk px-5 py-5">
        <p className="col-head mb-3 text-owed">Deletion receipt</p>
        <p className="text-base text-ink">Everything was erased and Gmail access was revoked.</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4 border-b border-rule pb-2">
            <dt className="text-ink-muted">Gmail access</dt>
            <dd className="text-ink">OAuth token revoked</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-rule pb-2">
            <dt className="text-ink-muted">Orders purged</dt>
            <dd className="text-ink">{orders.length}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-rule pb-2">
            <dt className="text-ink-muted">Findings purged</dt>
            <dd className="text-ink">{findings.length}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-rule pb-2">
            <dt className="text-ink-muted">Audit entries purged</dt>
            <dd className="text-ink">{auditLog.length}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Completed</dt>
            <dd className="text-ink">{formatDate(purgedAt)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-label text-ink-faint">
          Simulated for the demo — no real data was deleted and no token was revoked.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-owed/30 bg-owed-tint px-5 py-5">
      <p className="text-base text-ink">
        <strong className="text-ink">Delete everything.</strong> This revokes PaperTrail&apos;s
        Gmail access and permanently erases all stored data — orders, findings, drafts and the
        audit log. This cannot be undone.
      </p>

      {stage === "idle" ? (
        <button type="button" className={`mt-4 ${destructive}`} onClick={startConfirm}>
          Delete everything
        </button>
      ) : (
        <div className="mt-4">
          <label htmlFor="delete-confirm" className="block text-sm text-ink">
            Type <span className="font-medium text-owed">{CONFIRM_WORD}</span> to confirm.
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="mt-2 w-48 rounded-sm border border-rule bg-paper px-2 py-1.5 text-sm text-ink"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              className={destructive}
              disabled={typed !== CONFIRM_WORD}
              onClick={confirmDelete}
            >
              Revoke access &amp; erase all data
            </button>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
