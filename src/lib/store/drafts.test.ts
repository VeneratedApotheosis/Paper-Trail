import { beforeEach, expect, it } from "vitest";
import { loadSeedDemo } from "@/lib/demo/seed";
import { openClaim } from "@/lib/api/claims";
import type { ClaimDraftRecord } from "@/lib/api/types";
import { clearLedger, deleteAll, getState, resetStore, setPipelineResult, upsertDraft, withStoreScope } from "./index";

const seed = await loadSeedDemo({ cachePath: "missing-synthetic-cache.json" });
beforeEach(() => { resetStore(); setPipelineResult("demo", seed.asOf, seed); });
function savedDraft(): ClaimDraftRecord {
  const result = openClaim(seed.findings[0].id);
  if (!result.ok) throw new Error("Synthetic claim fixture unavailable");
  const draft = { ...result.claim.draft, body: "Synthetic user edits", edited: true, approvedAt: "2026-10-17T12:00:00Z" };
  upsertDraft(draft);
  return draft;
}
it("preserves user edits and approval when the same finding survives a rerun", () => {
  const draft = savedDraft();
  setPipelineResult("demo", seed.asOf, seed);
  expect(getState().drafts).toEqual([draft]);
  expect(openClaim(draft.findingId)).toMatchObject({ ok: true, claim: { draft } });
});
it.each(["amount", "currency", "explain"])("warns on changed %s facts without replacing approved text", field => {
  const draft = savedDraft();
  const findings = seed.findings.map((finding, i) => i ? finding : { ...finding,
    ...(field === "amount" ? { amountAtStake: finding.amountAtStake + 10 }
      : field === "currency" ? { currency: "CAD" } : { explain: { ...finding.explain, expectedAmount: 12345 } }),
  });
  setPipelineResult("demo", seed.asOf, { ...seed, findings });
  const stored = getState().drafts[0] as ClaimDraftRecord;
  expect(stored.body).toBe(draft.body);
  expect(stored.approvedAt).toBe(draft.approvedAt);
  expect(stored.warnings).toContainEqual(expect.stringContaining("may be outdated"));
  setPipelineResult("demo", seed.asOf, { ...seed, findings });
  expect((getState().drafts[0] as ClaimDraftRecord).warnings).toEqual(stored.warnings);
});
it("drops drafts whose findings disappear", () => {
  savedDraft();
  setPipelineResult("demo", seed.asOf, { ...seed, findings: [] });
  expect(getState().drafts).toEqual([]);
  setPipelineResult("demo", seed.asOf, seed);
  expect(getState().drafts).toEqual([]);
});
it("never restores a draft across delete-all or a ledger reset", async () => {
  savedDraft(); await deleteAll(); setPipelineResult("demo", seed.asOf, seed);
  expect(getState().drafts).toEqual([]);
  savedDraft(); clearLedger(); setPipelineResult("demo", seed.asOf, seed);
  expect(getState().drafts).toEqual([]);
});
it("never carries a draft to another account with identical finding IDs", () => {
  savedDraft();
  withStoreScope("synthetic-other", () => {
    resetStore(); setPipelineResult("demo", seed.asOf, seed);
    expect(getState().drafts).toEqual([]);
  });
  expect(getState().drafts).toHaveLength(1);
});
