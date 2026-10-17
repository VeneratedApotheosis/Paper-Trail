import { configuredModel, debugDisabledResponse, llmConfigured } from "../_lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/debug/status: whether live Claude calls are possible. Never returns the key. Dev-only (issue #34). */
export function GET(): Response {
  const disabled = debugDisabledResponse();
  if (disabled) return disabled;
  return Response.json({ llmConfigured: llmConfigured(), model: configuredModel() });
}
