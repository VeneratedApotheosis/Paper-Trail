import type { QualitySectionProps } from "../QualitySection";

/** Synthetic sample props for the Quality section (#117): fictional senders on reserved .example domains. */
const run = (id: string, at: string, extracted: number) => ({
  id, at, source: "gmail" as const, fetched: 48, prefilteredOut: 9, skippedNonReceipt: 6, extracted, lowConfidence: 3,
  extractionFailures: 1, matchedOrders: extracted - 2, findings: 4, llmCalls: extracted, inputTokens: 21400, outputTokens: 5100,
  bodySource: { plain: 30, html: 18 },
});

export const qualitySectionFixture: QualitySectionProps = {
  loading: false,
  error: null,
  latest: run("q3", "2026-10-17T18:30:00.000Z", 31),
  history: [run("q1", "2026-10-15T18:30:00.000Z", 22), run("q2", "2026-10-16T18:30:00.000Z", 27), run("q3", "2026-10-17T18:30:00.000Z", 31)],
  skipped: [
    { emailId: "m-101", from: { name: "Northwind Outfitters", domain: "northwind.example" }, subject: "Your order #NW-2041 is on its way", date: "2026-10-12T09:00:00.000Z", reason: "marketing" },
    { emailId: "m-102", from: { name: "The Oakhaven Journal", domain: "oakhaven.example" }, subject: "Five ways to layer textures", date: "2026-10-10T09:00:00.000Z", reason: "prefilter" },
  ],
  labelEval: {
    labels: 12, receipts: 9, notReceipts: 3, withFields: 7, precision: 0.88, recall: 0.78, fieldAccuracy: 0.86,
    fieldRows: [
      { field: "merchant", accuracy: 1, correct: 7, total: 7 },
      { field: "totals", accuracy: 0.71, correct: 5, total: 7 },
    ],
    unscored: 0,
    caveat: "Labels come from corrections and reviews, so these numbers describe those examples, not your whole inbox.",
  },
  currentModel: "claude-haiku-5-5",
  modelOptions: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  promptOptions: [{ id: "default", label: "Default prompt" }, { id: "conservative", label: "Conservative: null over guessing" }],
  experimentWarning: "Running an experiment calls Claude once per labeled email for each setting compared.",
  experiment: { pending: false, error: null, result: null },
  onMarkReceipt: async () => null,
  onRunExperiment: () => undefined,
};
