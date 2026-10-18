import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { ExtractedFieldsSchema, EmailClassSchema, type EmailClass } from "@/lib/contracts";
import type { LabelSource, QualityLabel } from "./types";

/**
 * Local label store (#117): human corrections kept as labeled examples (redacted text + class + corrected fields).
 * One SQLite table in the same database file as the Gmail accounts (`DATABASE_URL`, default `./papertrail.sqlite`,
 * gitignored), keyed by store scope (signed-in profile id, or "anonymous"). Raw email bodies are never written here;
 * delete-all removes the scope's rows.
 */

export interface LabelStore {
  /** Inserts or replaces the label of one email (the latest correction wins). */
  upsert(scope: string, label: QualityLabel): void;
  get(scope: string, emailId: string): QualityLabel | undefined;
  /** Newest first. */
  list(scope: string): QualityLabel[];
  /** Class the user set by hand per email, from "feedback" labels (these override the classifier on the next sync). */
  classOverrides(scope: string): Map<string, EmailClass>;
  /** Deletes the labels of the given emails (Undo of "Not a purchase"); returns how many rows went. */
  remove(scope: string, emailIds: readonly string[]): number;
  /** Deletes every label of the scope; returns how many rows went. */
  deleteScope(scope: string): number;
  close(): void;
}

interface Row {
  email_id: string; account_id: string | null; source: string; class: string; fields_json: string | null;
  redacted_text: string; text_hash: string; subject: string; from_header: string; date: string; at: string;
}

export function createLabelStore(filename: string): LabelStore {
  const sqlite = new Database(filename);
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS quality_label (
    scope TEXT NOT NULL, email_id TEXT NOT NULL, account_id TEXT, source TEXT NOT NULL, class TEXT NOT NULL,
    fields_json TEXT, redacted_text TEXT NOT NULL, text_hash TEXT NOT NULL, subject TEXT NOT NULL,
    from_header TEXT NOT NULL, date TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (scope, email_id))`);
  const upsert = sqlite.prepare(`INSERT OR REPLACE INTO quality_label
    (scope, email_id, account_id, source, class, fields_json, redacted_text, text_hash, subject, from_header, date, at)
    VALUES (@scope, @email_id, @account_id, @source, @class, @fields_json, @redacted_text, @text_hash, @subject, @from_header, @date, @at)`);
  const one = sqlite.prepare("SELECT * FROM quality_label WHERE scope = ? AND email_id = ?");
  const all = sqlite.prepare("SELECT * FROM quality_label WHERE scope = ? ORDER BY at DESC, rowid DESC");
  const remove = sqlite.prepare("DELETE FROM quality_label WHERE scope = ?");
  const removeOne = sqlite.prepare("DELETE FROM quality_label WHERE scope = ? AND email_id = ?");
  const removeMany = sqlite.transaction((scope: string, emailIds: readonly string[]) =>
    emailIds.reduce((count, emailId) => count + removeOne.run(scope, emailId).changes, 0));

  function toLabel(row: Row): QualityLabel | undefined {
    const cls = EmailClassSchema.safeParse(row.class);
    if (!cls.success || (row.source !== "review" && row.source !== "feedback")) return undefined;
    let fields: QualityLabel["fields"] = null;
    if (row.fields_json) {
      const parsed = ExtractedFieldsSchema.partial().safeParse(JSON.parse(row.fields_json));
      if (!parsed.success) return undefined;
      fields = parsed.data;
    }
    return {
      emailId: row.email_id, ...(row.account_id ? { accountId: row.account_id } : {}), source: row.source as LabelSource,
      class: cls.data, fields, redactedText: row.redacted_text, textHash: row.text_hash, subject: row.subject,
      from: row.from_header, date: row.date, at: row.at,
    };
  }
  const labels = (rows: Row[]) => rows.map(toLabel).filter((label): label is QualityLabel => label !== undefined);

  return {
    upsert(scope, label) {
      upsert.run({ scope, email_id: label.emailId, account_id: label.accountId ?? null, source: label.source, class: label.class,
        fields_json: label.fields ? JSON.stringify(label.fields) : null, redacted_text: label.redactedText,
        text_hash: label.textHash, subject: label.subject, from_header: label.from, date: label.date, at: label.at });
    },
    get: (scope, emailId) => labels([one.get(scope, emailId) as Row].filter(Boolean))[0],
    list: (scope) => labels(all.all(scope) as Row[]),
    classOverrides(scope) {
      const overrides = new Map<string, EmailClass>();
      for (const label of labels(all.all(scope) as Row[])) {
        if (label.source === "feedback") overrides.set(label.emailId, label.class);
      }
      return overrides;
    },
    remove: (scope, emailIds) => removeMany(scope, emailIds),
    deleteScope: (scope) => remove.run(scope).changes,
    close: () => sqlite.close(),
  };
}

const defaultFilename = () => process.env.DATABASE_URL ?? "./papertrail.sqlite";
let opened: LabelStore | undefined;

/** Replaces the process-wide store (tests pass an in-memory one, or undefined to close and reset). */
export function setLabelStore(store: LabelStore | undefined): void {
  if (opened && opened !== store) opened.close();
  opened = store;
}

/** The store for writing: opens (and creates) the database file on first use. */
export function labelStore(): LabelStore {
  return (opened ??= createLabelStore(defaultFilename()));
}

/**
 * The store for reading and deleting: undefined while nothing was ever written (no database file yet), so reads on
 * a fresh checkout and in tests never create `papertrail.sqlite`.
 */
export function existingLabelStore(): LabelStore | undefined {
  if (opened) return opened;
  const filename = defaultFilename();
  return filename === ":memory:" || !existsSync(filename) ? undefined : labelStore();
}

/** Labels the user set by hand per email id, for PipelineDeps.classOverride. */
export function classOverridesFor(scope: string): (emailId: string) => EmailClass | undefined {
  const overrides = existingLabelStore()?.classOverrides(scope) ?? new Map<string, EmailClass>();
  return (emailId) => overrides.get(emailId);
}

/**
 * Labels the real eval and experiments can score: those with the redacted email text. "Not a purchase" on an order
 * whose email text was not kept still saves its class override (so syncs honor it) but has no text to score.
 */
export function scorableLabels(scope: string): QualityLabel[] {
  return existingLabelStore()?.list(scope).filter((label) => label.redactedText.trim() !== "") ?? [];
}

/** Delete-all: removes the scope's labels. Returns the number deleted. */
export function deleteScopeLabels(scope: string): number {
  return existingLabelStore()?.deleteScope(scope) ?? 0;
}
