import type { TrustViewProps } from "@/components/views/TrustView";
import type { AuditEntry } from "@/lib/types";

// Sample props for previewing TrustView in isolation. Standalone synthetic data
// (not from @/lib/mock) so views stay decoupled from the data layer.
const noop = () => {};

const auditEntries: AuditEntry[] = [
  { id: "aud_1", at: "2026-03-18T09:00:00.000Z", type: "sync_complete", detail: "Sync finished: 4 orders, 4 findings" },
  {
    id: "aud_2",
    at: "2026-03-18T08:58:00.000Z",
    type: "llm_call",
    detail: "Extract fields, order RV-48213",
    redactedTokenCount: 3,
    model: "gpt-4o-mini",
    cost: 0.0021,
  },
  { id: "aud_3", at: "2026-03-18T08:55:00.000Z", type: "gmail_fetch", detail: "Fetched 18 messages (query: newer_than:90d category:purchases)" },
  { id: "aud_4", at: "2026-03-18T08:54:00.000Z", type: "sync_start", detail: "Sync started" },
];

export const trustViewFixture: TrustViewProps = {
  auditEntries,
  merchants: ["Atlas Outdoor", "Harbor Supply Co.", "Rowan and Vale"],
  excludedMerchants: ["Atlas Outdoor"],
  onToggleMerchant: noop,
  onDeleteAll: noop,
  deleteReceipt: null,
};
