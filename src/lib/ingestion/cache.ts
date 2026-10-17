import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ExtractionSchema, type Extraction } from "@/lib/contracts";

/**
 * Extraction cache keyed by RedactedEmail.textHash (sha256 of the redacted text), so reruns and demo mode
 * need no LLM call. Stores validated extractions only: fields, confidence, and evidence snippets <=200 chars,
 * never email bodies.
 */
export interface ExtractionCache {
  get(textHash: string): Extraction | undefined;
  set(textHash: string, extraction: Extraction): void;
}

export function createMemoryCache(): ExtractionCache {
  const entries = new Map<string, Extraction>();
  return {
    get: (textHash) => entries.get(textHash),
    set: (textHash, extraction) => {
      entries.set(textHash, extraction);
    },
  };
}

/** Entries that no longer match ExtractionSchema are ignored on load and re-extracted on demand. */
function loadCacheFile(path: string): Map<string, Extraction> {
  const entries = new Map<string, Extraction>();
  if (!existsSync(path)) return entries;
  const json: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof json !== "object" || json === null) return entries;
  for (const [textHash, value] of Object.entries(json)) {
    const parsed = ExtractionSchema.safeParse(value);
    if (parsed.success) entries.set(textHash, parsed.data);
  }
  return entries;
}

/** JSON-file cache for demo mode: `{ [textHash]: Extraction }`, loaded lazily, rewritten on every set. */
export function createFileCache(path: string): ExtractionCache {
  let entries: Map<string, Extraction> | null = null;
  const load = () => (entries ??= loadCacheFile(path));
  return {
    get: (textHash) => load().get(textHash),
    set: (textHash, extraction) => {
      const current = load();
      current.set(textHash, extraction);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(Object.fromEntries(current), null, 2)}\n`, "utf8");
    },
  };
}
