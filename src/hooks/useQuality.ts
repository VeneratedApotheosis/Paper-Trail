"use client";

// Data hook for the Quality section of /eval (#117). Reads the latest sync report, history, skipped emails and the
// label eval together; "this is a receipt" and experiment runs are mutations that report failures as messages.
import { useCallback, useState } from "react";
import { getQualityEval, getQualityReports, getSkippedEmails, markSkippedAsPromotion, markSkippedAsReceipt, runQualityExperiment } from "@/lib/api/client";
import { invalidate } from "./cache";
import { useAction } from "./actions";
import { errorMessage, useAsync, type AsyncState } from "./useAsync";
import type { PromptVariantId } from "@/lib/quality/experiment-variants";
import type { ExperimentResult, QualityEvalResponse, QualityReportsResponse, SkippedEmailsResponse } from "@/lib/api/types";

export interface QualityData {
  reports: QualityReportsResponse;
  skipped: SkippedEmailsResponse;
  evaluation: QualityEvalResponse;
}

async function loadQuality(): Promise<QualityData> {
  const [reports, skipped, evaluation] = await Promise.all([getQualityReports(), getSkippedEmails(), getQualityEval()]);
  return { reports, skipped, evaluation };
}

export interface UseQuality {
  data: AsyncState<QualityData>;
  /** Re-runs a skipped email as a receipt; resolves to an error message, or null on success. */
  markReceipt: (emailId: string) => Promise<string | null>;
  /** Re-runs a skipped email as a shipping update (class "shipped"); same result as markReceipt. */
  markShipping: (emailId: string) => Promise<string | null>;
  /** Lists a skipped email on the Promotions page; same result as markReceipt. */
  markPromotion: (emailId: string) => Promise<string | null>;
  experiment: { run: (model: string, promptVariant: PromptVariantId) => void; pending: boolean; error: string | null; result: ExperimentResult | null };
}

export function useQuality(): UseQuality {
  const data = useAsync(loadQuality, []);
  const { refetch } = data;
  const experimentAction = useAction(runQualityExperiment, ["audit"]);
  const [result, setResult] = useState<ExperimentResult | null>(null);
  const runExperiment = useCallback((model: string, promptVariant: PromptVariantId) => {
    void experimentAction.run({ model, promptVariant }).then((next) => { if (next) setResult(next); });
  }, [experimentAction]);
  const mark = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      await invalidate();
      refetch();
      return null;
    } catch (caught: unknown) {
      refetch();
      return errorMessage(caught);
    }
  }, [refetch]);
  const markReceipt = useCallback((emailId: string) => mark(() => markSkippedAsReceipt(emailId)), [mark]);
  const markShipping = useCallback((emailId: string) => mark(() => markSkippedAsReceipt(emailId, { class: "shipped" })), [mark]);
  const markPromotion = useCallback((emailId: string) => mark(() => markSkippedAsPromotion(emailId)), [mark]);
  return { data, markReceipt, markShipping, markPromotion, experiment: { run: runExperiment, pending: experimentAction.pending, error: experimentAction.error, result } };
}
