import { withAccountStore } from "@/lib/gmail/context";
import { gmailErrorResponse, gmailRequest } from "@/lib/gmail/http";
import { previewGmail } from "@/lib/gmail/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request): Promise<Response> {
  try {
    return Response.json(await previewGmail(gmailRequest(request).deps), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return gmailErrorResponse(error); }
}
export const GET = withAccountStore(handleGET, { requireToken: true });
