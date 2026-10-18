import { currentStoreScope } from "@/lib/store";
import { jsonError } from "./http";

/** Live LLM work (uploads, claim rephrase) allowed per store scope and window when ANTHROPIC_API_KEY is set (#91). */
export const LIVE_LLM_LIMIT = 20;
export const LIVE_LLM_WINDOW_MS = 10 * 60 * 1000;

const WINDOWS_KEY = Symbol.for("papertrail.liveLlmWindows");
const holder = globalThis as typeof globalThis & { [WINDOWS_KEY]?: Map<string, { start: number; count: number }> };
const windows = (holder[WINDOWS_KEY] ??= new Map());

/** Counts one live call for `scope`; false once the scope used LIVE_LLM_LIMIT calls in the current window. */
export function takeLiveLlmCall(scope: string, now = Date.now()): boolean {
  for (const [key, entry] of windows) if (now - entry.start >= LIVE_LLM_WINDOW_MS) windows.delete(key);
  const entry = windows.get(scope) ?? { start: now, count: 0 };
  if (entry.count >= LIVE_LLM_LIMIT) return false;
  entry.count += 1;
  windows.set(scope, entry);
  return true;
}

/** 429 when a live model call is configured and the current store scope is over its limit; null otherwise. */
export function liveLlmRateLimited(): Response | null {
  if (!process.env.ANTHROPIC_API_KEY || takeLiveLlmCall(currentStoreScope())) return null;
  return jsonError(429, "Too many AI requests. Wait a few minutes and try again.");
}

/** Tests only. */
export function resetLiveLlmLimits(): void {
  windows.clear();
}
