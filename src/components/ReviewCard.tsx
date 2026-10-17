"use client";

import { useState, type ReactNode } from "react";
import type { NormalizedOrder } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CONFIDENCE_THRESHOLD, confidencePercent, formatMoney } from "@/lib/format";
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

function fieldLabel(children: ReactNode) {
  return <span className="col-head">{children}</span>;
}

const inputClass =
  "rounded-sm border border-rule bg-paper px-2 py-1.5 text-sm text-ink";

// A needs-review item: parsed fields (editable, left) shown side by side with the
// confidence / source context that flagged it (right). Scope screen 7 — the user
// checks the parsed value against where it came from before confirming.
export function ReviewCard({
  order,
  onEdit,
  onConfirm,
}: {
  order: NormalizedOrder;
  onEdit: (orderId: string, edit: OrderFieldEdit) => void;
  onConfirm: (orderId: string) => void;
}) {
  // Whether the user has touched any field, so we can surface the stubbed audit note.
  const [edited, setEdited] = useState(false);

  function handleEdit(edit: OrderFieldEdit) {
    setEdited(true);
    onEdit(order.id, edit);
  }

  return (
    <article className="rounded-lg border border-rule bg-paper-raised p-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule pb-4">
        <div>
          <h2 className="font-serif text-2xl text-ink">{merchantName(order)}</h2>
          <p className="mt-1 text-sm text-ink-muted">Order {order.orderRef ?? "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="review">Needs review</Chip>
          <Chip tone="review">{confidencePercent(order.confMin)} confidence</Chip>
        </div>
      </header>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {/* LEFT: the parsed/extracted fields, editable in place. */}
        <section>
          <h3 className="col-head mb-3">Parsed from email (editable)</h3>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              {fieldLabel("Merchant")}
              <input
                className={inputClass}
                value={order.merchant.name}
                onChange={(e) => handleEdit({ field: "merchantName", value: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              {fieldLabel("Order reference")}
              <input
                className={inputClass}
                value={order.orderRef ?? ""}
                onChange={(e) => handleEdit({ field: "orderRef", value: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              {fieldLabel("Placed on")}
              <input
                type="date"
                className={inputClass}
                value={order.placedAt.slice(0, 10)}
                onChange={(e) =>
                  handleEdit({ field: "placedAt", value: `${e.target.value}T12:00:00.000Z` })
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              {fieldLabel(`Order total (${order.currency})`)}
              <input
                type="number"
                step="0.01"
                className={`${inputClass} tabular-nums`}
                value={order.total}
                onChange={(e) =>
                  handleEdit({ field: "total", value: Number(e.target.value) })
                }
              />
            </label>

            <div className="mt-1">
              {fieldLabel("Line items")}
              <ul className="mt-2 flex flex-col gap-2">
                {order.lineItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 rounded-sm bg-paper-sunk p-2"
                  >
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
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* RIGHT: why it was flagged — low confidence + source context. */}
        <section className="rounded-md border border-rule bg-paper-sunk/60 p-4">
          <h3 className="col-head mb-3">Why this needs review</h3>
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-ink-muted">Lowest field confidence</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-deadline">
                {confidencePercent(order.confMin)} — below the{" "}
                {confidencePercent(CONFIDENCE_THRESHOLD)} threshold
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Source domain</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {order.merchant.domain ?? "Unknown sender"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Source messages</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-ink">
                {order.messageIds.length} email
                {order.messageIds.length === 1 ? "" : "s"} contributed
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Current parsed total</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-ink">
                {formatMoney(order.total, order.currency)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-ink-muted">
            Check each parsed value on the left against the original receipt. Correct
            anything the extractor got wrong, then confirm.
          </p>
        </section>
      </div>

      <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        <Button onClick={() => onConfirm(order.id)}>Confirm &amp; include in totals</Button>
        {edited ? (
          <span className="text-sm text-ink-faint">Edit logged to audit (stubbed)</span>
        ) : (
          <span className="text-sm text-ink-faint">
            Excluded from &ldquo;owed&rdquo; totals until confirmed.
          </span>
        )}
      </footer>
    </article>
  );
}
