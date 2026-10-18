import type { RawEmail, RedactedEmail } from "@/lib/contracts";
import { hashRedactedText, redact } from "./redact";

/**
 * Redaction switch (#125). `PAPERTRAIL_REDACT=on` runs the PII redactor before any LLM call (AGENTS.md hard rule #3);
 * `off` (the default, a local-demo decision by Kenan on 2026-10-18) sends the full receipt text so extraction can read
 * tracking numbers and similar details. Every path that builds LLM input goes through `prepareForLlm`.
 */
export type RedactionMode = "on" | "off";

export const REDACTION_ENV_VAR = "PAPERTRAIL_REDACT";
export const DEFAULT_REDACTION_MODE: RedactionMode = "off";

/** The mode from the environment: only `on` (any case, trimmed) turns redaction on; anything else is the default. */
export function redactionMode(env: Readonly<Record<string, string | undefined>> = process.env): RedactionMode {
  const value = env[REDACTION_ENV_VAR]?.trim().toLowerCase();
  if (value === "on") return "on";
  if (value === "off") return "off";
  return DEFAULT_REDACTION_MODE;
}

/** What the LLM may see for one email. `mode` pins the switch (tests, callers that already read it); default: the environment. */
export function prepareForLlm(email: RawEmail | RedactedEmail, mode: RedactionMode = redactionMode()): RedactedEmail {
  if (mode === "on") return redact(email);
  const withoutHtml: RawEmail = { ...email };
  delete withoutHtml.html;
  return {
    ...withoutHtml,
    redactions: { pan: 0, phone: 0, address: 0, email: 0, name: 0 },
    textHash: hashRedactedText(email.text),
  };
}
