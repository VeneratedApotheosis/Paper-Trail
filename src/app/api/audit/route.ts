import { withAccountStore } from "@/lib/gmail/context";
import type { AuditResponse } from "@/lib/api/types";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_request: Request): Promise<Response> {
  void _request;
  const body: AuditResponse = { entries: getState().audit };
  return Response.json(body);
}

export const GET = withAccountStore(handleGET);
