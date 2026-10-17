import type { Finding, FindingStatus, NormalizedOrder } from "@/lib/contracts";
import { createMemoryCache, type ExtractionCache } from "@/lib/ingestion";
import {
  isExcludedMerchant,
  normalizeMerchantKey,
  type PipelineAuditEvent,
  type PipelineResult,
  type PipelineStats,
  type ReviewQueueItem,
} from "@/lib/pipeline/run";
import type { AuditEntry, Draft } from "@/lib/types";

/**
 * In-memory session store (issues #4, #31). Lives on globalThis so it survives Next dev hot reloads.
 * Holds derived data only (orders, findings, drafts, review queue, audit log); raw email bodies are never stored.
 * Every read filters out excluded merchants' orders, findings, drafts and review items.
 */

export type StoreMode = "empty" | "demo" | "upload" | "gmail";

/** Revokes the Gmail OAuth token; resolves true when a token existed and was revoked. Plugged in by #3. */
export type RevokeOAuthHook = () => Promise<boolean>;

interface StoreData {
  mode: StoreMode;
  asOf: string | null;
  orders: NormalizedOrder[];
  findings: Finding[];
  drafts: Draft[];
  reviewQueue: ReviewQueueItem[];
  stats: PipelineStats | null;
  audit: AuditEntry[];
  auditSeq: number;
  excludedMerchants: Set<string>;
  extractionCache: ExtractionCache;
  revokeOAuth: RevokeOAuthHook | null;
}

/** Read-only snapshot with exclusions applied. */
export interface StoreState {
  mode: StoreMode;
  asOf: string | null;
  orders: NormalizedOrder[];
  findings: Finding[];
  drafts: Draft[];
  reviewQueue: ReviewQueueItem[];
  stats: PipelineStats | null;
  /** Newest first. */
  audit: AuditEntry[];
  excludedMerchants: string[];
}

export interface DeleteAllResult {
  deleted: true;
  ok: true;
  at: string;
  revokedToken: boolean;
  purged: { orders: number; findings: number; drafts: number; reviewItems: number; audit: number };
}

const STORE_KEY = Symbol.for("papertrail.store");
type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: StoreData };

function emptyData(): StoreData {
  return {
    mode: "empty",
    asOf: null,
    orders: [],
    findings: [],
    drafts: [],
    reviewQueue: [],
    stats: null,
    audit: [],
    auditSeq: 0,
    excludedMerchants: new Set(),
    extractionCache: createMemoryCache(),
    revokeOAuth: null,
  };
}

function data(): StoreData {
  const holder = globalThis as GlobalWithStore;
  return (holder[STORE_KEY] ??= emptyData());
}

/** Drops all store data, including the audit log and the OAuth hook. Tests only. */
export function resetStore(): void {
  (globalThis as GlobalWithStore)[STORE_KEY] = emptyData();
}

function visibleOrders(store: StoreData): NormalizedOrder[] {
  return store.orders.filter((order) => !isExcludedMerchant(order, store.excludedMerchants));
}

export function getState(): StoreState {
  const store = data();
  const orders = visibleOrders(store);
  const orderIds = new Set(orders.map((order) => order.id));
  const findings = store.findings.filter((finding) => orderIds.has(finding.orderId));
  const findingIds = new Set(findings.map((finding) => finding.id));
  const hiddenEmailIds = new Set(
    store.orders.filter((order) => !orderIds.has(order.id)).flatMap((order) => order.messageIds),
  );
  return {
    mode: store.mode,
    asOf: store.asOf,
    orders,
    findings,
    drafts: store.drafts.filter((draft) => findingIds.has(draft.findingId)),
    reviewQueue: store.reviewQueue.filter(
      (item) => !(item.orderId && !orderIds.has(item.orderId)) && !hiddenEmailIds.has(item.emailId),
    ),
    stats: store.stats,
    audit: [...store.audit].reverse(),
    excludedMerchants: [...store.excludedMerchants].sort(),
  };
}

export function getOrder(id: string): NormalizedOrder | undefined {
  return getState().orders.find((order) => order.id === id);
}

export function getFinding(id: string): Finding | undefined {
  return getState().findings.find((finding) => finding.id === id);
}

