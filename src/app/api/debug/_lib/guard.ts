import { jsonError } from "@/lib/api/http";
import { DEFAULT_LLM_MODEL } from "@/lib/llm";

/**
 * Dev-only debug routes (issue #34) are hidden in production builds unless PT_ENABLE_DEBUG=1.
 * Returns the 404 response to send, or null when the debug API is enabled.
 */
export function debugDisabledResponse(): Response | null {
  const disabled = process.env.NODE_ENV === "production" && process.env.PT_ENABLE_DEBUG !== "1";
  return disabled ? jsonError(404, "Not found") : null;
}

/** True when ANTHROPIC_API_KEY is set. The key itself is never returned or logged. */
export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Model the Anthropic client would use (same fallback as AnthropicLlmClient). */
export function configuredModel(): string {
  return process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL;
}
