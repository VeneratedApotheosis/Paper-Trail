import type { ConsentExample } from "@/components/ConsentExplainer";

// The "What you'll see" card on /connect: three findings from the synthetic seed inbox (seed/expected_findings.json),
// shown as a labelled synthetic example. Nothing here comes from a real inbox; the total is the sum of the rows.
const items: ConsentExample["items"] = [
  { label: "Refund overdue, Voltline Electronics", amount: 163.5 },
  { label: "Return window closing, Grandmart", amount: 134.22 },
  { label: "Price drop, Northwind Outfitters", amount: 40 },
];

export const CONSENT_EXAMPLE: ConsentExample = {
  total: Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
  currency: "USD",
  items,
};
