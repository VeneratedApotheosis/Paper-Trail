import { withAccountStore } from "@/lib/gmail/context";
import { buildLedgerResponse } from "@/lib/api/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_request: Request): Promise<Response> {
  void _request;
  return Response.json(buildLedgerResponse());
}

export const GET = withAccountStore(handleGET);
