import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, asc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { linkedAccounts, users } from "@/db/schema/users";
import { audit } from "@/db/schema/audit";

/** Namespaced mailbox hash: the stored identity of a mailbox without keeping the address in a column. */
const mailboxIdentityHash = (mailbox: string) => `gmail:${createHash("sha256").update(mailbox).digest("hex")}`;

/**
 * Gmail accounts of one profile (#114). The profile's own mailbox lives in the `user` row and is the account whose id
 * is the user id (always first); further mailboxes are `linked_account` rows. Credentials stay sealed in `tokenEnc`.
 */
export interface StoredAccount {
  id: string;
  tokenEnc: string | null;
}

export function createAuthStore(filename = process.env.DATABASE_URL ?? "./papertrail.sqlite") {
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  // Bootstrap only the existing schema tables OAuth needs; no schema changes.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY NOT NULL, google_sub TEXT NOT NULL UNIQUE,
    token_enc TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
    id TEXT PRIMARY KEY NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL,
    action TEXT NOT NULL, subject_id TEXT, meta_json TEXT);
    CREATE TABLE IF NOT EXISTS linked_account (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    identity TEXT NOT NULL, token_enc TEXT, created_at INTEGER NOT NULL,
    UNIQUE (user_id, identity));`);
  const db = drizzle(sqlite);
  function accounts(userId: string): StoredAccount[] {
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return [];
    // rowid keeps link order for accounts linked within the same second.
    const linked = db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, userId))
      .orderBy(asc(linkedAccounts.createdAt), sql`rowid`).all();
    return [{ id: user.id, tokenEnc: user.tokenEnc }, ...linked.map(row => ({ id: row.id, tokenEnc: row.tokenEnc }))];
  }
  return {
    close: () => sqlite.close(),
    find: (id: string) => db.select().from(users).where(eq(users.id, id)).get(),
    save(mailbox: string, tokenEnc: string) {
      // google_sub is an existing unique identity column. With gmail.readonly only,
      // use a namespaced mailbox hash, not an unverified OIDC subject.
      const identity = mailboxIdentityHash(mailbox);
      return db.transaction(tx => {
        const existing = tx.select().from(users).where(eq(users.googleSub, identity)).get();
        const id = existing?.id ?? randomUUID();
        tx.insert(users).values({ id, googleSub: identity, tokenEnc, createdAt: new Date() })
          .onConflictDoUpdate({ target: users.googleSub, set: { tokenEnc } }).run();
        return id;
      });
    },
    update(id: string, tokenEnc: string | null) {
      db.update(users).set({ tokenEnc }).where(eq(users.id, id)).run();
    },
    /** Every Gmail account of the profile, the profile's own mailbox first, then linked ones in link order. Empty for an unknown user. */
    accounts,
    findAccount: (userId: string, accountId: string): StoredAccount | undefined =>
      accounts(userId).find(account => account.id === accountId),
    /** Replaces (or with null clears) one account's sealed credentials. Unknown account ids are ignored. */
    updateAccount(userId: string, accountId: string, tokenEnc: string | null) {
      if (accountId === userId) { db.update(users).set({ tokenEnc }).where(eq(users.id, userId)).run(); return; }
      db.update(linkedAccounts).set({ tokenEnc })
        .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.id, accountId))).run();
    },
    /**
     * Links a mailbox to an existing profile and returns its account id. Linking the profile's own mailbox, or one
     * already linked (even after it was disconnected), updates that account's credentials instead of adding a copy.
     */
    link(userId: string, mailbox: string, tokenEnc: string): string {
      const identity = mailboxIdentityHash(mailbox);
      return db.transaction(tx => {
        const user = tx.select().from(users).where(eq(users.id, userId)).get();
        if (!user) throw new Error("Unknown profile");
        if (user.googleSub === identity) {
          tx.update(users).set({ tokenEnc }).where(eq(users.id, userId)).run();
          return userId;
        }
        const existing = tx.select().from(linkedAccounts)
          .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.identity, identity))).get();
        if (existing) {
          tx.update(linkedAccounts).set({ tokenEnc }).where(eq(linkedAccounts.id, existing.id)).run();
          return existing.id;
        }
        const id = randomUUID();
        tx.insert(linkedAccounts).values({ id, userId, identity, tokenEnc, createdAt: new Date() }).run();
        return id;
      });
    },
    remove(id: string) {
      // Remove the identity as well as credentials so a later reconnect gets a new
      // user id and cannot resurrect a previously issued session cookie.
      db.transaction(tx => {
        tx.update(users).set({ tokenEnc: null }).where(eq(users.id, id)).run();
        tx.delete(linkedAccounts).where(eq(linkedAccounts.userId, id)).run();
        tx.delete(audit).where(eq(audit.subjectId, id)).run();
        tx.delete(users).where(eq(users.id, id)).run();
        // Retain proof of deletion without retaining a link to the deleted
        // identity. The tombstone and purge commit atomically in SQLite.
        tx.insert(audit).values({ id: randomUUID(), at: new Date(), actor: "system",
          action: "oauth.deleted", subjectId: null, metaJson: "{}" }).run();
      });
    },
    audit(action: string, subjectId: string | null, meta: Record<string, unknown> = {}) {
      db.insert(audit).values({ id: randomUUID(), at: new Date(), actor: "system",
        action, subjectId, metaJson: JSON.stringify(meta) }).run();
    },
  };
}
export type AuthStore = ReturnType<typeof createAuthStore>;
let store: AuthStore | undefined;
export const authStore = () => store ??= createAuthStore();
