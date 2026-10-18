import type { QualitySectionProps } from "@/components/views/QualitySection";
import type { ExperimentResult, QualityEvalResponse, QualityReportsResponse, SkippedEmailsResponse } from "@/lib/api/types";
import { MODEL_PRICES } from "@/lib/quality/pricing";
import { EXPERIMENT_WARNING, PROMPT_VARIANTS } from "@/lib/quality/experiment-variants";

/** Maps the /api/quality* responses onto the Quality section's props (#117). Pure. */

export interface QualityViewInput {
  loading: boolean;
  error: string | null;
  reports: QualityReportsResponse | null;
  skipped: SkippedEmailsResponse | null;
  evaluation: QualityEvalResponse | null;
  experiment: { pending: boolean; error: string | null; result: ExperimentResult | null };
  onMarkReceipt: QualitySectionProps["onMarkReceipt"];
  onMarkShipping?: QualitySectionProps["onMarkShipping"];
  onMarkPromotion?: QualitySectionProps["onMarkPromotion"];
  onRunExperiment: QualitySectionProps["onRunExperiment"];
}

function experimentSide(side: ExperimentResult["current"]): NonNullable<QualitySectionProps["experiment"]["result"]>["current"] {
  return {
    label: `${side.model} · ${PROMPT_VARIANTS[side.promptVariant].label}`,
    accuracy: side.overallAccuracy,
    labelsScored: side.labelsScored,
    llmCalls: side.llmCalls,
    cachedLabels: side.cachedLabels,
    inputTokens: side.inputTokens,
    outputTokens: side.outputTokens,
    costUsd: side.estimatedCostUsd,
  };
}

export function qualityViewProps(input: QualityViewInput): QualitySectionProps {
  const { evaluation, experiment } = input;
  const currentModel = evaluation?.model ?? "claude-sonnet-5-5";
  const field = evaluation?.extraction.status === "ok" ? evaluation.extraction : null;
  return {
    loading: input.loading,
    error: input.error,
    latest: input.reports?.latest ?? null,
    history: input.reports?.history ?? [],
    skipped: input.skipped?.skipped ?? [],
    labelEval: evaluation
      ? {
          labels: evaluation.counts.labels,
          receipts: evaluation.counts.receipts,
          notReceipts: evaluation.counts.notReceipts,
          withFields: evaluation.counts.withFields,
          precision: evaluation.classification.precision,
          recall: evaluation.classification.recall,
          fieldRows: Object.entries(field?.perField ?? {}).map(([name, score]) => ({
            field: name, accuracy: score.accuracy, correct: score.correct, total: score.total,
          })),
          fieldAccuracy: field && field.labelsScored > 0 ? field.overallAccuracy : null,
          unscored: field?.unscored.length ?? 0,
          caveat: evaluation.caveat,
        }
      : null,
    currentModel,
    modelOptions: [currentModel, ...Object.keys(MODEL_PRICES).filter((model) => model !== currentModel)],
    promptOptions: Object.entries(PROMPT_VARIANTS).map(([id, variant]) => ({ id, label: variant.label })),
    experimentWarning: EXPERIMENT_WARNING,
    experiment: {
      pending: experiment.pending,
      error: experiment.error,
      result: experiment.result
        ? {
            labelsUsed: experiment.result.labelsUsed,
            capped: experiment.result.capped,
            current: experimentSide(experiment.result.current),
            candidate: experiment.result.candidate ? experimentSide(experiment.result.candidate) : null,
          }
        : null,
    },
    onMarkReceipt: input.onMarkReceipt,
    onMarkShipping: input.onMarkShipping,
    onMarkPromotion: input.onMarkPromotion,
    onRunExperiment: input.onRunExperiment,
  };
}
