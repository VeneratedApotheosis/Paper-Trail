import type { Promotion } from "@/lib/contracts";
import type { StoredEmailText } from "@/lib/quality/types";

/** What Claude (or the cache) contributes to a promotion; everything else stays as the rules read it. */
export interface PromotionDetails {
  headline: string;
  discount: Promotion["discount"];
  codes: string[];
  expiresAt: string | null;
  channel: Promotion["channel"];
  confidence: number;
}

/** One marketing email's promotion with the redacted text Claude would read (memory only, like the quality texts). */
export interface PromotionEntry {
  /** One email's promotion: `id` is the email id. Duplicates are collapsed when read (see collapsePromotions). */
  promotion: Promotion;
  stored: StoredEmailText;
  /** Claude was asked (or the cache answered) for this email; it is not asked again. */
  attempted: boolean;
}

/** Per store scope (anonymous demo or one signed-in profile); replaced wholesale by delete-all. */
export interface PromotionData {
  /** By email id. */
  entries: Map<string, PromotionEntry>;
  /** Claude's validated answers by redacted text hash, so a re-sync of the same email costs nothing. */
  detailsCache: Map<string, PromotionDetails>;
  /** Enrichment runs in flight; the page keeps refreshing while this is above zero. */
  enriching: number;
}

export function emptyPromotionData(): PromotionData {
  return { entries: new Map(), detailsCache: new Map(), enriching: 0 };
}
