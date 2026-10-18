"use client";

import { useState } from "react";
import type { AuditEntry, AuditType } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import type { ChipTone } from "@/components/ui/Chip";

// Audit log (F1.8): every Gmail fetch, LLM call, approval and delete is recorded.
// Props-only: entries are supplied by the caller and typed via @/lib/types. The
// page (and later ui-wiring) owns where the rows come from.

// Human-readable label for each machine audit type.
const TYPE_LABEL: Record<AuditType, string> = {
  gmail_fetch: "Gmail fetch",
  llm_call: "LLM call",
  approval: "Approval",
  delete: "Delete",
  sync_start: "Sync started",
  sync_complete: "Sync complete",
};

// One signal colour per meaning: delete is the destructive/money-teal signal.
function toneFor(type: AuditType): ChipTone {
  return type === "delete" ? "owed" : "neutral";
}

// LLM costs are fractions of a cent — show enough precision to be honest.
function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export interface AuditLogTableProps {
  entries: AuditEntry[];
}

// Filter chips group the machine types into the words people use.
const FILTERS: { key: string; label: string; types: AuditType[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "sync", label: "Sync", types: ["sync_start", "sync_complete", "gmail_fetch"] },
  { key: "ai", label: "AI call", types: ["llm_call"] },
  { key: "approval", label: "Approval", types: ["approval"] },
  { key: "delete", label: "Delete", types: ["delete"] },
];
const PAGE = 8;

export function AuditLogTable({ entries }: AuditLogTableProps) {
  const [filter, setFilter] = useState("all");
  const [shown, setShown] = useState(PAGE);
  // Newest first.
  const sorted: AuditEntry[] = [...entries].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const matching = active.types.length === 0 ? sorted : sorted.filter((e) => active.types.includes(e.type));
  const rows = matching.slice(0, shown);
  // Only offer a filter that has rows, so no chip leads to an empty list.
  const available = FILTERS.filter((f) => f.key === "all" || sorted.some((e) => f.types.includes(e.type)));

  return (
    <div>
      {available.length > 2 ? (
        <div role="group" aria-label="Filter the log" className="-mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-3 pt-1.5 sm:mx-0 sm:flex-wrap sm:px-1.5">
          {available.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setShown(PAGE);
              }}
              className={`inline-flex min-h-[44px] flex-none items-center whitespace-nowrap rounded-full px-4 text-sm font-bold transition-shadow md:min-h-[36px] ${
                filter === f.key ? "neu-accent" : "neu-raised-sm text-ink-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="hidden gap-4 px-4 pb-3 sm:grid sm:grid-cols-[8rem_7rem_1fr]">
        <span className="eyebrow">When</span>
        <span className="eyebrow">Event</span>
        <span className="eyebrow">Detail</span>
      </div>
      <ul className="space-y-3">
        {rows.map((entry) => (
          <li
            key={entry.id}
            className="neu-inset grid gap-x-4 gap-y-2 rounded-lg px-4 py-3 sm:grid-cols-[8rem_7rem_1fr] sm:items-start"
          >
            <span className="font-sans text-sm text-ink-muted">{formatDate(entry.at)}</span>
            <span>
              <Chip tone={toneFor(entry.type)}>{TYPE_LABEL[entry.type]}</Chip>
            </span>
            <span className="min-w-0 font-sans text-sm text-ink">
              {entry.detail}
              {entry.type === "llm_call" ? (
                <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-ink-muted">
                  {typeof entry.redactedTokenCount === "number" ? (
                    <span>
                      {entry.redactedTokenCount} redacted token
                      {entry.redactedTokenCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {entry.model ? <span>model {entry.model}</span> : null}
                  {typeof entry.cost === "number" ? <span>cost {formatCost(entry.cost)}</span> : null}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {matching.length > shown ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-sm text-ink-muted">
            Showing {rows.length} of {matching.length}
          </span>
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE)}
            className="neu-raised-sm inline-flex min-h-[44px] items-center rounded-full px-5 text-sm font-bold text-teal-deep md:min-h-[36px]"
          >
            Show more
          </button>
        </div>
      ) : null}
    </div>
  );
}
