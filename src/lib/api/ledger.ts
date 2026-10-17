import { getState } from "@/lib/store";
import { computeOwedSummary } from "@/lib/view";
import { API_LABELS, type LedgerResponse, type PipelineRunResponse } from "./types";

function roundToCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Server-side: builds GET /api/ledger from the store (exclusions already applied). */
export function buildLedgerResponse(): LedgerResponse {
  const state = getState();
  const summary = computeOwedSummary(state.findings, state.orders);
  return {
    mode: state.mode,
    asOf: state.asOf,
    orders: state.orders,
    findings: state.findings,
    summary: {
      ...summary,
      owedTotal: roundToCents(summary.owedTotal),
      excludedTotal: roundToCents(summary.excludedTotal),
    },
    reviewQueue: state.reviewQueue,
    excludedMerchants: state.excludedMerchants,
    stats: state.stats,
    labels: {
      demo: API_LABELS.demo,
      simulatedPrice: API_LABELS.simulatedPrice,
      precomputedExtraction: (state.stats?.extractionOrigins.gold ?? 0) > 0 ? API_LABELS.precomputedExtraction : null,
    },
  };
}

/** Server-side: summary returned after a pipeline run (POST /api/demo, POST /api/upload). */
export function buildPipelineRunResponse(): PipelineRunResponse {
  const ledger = buildLedgerResponse();
  if (!ledger.asOf || !ledger.stats) throw new Error("No pipeline result in the store");
  return { mode: ledger.mode, asOf: ledger.asOf, summary: ledger.summary, stats: ledger.stats };
}
