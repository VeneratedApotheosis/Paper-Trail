import type { AuditResponse } from "@/lib/api/types";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const body: AuditResponse = { entries: getState().audit };
  return Response.json(body);
}
