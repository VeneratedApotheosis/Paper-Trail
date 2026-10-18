import { REVIEW_CONFIDENCE_THRESHOLD } from "@/lib/contracts";
import type { ExtractionAuditEntry } from "@/lib/ingestion";
import type { PipelineEmailObservation, PipelineResult } from "@/lib/pipeline/run";
import { senderIdentity, storedTextOf } from "./text";
import type { QualitySource, SkipReason, SkippedEmail, StoredEmailText, SyncQualityReport } from "./types";

/** What one finished run contributes; hand it to recordSyncQuality() once the run was published. */
export interface CollectedSync {
  report: Omit<SyncQualityReport, "id">;
  skipped: SkippedEmail[];
  texts: StoredEmailText[];
}

export interface SyncCollector {
  /** Pass as `PipelineDeps.observer`. */
  observe(observation: PipelineEmailObservation): void;
  /** Pass as `createLlmExtractor({ onUsage })`. */
  recordUsage(entry: ExtractionAuditEntry): void;
  finish(result: PipelineResult, extra?: { fetched?: number; bodySource?: { plain: number; html: number }; promotionsFetched?: number }): CollectedSync;
}

export interface SyncCollectorOptions {
  source: QualitySource;
  accountId?: string;
  clock?: () => Date;
}

const PHISHING_REASON = /phishing|suspicious/i;

function skipReason(observation: PipelineEmailObservation): SkipReason {
  if (observation.outcome === "prefiltered") return "prefilter";
  const { classification } = observation;
  if (observation.classOverridden && classification?.class === "not_receipt") return "marked_not_purchase";
  if (classification?.class === "marketing") return PHISHING_REASON.test(classification.reason ?? "") ? "phishing" : "marketing";
  return "not_receipt";
}

/**
 * Gathers one run's quality numbers. Reads the pipeline observer (redacted data only) and the extractor's usage rows.
 * Token counts come from those rows, never from email text.
 */
export function createSyncCollector(options: SyncCollectorOptions): SyncCollector {
  const clock = options.clock ?? (() => new Date());
  const observations: PipelineEmailObservation[] = [];
  const usage = { llmCalls: 0, inputTokens: 0, outputTokens: 0 };
  return {
    observe: (observation) => void observations.push(observation),
    recordUsage(entry) {
      usage.llmCalls += 1;
      usage.inputTokens += entry.inputTokens;
      usage.outputTokens += entry.outputTokens;
    },
    finish(result, extra = {}) {
      let lowConfidence = 0;
      let extractionFailures = 0;
      let skippedNonReceipt = 0;
      const skipped: SkippedEmail[] = [];
      for (const observation of observations) {
        if (observation.outcome === "extracted" && (observation.confMin ?? 0) < REVIEW_CONFIDENCE_THRESHOLD) lowConfidence += 1;
        if (observation.outcome === "extraction_failed") extractionFailures += 1;
        if (observation.outcome === "skipped") skippedNonReceipt += 1;
        if (observation.outcome !== "prefiltered" && observation.outcome !== "skipped") continue;
        const { email } = observation;
        skipped.push({
          emailId: email.id,
          ...(email.sourceAccount ? { accountId: email.sourceAccount } : {}),
          from: senderIdentity(email.from),
          subject: email.subject,
          date: email.date,
          reason: skipReason(observation),
          classConfidence: observation.classification?.confidence ?? null,
        });
      }
      const { stats } = result;
      return {
        report: {
          at: clock().toISOString(),
          source: options.source,
          ...(options.accountId ? { accountId: options.accountId } : {}),
          fetched: extra.fetched ?? stats.emails,
          ...(extra.promotionsFetched !== undefined ? { promotionsFetched: extra.promotionsFetched } : {}),
          prefilteredOut: stats.prefilteredOut,
          classified: { ...stats.classes },
          skippedNonReceipt,
          extracted: stats.extracted,
          lowConfidence,
          extractionFailures,
          matchedOrders: stats.orders,
          ...(stats.dedup ? { duplicatesCollapsed: stats.dedup.emailsCollapsed, mergesByReason: { ...stats.dedup.merges }, possibleDuplicates: stats.dedup.possibleDuplicates } : {}),
          ...(stats.lifecycle ? { lifecycle: { ...stats.lifecycle } } : {}),
          ...(stats.kinds ? { kinds: { ...stats.kinds } } : {}),
          findings: stats.findings,
          ...usage,
          bodySource: extra.bodySource ?? { plain: 0, html: 0 },
        },
        skipped,
        texts: observations.map(storedTextOf),
      };
    },
  };
}
