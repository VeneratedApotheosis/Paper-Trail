"use client";

import { useState, type ReactNode } from "react";
import type { NormalizedOrder } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import {
  CONFIDENCE_THRESHOLD,
  confidencePercent,
  formatDate,
  formatMoney,
} from "@/lib/format";
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

// A needs-review item: parsed fields and the context that flagged it. Fields are
// read-only wells by default; Edit switches them to editable input wells so the
// user can correct the extractor before confirming (Scope screen 7).
export function ReviewCard({
  order,
  onEdit,
  onConfirm,
}: {
  order: NormalizedOrder;
  onEdit: (orderId: string, edit: OrderFieldEdit) => void;
  onConfirm: (orderId: string) => void;
}) {
  // View state: read-only by default, Edit unlocks the input wells.
  const [isEditing, setIsEditing] = useState(false);
  // Whether the user has touched any field, so we can surface the stubbed audit note.
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
        <Chip tone="review">{confidencePercent(order.confMin)} sure</Chip>
      </header>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Merchant</FieldLabel>
          {isEditing ? (
            <input
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
              type="number"
              step="0.01"
              className={`${inputClass} tabular-nums`}
              value={order.total}
              onChange={(e) => handleEdit({ field: "total", value: Number(e.target.value) })}
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
                      aria-label="Quantity"
                      type="number"
                      min="1"
                      className={`${inputClass} w-16 tabular-nums`}
                      value={item.qty}
                      onChange={(e) =>
                        handleEdit({
                          field: "lineItemQty",
                          lineItemId: item.id,
                          value: Number(e.target.value),
                        })
                      }
                    />
                    <input
                      aria-label="Unit price"
                      type="number"
                      step="0.01"
                      className={`${inputClass} w-24 tabular-nums`}
                      value={item.unitPrice}
                      onChange={(e) =>
                        handleEdit({
                          field: "lineItemUnitPrice",
                          lineItemId: item.id,
                          value: Number(e.target.value),
                        })
                      }
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
        <FieldLabel>Why it needs review</FieldLabel>
        <p className="mt-2 text-sm text-ink-muted">
          Parsed at{" "}
          <span className="font-semibold text-teal-deep">
            {confidencePercent(order.confMin)}
          </span>{" "}
          confidence, below the {confidencePercent(CONFIDENCE_THRESHOLD)} bar. Drawn
          from {order.messageIds.length} email
          {order.messageIds.length === 1 ? "" : "s"} via{" "}
          <span className="text-ink">{order.merchant.domain ?? "an unknown sender"}</span>.
          Check the parsed values, fix anything wrong, then confirm.
        </p>
      </div>

      <footer className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={() => onConfirm(order.id)}>Confirm</Button>
        <Button variant="secondary" onClick={() => setIsEditing((v) => !v)}>
          {isEditing ? "Done" : "Edit"}
        </Button>
        <span className="text-sm text-ink-faint">
          {edited ? "Edit logged to audit (stubbed)" : "Held out of totals until confirmed"}
        </span>
      </footer>
    </article>
  );
}
