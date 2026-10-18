"use client";

import { useState, type ReactNode } from "react";
import type { NormalizedOrder } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ConfidenceTip } from "@/components/ConfidenceChip";
import { formatDate, formatMoney } from "@/lib/format";
import { merchantName } from "@/lib/view";

// One editable field change bubbled up to the page (which owns the queue state).
// In production each of these would POST to an edit endpoint and write an audit
// row; see INTERFACE notes in src/app/review/page.tsx.
export type OrderFieldEdit =
  | { field: "merchantName"; value: string }
  | { field: "orderRef"; value: string }
  | { field: "total"; value: number }
  | { field: "placedAt"; value: string }
  | { field: "lineItemName"; lineItemId: string; value: string }
  | { field: "lineItemQty"; lineItemId: string; value: number }
  | { field: "lineItemUnitPrice"; lineItemId: string; value: number };

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[0.75rem] leading-4 text-ink-muted">{children}</span>;
}

// Read-only well: a soft pressed field that mirrors the editable input. 44px tall so it lines up with the inputs.
function ReadWell({ children }: { children: ReactNode }) {
  return (
    <div className="neu-inset flex min-h-[44px] items-center rounded-md px-4 py-2.5 text-sm text-ink">{children}</div>
  );
}

const inputClass = "neu-inset min-h-[44px] w-full rounded-md px-4 py-2 text-sm text-ink";
// Parse a numeric <input> value, ignoring a transient empty/invalid field. While
// editing, clearing the field yields "" (Number("") === 0), which would snap the
// value to 0 mid-edit; returning null lets callers skip the edit until a real
// number is typed (the controlled input keeps showing the last valid value).
function parseNumericInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