export function getFindingsForOrder(orderId: string): Finding[] {
  return getState().findings.filter((finding) => finding.orderId === orderId);
}

/** Replaces the ledger with a pipeline run. Drafts belong to the previous findings and are cleared. */
export function setPipelineResult(mode: Exclude<StoreMode, "empty">, asOf: string, result: PipelineResult): void {
  const store = data();
  store.mode = mode;
  store.asOf = asOf;
  store.orders = result.orders;
  store.findings = result.findings;
  store.reviewQueue = result.reviewQueue;
  store.stats = result.stats;
  store.drafts = [];
}

/** Clears the ledger (orders, findings, drafts, review queue) but keeps the audit log and exclusions. */
export function clearLedger(): void {
  const store = data();
  store.mode = "empty";
  store.asOf = null;
  store.orders = [];
  store.findings = [];
  store.drafts = [];
  store.reviewQueue = [];
  store.stats = null;
}

/** Adds or replaces a claim draft by id. */
export function upsertDraft(draft: Draft): void {
  const store = data();
  store.drafts = [...store.drafts.filter((existing) => existing.id !== draft.id), draft];
}

/** Sets a visible finding's status (e.g. "drafted" after a claim approval). Returns undefined when hidden or unknown. */
export function setFindingStatus(id: string, status: FindingStatus): Finding | undefined {
  if (!getFinding(id)) return undefined;
  const store = data();
  let updated: Finding | undefined;
  store.findings = store.findings.map((finding) => {
    if (finding.id !== id) return finding;
    updated = { ...finding, status };
    return updated;
  });
  return updated;
}

export function appendAudit(event: PipelineAuditEvent): AuditEntry {
  const store = data();
  store.auditSeq += 1;
  const entry: AuditEntry = { id: `aud_${store.auditSeq}`, ...event };
  store.audit.push(entry);
  return entry;
}

export function getExtractionCache(): ExtractionCache {
  return data().extractionCache;
}

export function getExcludedMerchants(): ReadonlySet<string> {
  return data().excludedMerchants;
}

/** Hides a merchant (display name or domain, case-insensitive) from every read. Returns the excluded list. */
export function excludeMerchant(merchant: string): string[] {
  data().excludedMerchants.add(normalizeMerchantKey(merchant));
  return getState().excludedMerchants;
}

export function includeMerchant(merchant: string): string[] {
  data().excludedMerchants.delete(normalizeMerchantKey(merchant));
  return getState().excludedMerchants;
}

/** Registers the OAuth revoker (#3). Until then delete-all reports `revokedToken: false`. */
export function setRevokeOAuthHook(hook: RevokeOAuthHook | null): void {
  data().revokeOAuth = hook;
}

/**
 * Purges all user data: ledger, drafts, review queue, extraction cache, exclusions and the audit log, keeping
 * only the single "delete" audit record. Uses a per-request revoker when supplied, otherwise the registered hook.
 */
export async function deleteAll(
  clock: () => Date = () => new Date(),
  revokeOAuth: RevokeOAuthHook | null = data().revokeOAuth,
): Promise<DeleteAllResult> {
  const store = data();
  let revokedToken = false;
  let revokeNote = "no OAuth token connected";
  if (revokeOAuth) {
    try {
      revokedToken = await revokeOAuth();
      revokeNote = revokedToken ? "OAuth token revoked" : "OAuth revocation not confirmed";
    } catch (error) {
      revokeNote = `OAuth revoke failed (${error instanceof Error ? error.name : "error"})`;
    }
  }
  const purged = {
    orders: store.orders.length,
    findings: store.findings.length,
    drafts: store.drafts.length,
    reviewItems: store.reviewQueue.length,
    audit: store.audit.length,
  };
  const at = clock().toISOString();
  const fresh = emptyData();
  fresh.revokeOAuth = store.revokeOAuth;
  (globalThis as GlobalWithStore)[STORE_KEY] = fresh;
  appendAudit({
    at,
    type: "delete",
    detail: `Deleted everything: ${purged.orders} orders, ${purged.findings} findings, ${purged.drafts} drafts, ${purged.reviewItems} review items, ${purged.audit} audit entries, extraction cache, merchant exclusions; ${revokeNote}`,
  });
  return { deleted: true, ok: true, at, revokedToken, purged };
}
