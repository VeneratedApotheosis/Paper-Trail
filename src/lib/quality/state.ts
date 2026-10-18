import { getQualityData } from "@/lib/store";
import type { CollectedSync } from "./collector";
import type { SkippedEmail, StoredEmailText, SyncQualityReport } from "./types";

export const MAX_QUALITY_HISTORY = 20;
export const MAX_SKIPPED_EMAILS = 300;
export const MAX_STORED_TEXTS = 400;

/** Skipped and troubled emails keep their text first when the cap forces a choice. */
function textPriority(text: StoredEmailText): number {
  return text.outcome === "extracted" ? 1 : 0;
}

/**
 * Records one published run into the current store scope. A Gmail run replaces that account's skipped emails and
 * texts (a re-sync supersedes them); an upload or demo run replaced the whole ledger, so it replaces everything.
 * Call it only after the run was published (same guard as the ledger commit).
 */
export function recordSyncQuality(collected: CollectedSync): SyncQualityReport {
  const data = getQualityData();
  const { accountId, source } = collected.report;
  const replaces = (entry: { accountId?: string }) => source !== "gmail" || entry.accountId === accountId;
  data.skipped = [...data.skipped.filter((entry) => !replaces(entry)), ...collected.skipped].slice(-MAX_SKIPPED_EMAILS);
  for (const [emailId, text] of data.texts) if (replaces(text)) data.texts.delete(emailId);
  const room = Math.max(0, MAX_STORED_TEXTS - data.texts.size);
  const kept = collected.texts.map((text, index) => ({ text, index }))
    .sort((a, b) => textPriority(a.text) - textPriority(b.text) || a.index - b.index)
    .slice(0, room);
  for (const { text } of kept) data.texts.set(text.emailId, text);
  data.reportSeq += 1;
  const report: SyncQualityReport = { id: `q${data.reportSeq}`, ...collected.report };
  data.history = [...data.history, report].slice(-MAX_QUALITY_HISTORY);
  return report;
}

export interface QualityResponse {
  /** The most recent run, or null before the first one. */
  latest: SyncQualityReport | null;
  /** Up to 20 runs, oldest first. */
  history: SyncQualityReport[];
}

export function getQualityReports(): QualityResponse {
  const { history } = getQualityData();
  return { latest: history.at(-1) ?? null, history: [...history] };
}

export function getSkippedEmails(): SkippedEmail[] {
  return [...getQualityData().skipped];
}
