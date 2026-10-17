import type { DeleteAllResponse } from "@/lib/api/types";
import { deleteAll } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Purges all user data and revokes the OAuth token when the #3 hook is registered. */
export async function POST(): Promise<Response> {
  const body: DeleteAllResponse = await deleteAll();
  return Response.json(body);
}
