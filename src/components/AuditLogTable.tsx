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

export function AuditLogTable({ entries }: AuditLogTableProps) {
  // Newest first.
  const rows: AuditEntry[] = [...entries].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );

  return (
    <div>
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
    </div>
  );
}
