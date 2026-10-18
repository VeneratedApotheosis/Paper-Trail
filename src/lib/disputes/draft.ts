import { z } from "zod";
import type { NormalizedOrder } from "@/lib/contracts";
import { claimClosing } from "@/lib/claims/draft";

export const DisputeRequestSchema = z.discriminatedUnion("reason", [
  z.object({ reason: z.literal("item_not_received"), confirmed: z.literal(true) }).strict(),
  z.object({ reason: z.literal("wrong_item"), confirmed: z.literal(true),
    lineItemId: z.string().trim().min(1).max(300), receivedItem: z.string().trim().min(1).max(500) }).strict(),
]);
export type DisputeRequest = z.infer<typeof DisputeRequestSchema>;
export interface DisputeDraft {
  orderId: string;
  reason: DisputeRequest["reason"];
  subject: string;
  body: string;
  signedName: string;
  evidence: Array<{ messageId: string; quote: string }>;
  warnings: string[];
  requiresApproval: true;
}
export type DisputeResult = { ok: true; draft: DisputeDraft } |
  { ok: false; reason: "invalid_request" | "unknown_item"; message: string };

/** A merchant support draft, not a chargeback, eligibility decision, finding or send operation. No LLM/I/O. */
export function draftDispute(order: NormalizedOrder, input: unknown): DisputeResult {
  const parsed = DisputeRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_request", message: "Confirm a supported dispute scenario and its required details." };
  const request = parsed.data;
  const item = request.reason === "wrong_item" ? order.lineItems.find(candidate => candidate.id === request.lineItemId) : undefined;
  if (request.reason === "wrong_item" && !item) return { ok: false, reason: "unknown_item", message: "Choose an item from this purchase." };
  const date = new Date(order.placedAt).toISOString().slice(0, 10);
  const reference = order.orderRef?.trim() || `purchase placed on ${date}`;
  const name = order.customerName?.trim();
  const signedName = name && !/\[(?:NAME|EMAIL|ADDRESS)_\d+\]/i.test(name) ? name : "Customer";
  const scenario = request.reason === "item_not_received"
    ? "I have not received this purchase. Please investigate its delivery status and let me know the next steps."
    : `I ordered ${item!.name}, but received the following instead: ${request.receivedItem}\nPlease let me know how to correct this and whether you need photos or other information.`;
  const warnings = ["This scenario is confirmed by you, not established by the email evidence. Review the facts and recipient before approving and sending yourself."];
  if (request.reason === "item_not_received" && order.events.some(event => event.type === "delivered")) {
    warnings.push("Your inbox includes a delivery notice. Check the delivery location and merchant record before sending.");
  }
  if (order.needsReview) warnings.push("This purchase still needs review; check the order details before using this draft.");
  return { ok: true, draft: {
    orderId: order.id, reason: request.reason,
    subject: `${request.reason === "item_not_received" ? "Delivery inquiry" : "Wrong item received"}: ${reference}`,
    body: `Hello ${order.merchant.name} support team,\n\nI am contacting you about ${reference}, placed on ${date}.\n\n${scenario}${claimClosing(signedName)}`,
    signedName,
    evidence: order.events.flatMap(event => event.evidence ? [{ messageId: event.messageId, quote: event.evidence.slice(0, 200) }] : []),
    warnings, requiresApproval: true,
  } };
}
