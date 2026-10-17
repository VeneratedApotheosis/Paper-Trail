import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { cards, users } from "./users";

// Money columns are stored as real in the order's currency (deepdive_S14 §3).

export const messages = sqliteTable("message", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  gmailId: text("gmail_id").notNull().unique(),
  threadId: text("thread_id"),
  receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
  fromDomain: text("from_domain"),
  textHash: text("text_hash"),
  class: text("class"),
  classConf: real("class_conf"),
  extractJson: text("extract_json"),
  // Evidence snippets only (<=200 chars each); raw bodies are never stored.
  evidenceSnips: text("evidence_snips"),
  processedAt: integer("processed_at", { mode: "timestamp" }),
});

export const merchants = sqliteTable("merchant", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domainsJson: text("domains_json"),
  category: text("category"),
  returnWindowDays: integer("return_window_days"),
  windowAnchor: text("window_anchor", { enum: ["order", "delivery"] }),
  refundSlaDays: integer("refund_sla_days"),
  priceAdjustDays: integer("price_adjust_days"),
  policySource: text("policy_source", { enum: ["email_text", "default_table", "user"] }),
  policyQuote: text("policy_quote"),
});

export const orders = sqliteTable("order", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  orderRef: text("order_ref"),
  placedAt: integer("placed_at", { mode: "timestamp" }),
  currency: text("currency").notNull().default("USD"),
  subtotal: real("subtotal"),
  tax: real("tax"),
  shipping: real("shipping"),
  discount: real("discount"),
  total: real("total"),
  cardId: text("card_id").references(() => cards.id),
  last4: text("last4"),
  status: text("status"),
  confMin: real("conf_min"),
});

export const lineItems = sqliteTable("line_item", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  sku: text("sku"),
  name: text("name").notNull(),
  qty: integer("qty").notNull().default(1),
  unitPrice: real("unit_price").notNull(),
  returnedQty: integer("returned_qty").notNull().default(0),
});

export const events = sqliteTable("event", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  type: text("type", {
    enum: [
      "shipped",
      "delivered",
      "return_started",
      "return_dropped",
      "return_received",
      "refund_issued",
      "store_credit",
      "price_adjust",
      "cancel",
    ],
  }).notNull(),
  at: integer("at", { mode: "timestamp" }).notNull(),
  amount: real("amount"),
  messageId: text("message_id").references(() => messages.id),
  conf: real("conf"),
});

export const priceObservations = sqliteTable("price_obs", {
  id: text("id").primaryKey(),
  lineItemId: text("line_item_id")
    .notNull()
    .references(() => lineItems.id),
  price: real("price").notNull(),
  source: text("source", { enum: ["mock", "json_ld", "api", "email_promo", "user"] }).notNull(),
  observedAt: integer("observed_at", { mode: "timestamp" }).notNull(),
});
