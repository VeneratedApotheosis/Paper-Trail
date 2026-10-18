import { LlmError, LlmHttpError, LlmResponseError, LlmTimeoutError, LlmUnavailableError } from "./client";

/** Fixed vocabulary only: arbitrary provider messages/names may contain secrets. */
export function llmErrorClass(error: unknown): string {
  if (error instanceof LlmUnavailableError) return "unavailable";
  if (error instanceof LlmTimeoutError) return "timeout";
  if (error instanceof LlmHttpError) return "http_error";
  if (error instanceof LlmResponseError) return "invalid_response";
  if (error instanceof LlmError) return "network_error";
  return "unknown_error";
}
