import type { EvalViewProps } from "@/components/views/EvalView";

// Sample props for previewing EvalView in isolation. Standalone synthetic
// numbers (not from @/lib/eval or @/lib/mock) so the view stays decoupled from
// the data layer. The view has no callbacks, so there is nothing to noop.
export const evalViewFixture: EvalViewProps = {
  metrics: {
    title: "How accurate PaperTrail is",
    subtitle:
      "Every number comes from deterministic rules. These scores measure how well we read receipts and surface what you are owed, on a held-out synthetic set.",
    headline: {
      accuracy: 0.93,
      precision: 0.91,
      recall: 0.88,
      f1: 0.89,
    },
    breakdownLabel: "Per finding kind",
    classes: [
      { label: "Refund overdue", precision: 0.94, recall: 0.9, f1: 0.92, support: 12 },
      { label: "Return deadline", precision: 0.9, recall: 0.86, f1: 0.88, support: 9 },
      { label: "Price drop", precision: 0.87, recall: 0.83, f1: 0.85, support: 7 },
      { label: "Short refund", precision: 0.92, recall: 0.9, f1: 0.91, support: 5 },
    ],
    baseline: {
      label: "Keyword baseline",
      accuracy: 0.71,
      precision: 0.64,
      recall: 0.58,
      f1: 0.61,
    },
    sampleNote: "Scored on 48 held-out synthetic emails and 33 expected findings. Synthetic seed data, labeled as such.",
  },
};
