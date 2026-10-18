import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classOverridesFor, createLabelStore, deleteScopeLabels, existingLabelStore, setLabelStore } from "./labels";
import type { QualityLabel } from "./types";

const label = (emailId: string, extra: Partial<QualityLabel> = {}): QualityLabel => ({
  emailId, source: "feedback", class: "order", fields: null, redactedText: "Order #A-1 total $5.00", textHash: `hash-${emailId}`,
  subject: "Order #A-1", from: '"Shop" <sender@shop.example>', date: "2026-10-01T10:00:00.000Z", at: "2026-10-17T10:00:00.000Z", ...extra,
});

afterEach(() => { setLabelStore(undefined); vi.unstubAllEnvs(); });

describe("label store", () => {
  it("round-trips labels with corrected fields and keeps scopes apart", () => {
    const store = createLabelStore(":memory:");
    store.upsert("alice", label("m1", { source: "review", fields: { merchant: "Shop", totals: { total: 5 } }, accountId: "acc-1" }));
    store.upsert("bob", label("m1", { class: "not_receipt" }));
    expect(store.get("alice", "m1")).toMatchObject({ source: "review", accountId: "acc-1", fields: { merchant: "Shop", totals: { total: 5 } }, redactedText: "Order #A-1 total $5.00" });
    expect(store.get("bob", "m1")?.class).toBe("not_receipt");
    expect(store.get("alice", "missing")).toBeUndefined();
    expect(store.list("carol")).toEqual([]);
  });

  it("keeps the latest correction per email and lists newest first", () => {
    const store = createLabelStore(":memory:");
    store.upsert("s", label("m1", { at: "2026-10-17T10:00:00.000Z" }));
    store.upsert("s", label("m2", { at: "2026-10-17T11:00:00.000Z" }));
    store.upsert("s", label("m1", { class: "refund", at: "2026-10-17T12:00:00.000Z" }));
    expect(store.list("s").map((entry) => [entry.emailId, entry.class])).toEqual([["m1", "refund"], ["m2", "order"]]);
  });

  it("derives class overrides from feedback labels only", () => {
    const store = createLabelStore(":memory:");
    store.upsert("s", label("m1", { class: "not_receipt" }));
    store.upsert("s", label("m2", { source: "review", fields: { merchant: "Shop" } }));
    expect([...store.classOverrides("s")]).toEqual([["m1", "not_receipt"]]);
  });

  it("deletes one scope's labels", () => {
    const store = createLabelStore(":memory:");
    store.upsert("a", label("m1"));
    store.upsert("a", label("m2"));
    store.upsert("b", label("m1"));
    expect(store.deleteScope("a")).toBe(2);
    expect(store.list("a")).toEqual([]);
    expect(store.list("b")).toHaveLength(1);
  });

  it("never creates the database file when only reading or deleting", () => {
    const dir = mkdtempSync(join(tmpdir(), "pt117-"));
    try {
      const file = join(dir, "papertrail.sqlite");
      vi.stubEnv("DATABASE_URL", file);
      expect(existingLabelStore()).toBeUndefined();
      expect(classOverridesFor("s")("m1")).toBeUndefined();
      expect(deleteScopeLabels("s")).toBe(0);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
