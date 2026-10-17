import type { Draft } from "@/lib/types";

/**
 * Hand-off helpers for an approved claim draft. The app never sends email (AGENTS.md hard rule #2): the user
 * copies the text or opens their own mail client via `mailto:`.
 */

/** Percent-encodes a mailto header value; line breaks become CRLF as RFC 6068 requires. */
function encodeMailtoValue(value: string): string {
  return encodeURIComponent(value.replace(/\r?\n/g, "\r\n"));
}

/** `mailto:` URL with the recipient, subject and body percent-encoded (an empty recipient is allowed). */
export function mailtoUrl(draft: Pick<Draft, "recipient" | "subject" | "body">): string {
  const recipient = encodeURIComponent(draft.recipient.trim()).replace(/%40/g, "@");
  return `mailto:${recipient}?subject=${encodeMailtoValue(draft.subject)}&body=${encodeMailtoValue(draft.body)}`;
}

/** Plain text for the clipboard, in the same shape the claim sheet copies. */
export function clipboardText(draft: Pick<Draft, "subject" | "body">): string {
  return `Subject: ${draft.subject}\n\n${draft.body}`;
}
