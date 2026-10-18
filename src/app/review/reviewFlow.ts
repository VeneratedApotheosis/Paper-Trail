import type { OrderFieldEdit } from "@/components/ReviewCard";
import type { NormalizedOrder } from "@/lib/contracts";
import { ApiError } from "@/lib/api/client";
import type { ReviewQueueItem } from "@/lib/api/types";
import { ReviewEditSchema, type ReviewEdit } from "@/lib/review/schema";
import type { ReviewMutationResponse } from "./reviewApi";

/**
 * Review flow for /review (#65). ReviewCard fires one OrderFieldEdit per keystroke, but every saved edit rotates the
 * order's revision and writes an audit row, so the page buffers the latest value per field (shown locally through
 * `applyEdits`) and sends them only when the user confirms: each edit with the revision the previous response
 * returned, then the confirmation with the newest one. Nothing is shown as saved or confirmed unless its call
 * succeeded.
 */

/** One buffered value per field (per line item for line-item fields). */
function editKey(edit: OrderFieldEdit): string {
  return "lineItemId" in edit ? `${edit.field}:${edit.lineItemId}` : edit.field;
}

function storedValue(order: NormalizedOrder, edit: OrderFieldEdit): string | number | null | undefined {
  switch (edit.field) {
    case "merchantName":
      return order.merchant.name;
    case "orderRef":
      return order.orderRef;
    case "placedAt":
      return order.placedAt;
    case "total":
      return order.total;
    case "lineItemName":
    case "lineItemQty":
    case "lineItemUnitPrice": {
      const item = order.lineItems.find((li) => li.id === edit.lineItemId);
      if (!item) return undefined;
      return edit.field === "lineItemName" ? item.name : edit.field === "lineItemQty" ? item.qty : item.unitPrice;
    }
  }
}

/** Replaces the buffered value for the edit's field; drops it when it is back to the stored value. */
export function bufferEdit(
  stored: NormalizedOrder,
  pending: readonly OrderFieldEdit[],
  edit: OrderFieldEdit,
): OrderFieldEdit[] {
  const others = pending.filter((p) => editKey(p) !== editKey(edit));
  return storedValue(stored, edit) === edit.value ? others : [...others, edit];
}

function applyEdit(order: NormalizedOrder, edit: OrderFieldEdit): NormalizedOrder {
  switch (edit.field) {
    case "merchantName":
      return { ...order, merchant: { ...order.merchant, name: edit.value } };
    case "orderRef":
      return { ...order, orderRef: edit.value };
    case "placedAt":
      return { ...order, placedAt: edit.value };
    case "total":
      return { ...order, total: edit.value };
    case "lineItemName":
      return { ...order, lineItems: order.lineItems.map((li) => (li.id === edit.lineItemId ? { ...li, name: edit.value } : li)) };
    case "lineItemQty":
      return { ...order, lineItems: order.lineItems.map((li) => (li.id === edit.lineItemId ? { ...li, qty: edit.value } : li)) };
    case "lineItemUnitPrice":
      return {
        ...order,
        lineItems: order.lineItems.map((li) => (li.id === edit.lineItemId ? { ...li, unitPrice: edit.value } : li)),
      };
  }
}

/** The stored order with the unsent edits applied, for display only. */
export function applyEdits(order: NormalizedOrder, pending: readonly OrderFieldEdit[]): NormalizedOrder {
  return pending.reduce(applyEdit, order);
}

const FIELD_RULES: Record<OrderFieldEdit["field"], string> = {
  merchantName: "Merchant needs 1 to 200 characters.",
  orderRef: "Order reference needs 1 to 200 characters.",
  placedAt: "Placed on needs a valid date.",
  total: "Order total must be 0 or more, with at most two decimals.",
  lineItemName: "Each line item name needs 1 to 200 characters.",
  lineItemQty: "Quantity must be a whole number from 1 to 100000.",
  lineItemUnitPrice: "Unit price must be 0 or more, with at most two decimals.",
};

export type ConfirmReviewOutcome =
  /** Every edit was saved and the order confirmed. */
  | { status: "confirmed"; response: ReviewMutationResponse }
  /** An edit failed the review schema in the browser; nothing was sent. */
  | { status: "invalid_edit"; message: string }
  /** The order changed on the server (409) or has no revision: reload it; the unsent edits are stale. */
  | { status: "stale"; savedEdits: number; message: string }
  /** A call failed. The first `savedEdits` edits are saved on the server; the rest were not sent. */
  | { status: "failed"; savedEdits: number; message: string };

export interface ConfirmReviewSteps {
  edit: (orderId: string, revision: string, edit: ReviewEdit) => Promise<ReviewMutationResponse>;
  confirm: (orderId: string, revision: string) => Promise<ReviewMutationResponse>;
}

const STALE_MESSAGE = "This order changed since the page loaded.";
const UNREACHABLE_MESSAGE = "The app server could not be reached.";

function failure(caught: unknown, savedEdits: number): ConfirmReviewOutcome {
  if (caught instanceof ApiError) {
    return caught.status === 409
      ? { status: "stale", savedEdits, message: caught.message || STALE_MESSAGE }
      : { status: "failed", savedEdits, message: caught.message };
  }
  return { status: "failed", savedEdits, message: UNREACHABLE_MESSAGE };
}

/** Validates every buffered edit, saves them in order (chaining revisions), then confirms with the newest revision. */
export async function saveEditsThenConfirm(
  order: NormalizedOrder,
  pending: readonly OrderFieldEdit[],
  steps: ConfirmReviewSteps,
): Promise<ConfirmReviewOutcome> {
  const edits: ReviewEdit[] = [];
  for (const edit of pending) {
    const parsed = ReviewEditSchema.safeParse(edit);
    if (!parsed.success) return { status: "invalid_edit", message: FIELD_RULES[edit.field] };
    edits.push(parsed.data);
  }
  let revision = order.review?.revision;
  if (!revision) return { status: "stale", savedEdits: 0, message: STALE_MESSAGE };

  let savedEdits = 0;
  try {
    for (const edit of edits) {
      revision = (await steps.edit(order.id, revision, edit)).revision;
      savedEdits += 1;
    }
    return { status: "confirmed", response: await steps.confirm(order.id, revision) };
  } catch (caught: unknown) {
    return failure(caught, savedEdits);
  }
}

/**
 * Queue items the view cannot show as a card: no order behind them (classification / extraction failures) and not an
 * email of an order already in the queue. They are counted on the page instead of dropped (hard rule 5).
 */
export function itemsWithoutOrder(items: readonly ReviewQueueItem[], orders: readonly NormalizedOrder[]): ReviewQueueItem[] {
  const shownEmailIds = new Set(orders.flatMap((order) => order.messageIds));
  return items.filter((item) => !item.orderId && !shownEmailIds.has(item.emailId));
}
