import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { messages } from "./orders";

// Every Gmail fetch, LLM call, approval, and delete writes a row here.
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(),
  at: integer("at", { mode: "timestamp" }).notNull(),
  actor: text("actor", { enum: ["user", "system", "llm"] }).notNull(),
  action: text("action").notNull(),
  subjectId: text("subject_id"),
  metaJson: text("meta_json"),
});

export const goldLabels = sqliteTable("gold_label", {
  messageId: text("message_id")
    .primaryKey()
    .references(() => messages.id),
  fieldsJson: text("fields_json").notNull(),
});

export const evalRuns = sqliteTable("eval_run", {
  id: text("id").primaryKey(),
  at: integer("at", { mode: "timestamp" }).notNull(),
  model: text("model").notNull(),
  metricsJson: text("metrics_json").notNull(),
});
