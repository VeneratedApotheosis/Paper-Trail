import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { ReviewEditSchema, type ReviewEdit } from "./schema";
import { isAnonymousScope } from "@/lib/store/anonymous";

/**
 * Durable Review corrections (#124). One SQLite table in the same database file as the Gmail accounts and quality
 * labels (`DATABASE_URL`, default `./papertrail.sqlite`, gitignored), keyed by store scope (the signed-in profile id).
 * The table is created on the first write; reads and deletes never create the file (same pattern as quality/labels).
 * The anonymous scope (demo, uploads without a profile) never touches the file: it uses an in-memory database that
 * lives on globalThis, so it survives dev hot reloads but not a restart.
 * Only user-chosen values are stored: no raw email text, no extraction output.
 */

export type FindingOverrideStatus = "resolved" | "dismissed";

export type OverrideRecord =
  /** A field the user corrected on an order. The last edit per order and field wins. */
  | { kind: "edit"; orderId: string; edit: ReviewEdit; emailId?: string; at: string }
  /** The user confirmed the order's values (counted in owed even when extraction confidence is low). */
  | { kind: "confirm"; orderId: string; confirmedAt: string; emailId?: string; at: string }
  /** The user resolved or dismissed a finding. Keyed by the deterministic finding id. */
  | { kind: "finding"; findingId: string; status: FindingOverrideStatus; at: string };

export interface OverrideStore {
  /** Inserts or replaces one record. An edit also withdraws the order's confirmation (the user must confirm again). */
  put(scope: string, record: OverrideRecord): void;
  removeFinding(scope: string, findingId: string): void;
  /** Oldest first. Rows that fail validation are skipped, never thrown. */
  list(scope: string): OverrideRecord[];
  /** Deletes every record of the scope; returns how many rows went. */
  deleteScope(scope: string): number;
  close(): void;
}

interface Row { kind: string; target: string; field: string; value_json: string; email_id: string | null; at: string }

export const ANONYMOUS_SCOPE = "anonymous";

/** Row key of an edit: the field, plus the line item for line-item fields. */
export function editFieldKey(edit: ReviewEdit): string {
  return "lineItemId" in edit ? `${edit.field}:${edit.lineItemId}` : edit.field;
}

export function createOverrideStore(filename: string): OverrideStore {
  const sqlite = new Database(filename);
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS review_override (
    scope TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, field TEXT NOT NULL, value_json TEXT NOT NULL,
    email_id TEXT, at TEXT NOT NULL, PRIMARY KEY (scope, kind, target, field))`);
  const upsert = sqlite.prepare(`INSERT OR REPLACE INTO review_override (scope, kind, target, field, value_json, email_id, at)
    VALUES (@scope, @kind, @target, @field, @value_json, @email_id, @at)`);
  const withdrawConfirm = sqlite.prepare("DELETE FROM review_override WHERE scope = ? AND kind = 'confirm' AND target = ?");
  const withdrawFinding = sqlite.prepare("DELETE FROM review_override WHERE scope = ? AND kind = 'finding' AND target = ?");
  const all = sqlite.prepare("SELECT kind, target, field, value_json, email_id, at FROM review_override WHERE scope = ? ORDER BY at, rowid");
  const remove = sqlite.prepare("DELETE FROM review_override WHERE scope = ?");

  function toRecord(row: Row): OverrideRecord | undefined {
    try {
      const value: unknown = JSON.parse(row.value_json);
      const emailId = row.email_id ? { emailId: row.email_id } : {};
      if (row.kind === "edit") {
        const edit = ReviewEditSchema.safeParse(value);
        return edit.success ? { kind: "edit", orderId: row.target, edit: edit.data, ...emailId, at: row.at } : undefined;
      }
      if (row.kind === "confirm" && typeof value === "string") {
        return { kind: "confirm", orderId: row.target, confirmedAt: value, ...emailId, at: row.at };
      }
      if (row.kind === "finding" && (value === "resolved" || value === "dismissed")) {
        return { kind: "finding", findingId: row.target, status: value, at: row.at };
      }
    } catch { /* corrupt row: skipped */ }
    return undefined;
  }

  const put = sqlite.transaction((scope: string, record: OverrideRecord) => {
    if (record.kind === "edit") {
      withdrawConfirm.run(scope, record.orderId);
      upsert.run({ scope, kind: "edit", target: record.orderId, field: editFieldKey(record.edit),
        value_json: JSON.stringify(record.edit), email_id: record.emailId ?? null, at: record.at });
    } else if (record.kind === "confirm") {
      upsert.run({ scope, kind: "confirm", target: record.orderId, field: "", value_json: JSON.stringify(record.confirmedAt),
        email_id: record.emailId ?? null, at: record.at });
    } else {
      upsert.run({ scope, kind: "finding", target: record.findingId, field: "", value_json: JSON.stringify(record.status),
        email_id: null, at: record.at });
    }
  });

  return {
    put: (scope, record) => put(scope, record),
    removeFinding: (scope, findingId) => { withdrawFinding.run(scope, findingId); },
    list: (scope) => (all.all(scope) as Row[]).map(toRecord).filter((record): record is OverrideRecord => record !== undefined),
    deleteScope: (scope) => remove.run(scope).changes,
    close: () => sqlite.close(),
  };
}

const defaultFilename = () => process.env.DATABASE_URL ?? "./papertrail.sqlite";
const MEMORY_KEY = Symbol.for("papertrail.review.anonymousOverrides");
const memoryHolder = globalThis as typeof globalThis & { [MEMORY_KEY]?: OverrideStore };
let opened: { filename: string; store: OverrideStore } | undefined;

/** Closes every open override store, so the next use reopens the file (tests simulate a restart with this). */
export function resetOverrideStores(): void {
  opened?.store.close();
  opened = undefined;
  memoryHolder[MEMORY_KEY]?.close();
  memoryHolder[MEMORY_KEY] = undefined;
}

function fileStore(create: boolean): OverrideStore | undefined {
  const filename = defaultFilename();
  if (opened && opened.filename !== filename) { opened.store.close(); opened = undefined; }
  if (opened) return opened.store;
  if (!create && (filename === ":memory:" || !existsSync(filename))) return undefined;
  opened = { filename, store: createOverrideStore(filename) };
  return opened.store;
}

function storeFor(scope: string, create: boolean): OverrideStore | undefined {
  if (isAnonymousScope(scope)) return create ? (memoryHolder[MEMORY_KEY] ??= createOverrideStore(":memory:")) : memoryHolder[MEMORY_KEY];
  return fileStore(create);
}

/** Saves one record. Returns false (never throws) when the database could not be written. */
export function recordOverride(scope: string, record: OverrideRecord): boolean {
  try {
    storeFor(scope, true)?.put(scope, record);
    return true;
  } catch {
    return false;
  }
}

export function removeFindingOverride(scope: string, findingId: string): void {
  try { storeFor(scope, false)?.removeFinding(scope, findingId); } catch { /* best effort: the in-memory status already changed */ }
}

/** The scope's records; empty while nothing was ever written (a read never creates the database file). */
export function listOverrides(scope: string): OverrideRecord[] {
  try {
    return storeFor(scope, false)?.list(scope) ?? [];
  } catch {
    return [];
  }
}

/** Delete-all: removes the scope's records. Returns the number deleted. */
export function deleteScopeOverrides(scope: string): number {
  try {
    return storeFor(scope, false)?.deleteScope(scope) ?? 0;
  } catch {
    return 0;
  }
}
