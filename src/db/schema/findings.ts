import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { orders } from "./orders";

export const findings = sqliteTable("finding", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  kind: text("kind", {
    enum: ["refund_overdue", "refund_short", "return_deadline", "price_drop", "rewards_gap"],
  }).notNull(),
  amountAtStake: real("amount_at_stake"),
  dueAt: integer("due_at", { mode: "timestamp" }),
  severity: text("severity"),
  status: text("status", { enum: ["open", "drafted", "resolved", "dismissed"] })
    .notNull()
    .default("open"),
  ruleVersion: text("rule_version").notNull(),
  explainJson: text("explain_json"),
});

// Drafts are copy-to-clipboard / mailto only; the app never sends email.
export const drafts = sqliteTable("draft", {
  id: text("id").primaryKey(),
  findingId: text("finding_id")
    .notNull()
    .references(() => findings.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  approvedAt: integer("approved_at", { mode: "timestamp" }),
});
