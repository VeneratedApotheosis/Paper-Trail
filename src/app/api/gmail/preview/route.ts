import { withAccountStore } from "@/lib/gmail/context";
import { previewGmailAccounts } from "@/lib/gmail/accounts";
import { gmailErrorResponse, gmailRequest } from "@/lib/gmail/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** `?accountId=` previews one linked account; by default every account (#114), with a per-account result. */
async function handleGET(request: Request): Promise<Response> {
  try {
    const accountId = new URL(request.url).searchParams.get("accountId") ?? undefined;
    const { accounts } = gmailRequest(request, accountId);
    return Response.json(await previewGmailAccounts(accounts), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return gmailErrorResponse(error); }
}
export const GET = withAccountStore(handleGET, { requireToken: true });