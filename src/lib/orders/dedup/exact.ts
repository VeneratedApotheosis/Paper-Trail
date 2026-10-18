import { createHash } from "node:crypto";
import type { EmailClass, RawEmail } from "@/lib/contracts";
import { registrableDomain } from "./merchant";
import { senderDomain } from "@/lib/ingestion/text";

/**
 * Exact-copy detection (#126 A): the same message arriving twice (a forward kept by Gmail, one mail delivered to two
 * linked inboxes, an upload read twice). Copies are collapsed BEFORE extraction so no LLM call is spent on them, and
 * the surviving email keeps every copy's Gmail id and source account as provenance. Pure.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Fingerprint copies must have been sent within a day of each other. */
export const FINGERPRINT_MAX_GAP_MS = DAY_MS;
const FORWARD_PREFIX = /^\s*(?:(?:fwd?|fw|re|wg|tr|rv)\s*:\s*)+/i;

/** `<abc@mail.example>` -> `abc@mail.example` (lower case); null when empty. */
export function normalizeMessageId(messageId: string | null | undefined): string | null {
  const value = messageId?.trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return value ? value : null;
}

function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Hash of sender domain + subject (without Fwd:/Re:) + whitespace-normalized body. Null for an empty body. */
export function bodyFingerprint(email: Pick<RawEmail, "from" | "subject" | "text">): string | null {
  const body = normalizeText(email.text);
  if (body === "") return null;
  const domain = senderDomain(email.from);
  const material = [domain ? registrableDomain(domain) : "", normalizeText(email.subject.replace(FORWARD_PREFIX, "")), body].join("\n");
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
}

/** `mid:<Message-ID>` and `fp:<fingerprint>` keys of an email; stored on the order as `emailKeys`. */
export function emailKeys(email: Pick<RawEmail, "from" | "subject" | "text" | "messageId">): string[] {
  const keys: string[] = [];
  const messageId = normalizeMessageId(email.messageId);
  if (messageId) keys.push(`mid:${messageId}`);
  const fingerprint = bodyFingerprint(email);
  if (fingerprint) keys.push(`fp:${fingerprint}`);
  return keys;
}

export type CopyReason = "message_id" | "fingerprint";

interface Seen {
  index: number;
  email: RawEmail;
  cls: EmailClass;
}

/**
 * Remembers the emails of one run. `find` answers which earlier email an incoming one is an exact copy of:
 * - same Message-ID (and class): always a copy;
 * - same body fingerprint, sent within a day, seen through a different linked account: a copy.
 *   Identical text in ONE account with different Message-IDs is NOT collapsed (not even in one Gmail thread): two
 *   identical coffee receipts look alike. Runs are per account today, so across accounts the same decision is made
 *   on `emailKeys` when the account ledgers are merged (see mergeAccountResults).
 */
export class ExactCopyRegistry {
  private readonly byMessageId = new Map<string, Seen>();
  private readonly byFingerprint = new Map<string, Seen[]>();

  find(email: RawEmail, cls: EmailClass): { index: number; reason: CopyReason } | null {
    const messageId = normalizeMessageId(email.messageId);
    const sameId = messageId ? this.byMessageId.get(messageId) : undefined;
    if (sameId && sameId.cls === cls) return { index: sameId.index, reason: "message_id" };
    const fingerprint = bodyFingerprint(email);
    if (!fingerprint) return null;
    const at = Date.parse(email.date);
    for (const seen of this.byFingerprint.get(fingerprint) ?? []) {
      // Two different Message-IDs are two different messages, whatever their bodies look like.
      const otherId = normalizeMessageId(seen.email.messageId);
      if (messageId && otherId && messageId !== otherId) continue;
      if (seen.cls !== cls || Math.abs(at - Date.parse(seen.email.date)) > FINGERPRINT_MAX_GAP_MS) continue;
      const otherAccount = Boolean(email.sourceAccount && seen.email.sourceAccount && email.sourceAccount !== seen.email.sourceAccount);
      if (otherAccount) return { index: seen.index, reason: "fingerprint" };
    }
    return null;
  }

  /** Registers a surviving (non-copy) email under its position in the run. */
  add(index: number, email: RawEmail, cls: EmailClass): void {
    const seen: Seen = { index, email, cls };
    const messageId = normalizeMessageId(email.messageId);
    if (messageId && !this.byMessageId.has(messageId)) this.byMessageId.set(messageId, seen);
    const fingerprint = bodyFingerprint(email);
    if (fingerprint) this.byFingerprint.set(fingerprint, [...(this.byFingerprint.get(fingerprint) ?? []), seen]);
  }
}
