import { buildLedgerResponse } from "@/lib/api/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(buildLedgerResponse());
}