// A needs-review item: parsed fields and the context that flagged it. Fields are
// read-only wells by default; Edit switches them to editable input wells so the
// user can correct the extractor before confirming (Scope screen 7).
export function ReviewCard({
  order,
  onEdit,
  onConfirm, pending = false, saveState, onNotPurchase,
}: {
  order: NormalizedOrder;
  pending?: boolean;
  saveState?: "unsaved" | "saving" | "saved";
  onEdit: (orderId: string, edit: OrderFieldEdit) => void;
  onConfirm: (orderId: string) => void;
  // "Not a purchase" (#134): the action is hidden when omitted; the card asks to confirm before calling it.
  onNotPurchase?: (orderId: string) => void;
}) {
  const [confirmingNotPurchase, setConfirmingNotPurchase] = useState(false);
  // View state: read-only by default, Edit unlocks the input wells.
  const [isEditing, setIsEditing] = useState(false);
  // Whether the user has touched any field, so we can show unsaved changes.
  const [edited, setEdited] = useState(false);

  function handleEdit(edit: OrderFieldEdit) {
    setEdited(true);
    onEdit(order.id, edit);
  }

  const status =
    saveState === "saving"
      ? "Saving changes…"
      : saveState === "saved"
        ? "Changes saved to the audit trail"
        : edited || saveState === "unsaved"
          ? "Unsaved changes. Confirm to save and check this purchase."
          : "Not counted in what you're owed until you confirm";

  return (
    <article className="neu-raised flex flex-col gap-4 rounded-lg p-5 xl:p-6">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-serif text-xl text-ink">{merchantName(order)}</h2>
          <p className="mt-0.5 text-[0.75rem] leading-4 text-ink-muted">
            Order {order.orderRef ?? "not found"}
          </p>
        </div>
        <Chip tone="review">
          Needs a quick check
          <ConfidenceTip confidence={order.confMin} align="end" />
        </Chip>
      </header>

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:items-start xl:gap-5">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <FieldLabel>Merchant</FieldLabel>
            {isEditing ? (
              <input
                disabled={pending}
                className={inputClass}
                value={order.merchant.name}
                onChange={(e) => handleEdit({ field: "merchantName", value: e.target.value })}
              />
            ) : (
              <ReadWell>{order.merchant.name}</ReadWell>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel>Order reference</FieldLabel>
            {isEditing ? (
              <input
                disabled={pending}
                className={inputClass}
                value={order.orderRef ?? ""}
                onChange={(e) => handleEdit({ field: "orderRef", value: e.target.value })}
              />
            ) : (
              <ReadWell>{order.orderRef ?? "Not found"}</ReadWell>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel>Placed on</FieldLabel>
            {isEditing ? (
              <input
                disabled={pending}
                type="date"
                className={inputClass}
                value={order.placedAt.slice(0, 10)}
                onChange={(e) =>
                  handleEdit({ field: "placedAt", value: `${e.target.value}T12:00:00.000Z` })
                }
              />
            ) : (
              <ReadWell>{formatDate(order.placedAt)}</ReadWell>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel>Order total ({order.currency})</FieldLabel>
            {isEditing ? (
              <input
                disabled={pending}
                type="number"
                step="0.01"
                className={`${inputClass} tabular-nums`}
                value={order.total}
                onChange={(e) => {
                  const value = parseNumericInput(e.target.value);
                  if (value !== null) handleEdit({ field: "total", value });
                }}
              />
            ) : (
              <ReadWell>
                <span className="tabular-nums">{formatMoney(order.total, order.currency)}</span>
              </ReadWell>
            )}
          </label>

          <div className="sm:col-span-2">
            <FieldLabel>Line items</FieldLabel>
            <ul className="mt-1 flex flex-col gap-2.5">
              {order.lineItems.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  {isEditing ? (
                    <>
                      <input
                        disabled={pending}
                        aria-label="Line item name"
                        className={`${inputClass} min-w-0 flex-1`}
                        value={item.name}
                        onChange={(e) =>
                          handleEdit({
                            field: "lineItemName",
                            lineItemId: item.id,
                            value: e.target.value,
                          })
                        }
                      />
                      <input
                        disabled={pending}
                        aria-label="Quantity"
                        type="number"
                        min="1"
                        className={`${inputClass} !w-16 tabular-nums`}
                        value={item.qty}
                        onChange={(e) => {
                          const value = parseNumericInput(e.target.value);
                          if (value !== null)
                            handleEdit({ field: "lineItemQty", lineItemId: item.id, value });
                        }}
                      />
                      <input
                        disabled={pending}
                        aria-label="Unit price"
                        type="number"
                        step="0.01"
                        className={`${inputClass} !w-24 tabular-nums`}
                        value={item.unitPrice}
                        onChange={(e) => {
                          const value = parseNumericInput(e.target.value);
                          if (value !== null)
                            handleEdit({ field: "lineItemUnitPrice", lineItemId: item.id, value });
                        }}
                      />
                    </>
                  ) : (
                    <div className="w-full">
                      <ReadWell>
                        <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-0 flex-1">{item.name}</span>
                          <span className="tabular-nums text-ink-muted">Qty {item.qty}</span>
                          <span className="tabular-nums">{formatMoney(item.unitPrice, order.currency)}</span>
                        </span>
                      </ReadWell>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel>Why it needs a quick check</FieldLabel>
          <div className="neu-inset rounded-md p-4">
            <p className="text-[0.8125rem] leading-5 text-ink-muted">
              We&apos;re not sure we read this order correctly. It comes from {order.messageIds.length} email
              {order.messageIds.length === 1 ? "" : "s"} from{" "}
              <span className="text-ink">{order.merchant.domain ?? "an unknown sender"}</span>. Check the
              values, fix anything wrong, then confirm.
            </p>
          </div>
        </div>
      </div>

      <p className="text-[0.8125rem] leading-5 text-ink-muted">
        After you confirm, we check this order for late refunds, return deadlines and price drops and add
        anything we find to what you&apos;re owed.
      </p>

      <footer className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Button className="!rounded-full !px-6" disabled={pending} onClick={() => onConfirm(order.id)}>
          Confirm order
        </Button>
        <Button className="!rounded-full" disabled={pending} variant="secondary" onClick={() => setIsEditing((v) => !v)}>
          {isEditing ? "Done" : "Edit"}
        </Button>
        {onNotPurchase && !confirmingNotPurchase ? (
          <Button className="!rounded-full" disabled={pending} variant="ghost" onClick={() => setConfirmingNotPurchase(true)}>
            Not a purchase
          </Button>
        ) : null}
        <span role="status" className="text-[0.75rem] leading-4 text-ink-muted sm:ml-auto sm:text-right">
          {status}
        </span>
      </footer>

      {onNotPurchase && confirmingNotPurchase ? (
        <div role="group" aria-label="Confirm not a purchase" className="neu-inset rounded-md px-5 py-4">
          <p className="text-sm text-ink">
            Mark this as not a purchase? It leaves your purchases, and future syncs skip its{" "}
            {order.messageIds.length === 1 ? "email" : `${order.messageIds.length} emails`}. You can undo this right after.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Button
              className="!rounded-full"
              disabled={pending}
              onClick={() => {
                setConfirmingNotPurchase(false);
                onNotPurchase(order.id);
              }}
            >
              Yes, not a purchase
            </Button>
            <Button className="!rounded-full" variant="secondary" disabled={pending} onClick={() => setConfirmingNotPurchase(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
