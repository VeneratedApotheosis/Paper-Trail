import { describe, expect, it } from "vitest";
import { DEDUP_SPECS, rawEmailOf } from "./dedup-fixtures";
import { pairwiseScore, runAfter, runBefore, scenarios } from "./dedup-eval";

// The numbers behind #126's "before vs after" report. Run with `--reporter verbose` and read the console table.
describe("dedup test set: pairwise precision / recall, before vs after", () => {
  it("is labelled consistently and carries no real data", () => {
    expect(new Set(DEDUP_SPECS.map((spec) => spec.id)).size).toBe(DEDUP_SPECS.length);
    for (const spec of DEDUP_SPECS) {
      const raw = rawEmailOf(spec);
      expect(raw.from).toMatch(/@[a-z0-9.-]+\.(?:example|com|co\.uk)>$/);
      expect(raw.from).not.toMatch(/@(?!shoplineapp\.com|t\.shopifyemail\.com|amazon\.|ebay\.|gmail\.com)[a-z0-9.-]+\.(?:com|co\.uk)>/);
    }
  });

  it("after: every scenario and the whole set are perfect (precision 1.00, recall 1.00)", async () => {
    const table: string[] = ["scenario | emails | before P/R | after P/R"];
    for (const [name, specs] of scenarios()) {
      const before = pairwiseScore(specs, runBefore(specs));
      const after = pairwiseScore(specs, await runAfter(specs));
      table.push(`${name} | ${specs.length} | ${before.precision.toFixed(2)}/${before.recall.toFixed(2)} | ${after.precision.toFixed(2)}/${after.recall.toFixed(2)}`);
      expect({ name, wronglyMerged: after.wronglyMerged, wronglySplit: after.wronglySplit }).toEqual({ name, wronglyMerged: [], wronglySplit: [] });
    }
    const all = pairwiseScore(DEDUP_SPECS, await runAfter(DEDUP_SPECS));
    expect(all).toMatchObject({ precision: 1, recall: 1, falsePositives: 0, falseNegatives: 0 });
    console.log(table.join("\n"));
  });

  it("before: the pre-#126 matcher splits name/number variants and merges look-alikes", () => {
    const before = pairwiseScore(DEDUP_SPECS, runBefore(DEDUP_SPECS));
    expect(before.precision).toBeLessThan(0.75);
    expect(before.recall).toBeLessThan(0.5);
    expect(before.wronglyMerged).toEqual(expect.arrayContaining(["coffee-am + coffee-pm", "sub-sep + sub-oct", "vl-order + vl-big-refund"]));
    expect(before.wronglySplit).toEqual(expect.arrayContaining(["amz-order + amz-ship", "baz-confirm + baz-invoice", "bb-acct-a + bb-acct-b", "fc-order + fc-delivered", "nw-order-4001 + nw-refund-4001"]));
  });

  it("collapses an exact copy before extraction: one extractor call fewer, both Gmail ids kept", async () => {
    const specs = scenarios().get("exact copy in one inbox")!;
    const run = await runAfter(specs);
    expect(run.extractorCalls).toBe(1);
    expect(run.orders).toHaveLength(1);
    expect(run.orders[0].messageIds.sort()).toEqual(["sc-1", "sc-2"]);
    expect(runBefore(specs).extractorCalls).toBe(2);
  });

  it("keeps the same email in two inboxes as one order with both accounts as sources", async () => {
    const specs = scenarios().get("same email in two accounts, no ref")!;
    const run = await runAfter(specs);
    expect(run.orders).toHaveLength(1);
    expect(run.orders[0].sources).toEqual(["acct-a", "acct-b"]);
    expect(run.orders[0].messageIds.sort()).toEqual(["bb-acct-a", "bb-acct-b"]);
  });

  it("flags the two identical coffees as a possible duplicate without merging them", async () => {
    const run = await runAfter(scenarios().get("two identical coffees, same day")!);
    expect(run.orders).toHaveLength(2);
    const flagged = run.orders.filter((order) => order.possibleDuplicateOf);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].possibleDuplicateOf?.orderId).toBe(run.orders.find((order) => !order.possibleDuplicateOf)?.id);
  });
});
