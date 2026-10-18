import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
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
  /** ISO time the last Gmail sync was published; cleared by delete-all and clearLedger. */
  lastSyncAt: string | null;
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
  /** Bumped by deleteAll and clearLedger so in-flight work (upload, demo load) can tell its data was deleted. */
  generation: number;
}

/** Read-only snapshot with exclusions applied. */
export interface StoreState {
  mode: StoreMode;
  asOf: string | null;
  lastSyncAt: string | null;
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
const SCOPES_KEY = Symbol.for("papertrail.store.scopes");
const CONTEXT_KEY = Symbol.for("papertrail.store.context");
type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: StoreData;
  [SCOPES_KEY]?: Map<string, StoreData>;
  [CONTEXT_KEY]?: AsyncLocalStorage<string>;
};
const holder = globalThis as GlobalWithStore;
const context = holder[CONTEXT_KEY] ??= new AsyncLocalStorage<string>();
const scopes = holder[SCOPES_KEY] ??= new Map<string, StoreData>();

/** Authenticated HTTP handlers run in an isolated account store. Anonymous demo stays separate. */
export function withStoreScope<T>(userId: string, task: () => T): T {
  return context.run(userId, task);
}
function replaceData(value: StoreData) {
  const scope = context.getStore();
  if (scope) scopes.set(scope, value);
  else holder[STORE_KEY] = value;
}

function emptyData(): StoreData {
  return {
    mode: "empty",
    asOf: null,
    lastSyncAt: null,
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
    generation: 0,
  };
}

function data(): StoreData {
  const scope = context.getStore();
  if (scope) {
    let store = scopes.get(scope);
    if (!store) { store = emptyData(); scopes.set(scope, store); }
    return store;
  }
  return (holder[STORE_KEY] ??= emptyData());
}

/** Drops all store data, including the audit log and the OAuth hook. Tests only. */
export function resetStore(): void {
  replaceData(emptyData());
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
    lastSyncAt: store.lastSyncAt,
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

/**
 * Replaces the ledger with a pipeline run. Drafts belong to the previous findings and are cleared.
 * Finding statuses carry over by deterministic finding id (#77): a re-run keeps drafted / resolved / dismissed,
 * while findings the rules no longer produce (e.g. the refund arrived) disappear. Delete-all and clearLedger empty
 * the findings first, so nothing carries over across them.
 */
export function setPipelineResult(mode: Exclude<StoreMode, "empty">, asOf: string, result: PipelineResult): void {
  const store = data();
  const previousStatus = new Map(store.findings.map((finding) => [finding.id, finding.status]));
  store.mode = mode;
  store.asOf = asOf;
  // New snapshots invalidate stale review forms, including after a repeat sync.
  store.orders = result.orders.map(order => ({ ...order, review: { revision: randomUUID() } }));
  store.findings = result.findings.map((finding) => {
    const status = previousStatus.get(finding.id);
    return status === undefined || status === finding.status ? finding : { ...finding, status };
  });
  store.reviewQueue = result.reviewQueue;
  store.stats = result.stats;
  store.drafts = [];
}

/** Records when a Gmail sync was published (call right after `setPipelineResult("gmail", ...)`). */
export function setLastSyncAt(at: string): void {
  data().lastSyncAt = at;
}

/**
 * Async work that commits to the store later (upload, demo load). Capture it before the first await, mirroring
 * Gmail sync's `active()` guard: if delete-all or a demo reset ran meanwhile, the work must not commit.
 */
export interface StoreWork {
  /** Store generation when the work began. */
  generation: number;
  /** True while no deleteAll / clearLedger ran in this store scope since the work began. */
  isCurrent(): boolean;
  /**
   * Appends to the store the work began in. deleteAll replaces that store, so rows from work still in flight after
   * a delete land in the discarded store, never in the fresh one.
   */
  appendAudit(event: PipelineAuditEvent): AuditEntry;
}

export function beginStoreWork(): StoreWork {
  const store = data();
  const generation = store.generation;
  return {
    generation,
    isCurrent: () => data() === store && store.generation === generation,
    appendAudit: (event) => appendAuditTo(store, event),
  };
}

/** Clears the ledger (orders, findings, drafts, review queue) but keeps the audit log and exclusions. */
export function clearLedger(): void {
  const store = data();
  store.generation += 1;
  store.mode = "empty";
  store.asOf = null;
  store.lastSyncAt = null;
  store.orders = [];
  store.findings = [];
  store.drafts = [];
  store.reviewQueue = [];
  store.stats = null;
}

/** Apply a fully validated review result to one visible order, without affecting other orders. */
export function saveReviewedOrder(order: NormalizedOrder, findings: Finding[]): void {
  if (!getOrder(order.id)) throw new Error("Review order unavailable");
  const store = data();
  const oldIds = new Set(store.findings.filter(f => f.orderId === order.id).map(f => f.id));
  store.orders = store.orders.map(current => current.id === order.id ? order : current);
  store.findings = [...store.findings.filter(f => f.orderId !== order.id), ...findings];
  store.drafts = store.drafts.filter(draft => !oldIds.has(draft.findingId));
  store.reviewQueue = store.reviewQueue.filter(item => item.orderId !== order.id &&
    !(!item.orderId && order.messageIds.includes(item.emailId) &&
      !store.orders.some(other => other.id !== order.id && other.needsReview && other.messageIds.includes(item.emailId))));
  if (order.needsReview) store.reviewQueue.push({ orderId: order.id,
    emailId: order.messageIds[0] ?? order.id, stage: "match", reason: "Corrected order awaiting human confirmation" });
  if (store.stats) store.stats = { ...store.stats, findings: store.findings.length, needsReview: store.reviewQueue.length };
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
  return appendAuditTo(data(), event);
}

function appendAuditTo(store: StoreData, event: PipelineAuditEvent): AuditEntry {
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
  fresh.generation = store.generation + 1;
  replaceData(fresh);
  appendAudit({
    at,
    type: "delete",
    detail: `Deleted everything: ${purged.orders} orders, ${purged.findings} findings, ${purged.drafts} drafts, ${purged.reviewItems} review items, ${purged.audit} audit entries, extraction cache, merchant exclusions; ${revokeNote}`,
  });
  return { deleted: true, ok: true, at, revokedToken, purged };
}
