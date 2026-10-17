"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { formatDate } from "@/lib/format";
import { auditLog, findings, orders } from "@/lib/mock/data";

// Data controls for the Trust page (F1.8). Two client panels live here because
// the Trust page is a server component and both need local client state; they
// are the user's "control my data" surface (exclude merchants + delete all).

// Restrained destructive action: a soft raised chip with muted-red text. The
// slate palette has no red token, so the muted terracotta is an arbitrary value
// used only to signal the one destructive control without a traffic-light fill.
const destructive =
  "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold neu-raised-sm text-[#b0574c] transition-[box-shadow,transform] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

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
      <ul className="space-y-3">
        {merchants.map((name) => {
          const isExcluded = excluded.has(name);
          return (
            <li
              key={name}
              className="neu-inset flex items-center justify-between gap-4 rounded-lg px-4 py-3"
            >
              <span className="flex items-center gap-2 font-sans text-sm text-ink">
                {name}
                {isExcluded ? <Chip tone="neutral">Excluded</Chip> : null}
              </span>
              <label className="flex cursor-pointer items-center gap-2 font-sans text-sm text-ink-muted">
                <span className="hidden sm:inline">Exclude from scanning</span>
                <input
                  type="checkbox"
                  checked={isExcluded}
                  onChange={() => toggle(name)}
                  className="h-4 w-4 accent-teal"
                  aria-label={`Exclude ${name} from scanning`}
                />
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-label text-ink-faint">
        Excluded merchants are skipped on the next scan. This choice is not saved yet. Persistence
        is pending the backend.
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
    const receipt: Array<[string, string]> = [
      ["Gmail access", "OAuth token revoked"],
      ["Orders purged", String(orders.length)],
      ["Findings purged", String(findings.length)],
      ["Audit entries purged", String(auditLog.length)],
      ["Completed", formatDate(purgedAt)],
    ];
    return (
      <div className="neu-inset rounded-xl p-6">
        <p className="eyebrow text-[#b0574c]">Deletion receipt</p>
        <p className="mt-3 font-sans text-base text-ink">
          Everything was erased and Gmail access was revoked.
        </p>
        <dl className="mt-4 space-y-2.5 font-sans text-sm">
          {receipt.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-label text-ink-faint">
          Simulated for the demo. No real data was deleted and no token was revoked.
        </p>
      </div>
    );
  }

  return (
    <div className="neu-raised-sm rounded-xl p-6">
      <p className="font-sans text-base text-ink">
        <strong className="text-ink">Delete everything.</strong> This revokes PaperTrail&apos;s
        Gmail access and permanently erases all stored data: orders, findings, drafts and the audit
        log. This cannot be undone.
      </p>

      {stage === "idle" ? (
        <button type="button" className={`mt-5 ${destructive}`} onClick={startConfirm}>
          Delete everything
        </button>
      ) : (
        <div className="mt-5">
          <label htmlFor="delete-confirm" className="block font-sans text-sm text-ink">
            Type <span className="font-bold text-[#b0574c]">{CONFIRM_WORD}</span> to confirm.
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="neu-inset mt-2 w-48 rounded-lg bg-transparent px-3 py-2 font-sans text-sm text-ink"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={destructive}
              disabled={typed !== CONFIRM_WORD}
              onClick={confirmDelete}
            >
              Revoke access and erase all data
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
