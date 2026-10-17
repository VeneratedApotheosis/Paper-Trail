import { withAccountStore } from "@/lib/gmail/context";
import { z } from "zod";
import { decodeId, jsonError } from "@/lib/api/http";
import type { FindingResponse } from "@/lib/api/types";
import { getFinding, getOrder } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IdSchema = z.string().min(1).max(300);

async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const parsed = IdSchema.safeParse(decodeId((await params).id));
  if (!parsed.success) return jsonError(400, "Invalid finding id");
  const finding = getFinding(parsed.data);
  const order = finding ? getOrder(finding.orderId) : undefined;
  if (!finding || !order) return jsonError(404, "Finding not found");
  const body: FindingResponse = { finding, order };
  return Response.json(body);
}

export const GET = withAccountStore(handleGET);
