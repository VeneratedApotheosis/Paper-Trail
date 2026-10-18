import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { users } from "@/db/schema/users";
import { audit } from "@/db/schema/audit";

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
    action TEXT NOT NULL, subject_id TEXT, meta_json TEXT);`);
  const db = drizzle(sqlite);
  return {
    close: () => sqlite.close(),
    find: (id: string) => db.select().from(users).where(eq(users.id, id)).get(),
    save(mailbox: string, tokenEnc: string) {
      // google_sub is an existing unique identity column. With gmail.readonly only,
      // use a namespaced mailbox hash, not an unverified OIDC subject.
      const identity = `gmail:${createHash("sha256").update(mailbox).digest("hex")}`;
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
    remove(id: string) {
      // Remove the identity as well as credentials so a later reconnect gets a new
      // user id and cannot resurrect a previously issued session cookie.
      db.transaction(tx => {
        tx.update(users).set({ tokenEnc: null }).where(eq(users.id, id)).run();
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
