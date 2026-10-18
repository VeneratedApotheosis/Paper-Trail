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
  return <span className="eyebrow">{children}</span>;
}

// Read-only well: a soft pressed field that mirrors the editable input.
function ReadWell({ children }: { children: ReactNode }) {
  return (
    <div className="neu-inset rounded-sm px-3 py-2 text-sm text-ink">{children}</div>
  );
}

const inputClass = "neu-inset w-full rounded-sm px-3 py-2 text-sm text-ink";

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
  onConfirm, pending = false, saveState,
}: {
  order: NormalizedOrder;
  pending?: boolean;
  saveState?: "unsaved" | "saving" | "saved";
  onEdit: (orderId: string, edit: OrderFieldEdit) => void;
  onConfirm: (orderId: string) => void;
}) {
  // View state: read-only by default, Edit unlocks the input wells.
  const [isEditing, setIsEditing] = useState(false);
  // Whether the user has touched any field, so we can show unsaved changes.
  const [edited, setEdited] = useState(false);

  function handleEdit(edit: OrderFieldEdit) {
    setEdited(true);
    onEdit(order.id, edit);
  }

  return (
    <article className="neu-raised rounded-xl bg-paper p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-ink">{merchantName(order)}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Order {order.orderRef ?? "not found"}
          </p>
        </div>
        <Chip tone="review">
          Needs a quick check
          <ConfidenceTip confidence={order.confMin} align="end" />
        </Chip>
      </header>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
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

        <label className="flex flex-col gap-1.5">
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

        <label className="flex flex-col gap-1.5">
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

        <label className="flex flex-col gap-1.5">
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
              <span className="tabular-nums">
                {formatMoney(order.total, order.currency)}
              </span>
            </ReadWell>
          )}
        </label>

        <div className="md:col-span-2">
          <FieldLabel>Line items</FieldLabel>
          <ul className="mt-2 flex flex-col gap-2">
            {order.lineItems.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2"
              >
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
                      className={`${inputClass} w-16 tabular-nums`}
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
                      className={`${inputClass} w-24 tabular-nums`}
                      value={item.unitPrice}
                      onChange={(e) => {
                        const value = parseNumericInput(e.target.value);
                        if (value !== null)
                          handleEdit({ field: "lineItemUnitPrice", lineItemId: item.id, value });
                      }}
                    />
                  </>
                ) : (
                  <ReadWell>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1">{item.name}</span>
                      <span className="tabular-nums text-ink-muted">Qty {item.qty}</span>
                      <span className="tabular-nums">
                        {formatMoney(item.unitPrice, order.currency)}
                      </span>
                    </span>
                  </ReadWell>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 neu-inset rounded-lg p-4">
        <FieldLabel>Why it needs a quick check</FieldLabel>
        <p className="mt-2 text-sm text-ink-muted">
          We&apos;re not sure we read this order correctly. It comes from{" "}
          {order.messageIds.length} email
          {order.messageIds.length === 1 ? "" : "s"} from{" "}
          <span className="text-ink">{order.merchant.domain ?? "an unknown sender"}</span>.
          Check the values, fix anything wrong, then confirm.
        </p>
      </div>

      <p className="mt-5 text-sm text-ink-muted">
        After you confirm, we check this order for late refunds, return deadlines and price
        drops and add anything we find to what you&apos;re owed.
      </p>

      <footer className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={() => onConfirm(order.id)}>Confirm</Button>
        <Button disabled={pending} variant="secondary" onClick={() => setIsEditing((v) => !v)}>
          {isEditing ? "Done" : "Edit"}
        </Button>
        <span className="text-sm text-ink-faint">
          {saveState === "saving" ? "Saving changes…" : saveState === "saved" ? "Changes saved to the audit trail" : edited || saveState === "unsaved" ? "Unsaved changes. Confirm to save and check this purchase." : "Not counted in what you're owed until you confirm"}
        </span>
      </footer>
    </article>
  );
}
