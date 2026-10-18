import type { RawEmail } from "@/lib/contracts";
import { classify, prepareForLlm } from "@/lib/ingestion";
import { storedTextOf } from "@/lib/quality/text";
import type { StoredEmailText } from "@/lib/quality/types";

const CATEGORY_REASON = "Gmail Promotions category";

/**
 * Promotions-only copies of the emails the Gmail promotions pass read (#137), shaped like the marketing emails of a
 * receipt run so recordSyncPromotions() reads them the same way (rules for all, Claude for the newest). They never
 * enter the pipeline, so they cannot become orders, ledger rows or owed money, and they are not in the quality skipped
 * list. Redaction follows PAPERTRAIL_REDACT like the receipt path. Gmail filed them under Promotions, so a verdict that
 * is not marketing (e.g. "order now, 20% off") is treated as marketing; a phishing look-alike keeps its verdict and is
 * left out.
 */
export function promotionTextsOf(emails: readonly RawEmail[]): StoredEmailText[] {
  return emails.map((email) => {
    const redacted = prepareForLlm(email);
    const verdict = classify(redacted);
    const classification = verdict.class === "marketing"
      ? verdict
      : { emailId: email.id, class: "marketing" as const, confidence: 0.8, reason: CATEGORY_REASON };
    return storedTextOf({ email: redacted, classification, classOverridden: false, outcome: "skipped" });
  });
}
