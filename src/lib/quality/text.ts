import type { RedactedEmail } from "@/lib/contracts";
import type { PipelineEmailObservation } from "@/lib/pipeline/run";
import { senderDisplayName, senderDomain } from "@/lib/ingestion/text";
import type { QualityLabel, StoredEmailText } from "./types";

/** Display name and domain of a From header; the local part (the address itself) is dropped. */
export function senderIdentity(from: string): { name: string | null; domain: string | null } {
  const name = senderDisplayName(from)?.replace(/\S+@\S+/g, "").trim() || null;
  return { name, domain: senderDomain(from) };
}

/**
 * A From header rebuilt from name + domain only, so stored copies never hold a real address. The extraction prompt
 * and the classifier read the sender domain and display name, which survive.
 */
export function sanitizedFrom(identity: { name: string | null; domain: string | null }): string {
  const name = (identity.name ?? identity.domain ?? "unknown").replace(/["<>\\]/g, "");
  return `"${name}" <sender@${identity.domain ?? "unknown.invalid"}>`;
}

/** Keeps only redacted data from one pipeline observation (`to` and the raw From address are dropped). */
export function storedTextOf(observation: PipelineEmailObservation): StoredEmailText {
  const { email, classification } = observation;
  const { name, domain } = senderIdentity(email.from);
  return {
    emailId: email.id,
    ...(email.sourceAccount ? { accountId: email.sourceAccount } : {}),
    fromName: name,
    fromDomain: domain,
    subject: email.subject,
    date: email.date,
    text: email.text,
    textHash: email.textHash,
    redactions: { ...email.redactions },
    classification: classification
      ? { class: classification.class, confidence: classification.confidence, ...(classification.reason ? { reason: classification.reason } : {}) }
      : null,
    outcome: observation.outcome,
  };
}

/** A RedactedEmail for the extractor / matcher, rebuilt from stored redacted data. */
export function redactedEmailOf(stored: Pick<StoredEmailText, "emailId" | "accountId" | "fromName" | "fromDomain" | "subject" | "date" | "text" | "textHash" | "redactions">): RedactedEmail {
  return {
    id: stored.emailId,
    from: sanitizedFrom({ name: stored.fromName, domain: stored.fromDomain }),
    subject: stored.subject,
    date: stored.date,
    text: stored.text,
    redactions: stored.redactions as RedactedEmail["redactions"],
    textHash: stored.textHash,
    ...(stored.accountId ? { sourceAccount: stored.accountId } : {}),
  };
}

export function redactedEmailOfLabel(label: QualityLabel): RedactedEmail {
  return {
    id: label.emailId,
    from: label.from,
    subject: label.subject,
    date: label.date,
    text: label.redactedText,
    redactions: { pan: 0, phone: 0, address: 0, email: 0 },
    textHash: label.textHash,
    ...(label.accountId ? { sourceAccount: label.accountId } : {}),
  };
}
