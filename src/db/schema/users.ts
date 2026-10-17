import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  tokenEnc: text("token_enc"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// User-entered or preset cards; reward rules are illustrative, not real issuer data.
export const cards = sqliteTable("card", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  label: text("label").notNull(),
  network: text("network"),
  last4: text("last4"),
  rewardRulesJson: text("reward_rules_json"),
});
