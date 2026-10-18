import { describe, expect, it } from "vitest";
import type { Promotion } from "@/lib/contracts";
import { collapsePromotions } from "./merge";

const promotion = (id: string, receivedAt: string, extra: Partial<Promotion> = {}): Promotion => ({
  id, emailIds: [id], store: "Lumen Beauty", storeDomain: "lumenbeauty.example", receivedAt, headline: "20% off", discount: null,
  codes: [], expiresAt: null, channel: null, source: "rules", confidence: 0.6, ...extra,
});

describe("collapsePromotions", () => {
  it("merges the same headline within five days, newest details, earliest id", () => {
    const merged = collapsePromotions([
      promotion("b", "2026-10-19T09:00:00.000Z", { expiresAt: "2026-10-25T23:59:00.000Z", channel: "online" }),
      promotion("a", "2026-10-17T09:00:00.000Z", { codes: ["FALL20"] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "a", emailIds: ["a", "b"], receivedAt: "2026-10-19T09:00:00.000Z", codes: ["FALL20"], expiresAt: "2026-10-25T23:59:00.000Z", channel: "online" });
  });

  it("merges on a shared code even when the headline differs (case-insensitive), and chains merge", () => {
    const merged = collapsePromotions([
      promotion("a", "2026-10-10T09:00:00.000Z", { headline: "Fall sale", codes: ["FALL20"] }),
      promotion("b", "2026-10-13T09:00:00.000Z", { headline: "Last chance", codes: ["fall20", "EXTRA5"] }),
      promotion("c", "2026-10-17T09:00:00.000Z", { headline: "Final hours", codes: ["EXTRA5"] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].emailIds).toEqual(["a", "b", "c"]);
    expect(merged[0].codes.map((code) => code.toLowerCase()).sort()).toEqual(["extra5", "fall20"]);
  });

  it("keeps different stores, offers more than five days apart and different offers separate", () => {
    const list = collapsePromotions([
      promotion("a", "2026-10-10T09:00:00.000Z"),
      promotion("b", "2026-10-17T09:00:00.000Z"),
      promotion("c", "2026-10-17T10:00:00.000Z", { store: "Northwind", storeDomain: "northwind.example" }),
      promotion("d", "2026-10-17T11:00:00.000Z", { headline: "Free shipping" }),
    ]);
    expect(list.map((entry) => entry.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("uses the store name when the domain is unknown", () => {
    const merged = collapsePromotions([
      promotion("a", "2026-10-17T09:00:00.000Z", { storeDomain: null, store: "Small Shop" }),
      promotion("b", "2026-10-17T10:00:00.000Z", { storeDomain: null, store: "small shop" }),
    ]);
    expect(merged).toHaveLength(1);
  });
});
