"use client";

import { AppShell } from "@/components/AppShell";
import { ErrorState, HeroSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { EvalView } from "@/components/views/EvalView";
import { useAsync } from "@/hooks";
import { useQuality } from "@/hooks/useQuality";
import type { EvalReport } from "@/lib/eval/run";
import { evalViewMetrics } from "./metrics";
import type { PromptVariantId } from "@/lib/quality/experiment-variants";
import { qualityViewProps } from "./quality";

async function loadEval(): Promise<EvalReport> {
  const response = await fetch("/api/eval", { cache: "no-store" });
  if (!response.ok) throw new Error("The evaluation report is unavailable. Please try again.");
  return response.json() as Promise<EvalReport>;
}

export default function EvalPage() {
  const report = useAsync(loadEval, []);
  const quality = useQuality();
  if (report.loading) return <AppShell><HeroSkeleton /></AppShell>;
  if (report.error || !report.data) {
    return <AppShell><ErrorState title="Couldn't load the evaluation" what={report.error}
      fix="Check that the app server is running, then try again."
      actions={<Button type="button" onClick={report.refetch}>Try again</Button>} /></AppShell>;
  }
  const { data, markReceipt, markShipping, markPromotion, experiment } = quality;
  return <EvalView metrics={evalViewMetrics(report.data)} quality={qualityViewProps({
    loading: data.loading, error: data.error, reports: data.data?.reports ?? null, skipped: data.data?.skipped ?? null,
    evaluation: data.data?.evaluation ?? null,
    experiment,
    onMarkReceipt: markReceipt,
    onMarkShipping: markShipping,
    onMarkPromotion: markPromotion,
    onRunExperiment: (model, promptVariant) => experiment.run(model, promptVariant as PromptVariantId),
  })} />;
}
