import { describe, expect, it } from "vitest";
import type { MerchantPolicy } from "@/lib/contracts";
import { DEFAULT_RETURN_WINDOW_DAYS, resolveReturnWindow, type ReturnWindow } from "./policies";
import { makeOrder, makePolicy } from "./test-helpers";

const QUOTE = "Items can be returned within 45 days of delivery.";

const orderWithPolicy = (overrides: Partial<MerchantPolicy>) =>
  makeOrder({
    merchant: { name: "Northwind Outfitters", domain: "northwind.example", policy: makePolicy(overrides) },
  });

describe("resolveReturnWindow", () => {
  it("defaults to 30 days", () => {
    expect(DEFAULT_RETURN_WINDOW_DAYS).toBe(30);
  });

  it.each<{ name: string; policy: Partial<MerchantPolicy>; expected: ReturnWindow }>([
    {
      name: "email-stated window counted from delivery",
      policy: { returnWindowDays: 45, windowAnchor: "delivery", policySource: "email_text", policyQuote: QUOTE },
      expected: { days: 45, source: "email_text", anchor: "delivery", quote: QUOTE },
    },
    {
      name: "user-set window counted from the order date",
      policy: { returnWindowDays: 14, windowAnchor: "order", policySource: "user" },
      expected: { days: 14, source: "user", anchor: "order", quote: null },
    },
    {
      name: "merchant default table maps to source default",
      policy: { returnWindowDays: 60, windowAnchor: "delivery", policySource: "default_table" },
      expected: { days: 60, source: "default", anchor: "delivery", quote: null },
    },
    {
      name: "stated window without a source counts as email text",
      policy: { returnWindowDays: 20, windowAnchor: "delivery", policySource: null },
      expected: { days: 20, source: "email_text", anchor: "delivery", quote: null },
    },
    {
      name: "stated window with unknown anchor counts from the order date",
      policy: { returnWindowDays: 20, windowAnchor: null, policySource: "email_text" },
      expected: { days: 20, source: "email_text", anchor: "order", quote: null },
    },
    {
      name: "unknown window falls back to 30 days from the order date",
      policy: { returnWindowDays: null, windowAnchor: "delivery", policySource: null },
      expected: { days: 30, source: "default", anchor: "order", quote: null },
    },
  ])("$name", ({ policy, expected }) => {
    expect(resolveReturnWindow(orderWithPolicy(policy))).toEqual(expected);
  });
});
