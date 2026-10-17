import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "./index";

describe("db schema", () => {
  it("exposes every table from deepdive_S14 §3", () => {
    const tableNames = [
      schema.users,
      schema.cards,
      schema.messages,
      schema.merchants,
      schema.orders,
      schema.lineItems,
      schema.events,
      schema.priceObservations,
      schema.findings,
      schema.drafts,
      schema.audit,
      schema.goldLabels,
      schema.evalRuns,
    ].map(getTableName);

    expect(tableNames).toEqual([
      "user",
      "card",
      "message",
      "merchant",
      "order",
      "line_item",
      "event",
      "price_obs",
      "finding",
      "draft",
      "audit",
      "gold_label",
      "eval_run",
    ]);
  });
});
