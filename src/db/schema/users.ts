import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  tokenEnc: text("token_enc"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Extra Gmail mailboxes linked to a profile (#114). The profile's first mailbox stays on `user.token_enc` and is
// exposed as the linked account whose id is the user id; mailbox addresses live only inside the sealed token blob.
export const linkedAccounts = sqliteTable(
  "linked_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Namespaced mailbox hash (same scheme as `user.google_sub`), so linking a mailbox again finds its row. */
    identity: text("identity").notNull(),
    tokenEnc: text("token_enc"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [unique("linked_account_user_identity").on(table.userId, table.identity)],
);

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
