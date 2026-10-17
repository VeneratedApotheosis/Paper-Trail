import type { AuditEntry, AuditType } from "@/lib/types";
import { auditLog } from "@/lib/mock/data";
import { formatDate } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import type { ChipTone } from "@/components/ui/Chip";

// Audit log (F1.8): every Gmail fetch, LLM call, approval and delete is recorded.
// Presentational only — reads the synthetic `auditLog` from mock data. When the
// backend audit API (#12 / #3) lands, swap the import for the fetched rows.

// Human-readable label for each machine audit type.
const TYPE_LABEL: Record<AuditType, string> = {
  gmail_fetch: "Gmail fetch",
  llm_call: "LLM call",
  approval: "Approval",
  delete: "Delete",
  sync_start: "Sync started",
  sync_complete: "Sync complete",
};

// One signal colour per meaning: delete is the destructive/vermilion signal.
function toneFor(type: AuditType): ChipTone {
  return type === "delete" ? "owed" : "neutral";
}

// LLM costs are fractions of a cent — show enough precision to be honest.
function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function AuditLogTable() {
  // Newest first.
  const rows: AuditEntry[] = [...auditLog].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );

  return (
    <div>
      <div className="flex items-center gap-4 border-b border-rule px-2 pb-2">
        <span className="col-head w-32 shrink-0">When</span>
        <span className="col-head w-32 shrink-0">Event</span>
        <span className="col-head min-w-0 flex-1">Detail</span>
      </div>
      {rows.map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-4 border-b border-rule px-2 py-3 last:border-b-0"
        >
          <span className="w-32 shrink-0 text-sm text-ink-muted">{formatDate(entry.at)}</span>
          <span className="w-32 shrink-0">
            <Chip tone={toneFor(entry.type)}>{TYPE_LABEL[entry.type]}</Chip>
          </span>
          <span className="min-w-0 flex-1 text-sm text-ink">
            {entry.detail}
            {entry.type === "llm_call" ? (
              <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-ink-muted">
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
        </div>
      ))}
    </div>
  );
}
