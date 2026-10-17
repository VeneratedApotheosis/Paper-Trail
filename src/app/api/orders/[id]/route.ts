import { z } from "zod";
import { decodeId, jsonError } from "@/lib/api/http";
import type { OrderResponse } from "@/lib/api/types";
import { getFindingsForOrder, getOrder } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IdSchema = z.string().min(1).max(300);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const parsed = IdSchema.safeParse(decodeId((await params).id));
  if (!parsed.success) return jsonError(400, "Invalid order id");
  const order = getOrder(parsed.data);
  if (!order) return jsonError(404, "Order not found");
  const body: OrderResponse = { order, findings: getFindingsForOrder(order.id) };
  return Response.json(body);
}
