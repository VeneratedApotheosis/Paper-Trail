import {
  FindingSchema,
  type Finding,
  type FindingKind,
  type FindingSeverity,
  type NormalizedOrder,
} from "@/lib/contracts";
import type { PriceFeed } from "@/lib/prices/feed";

/** Inputs shared by all rules. Rules never read the system clock; `now` is always passed in. */
export interface RuleContext {
  now: Date;
  /** Price observations for R3 (#15). Without a feed R3 emits no findings. */
  priceFeed?: PriceFeed | undefined;
}

/** A pure, versioned detection rule (deepdive_S14 §4). */
export interface Rule {
  /** Short rule id, e.g. "R1". */
  id: string;
  /** Rule logic version, bumped when the logic changes. Findings carry `${id}@${version}`. */
  version: string;
  evaluate(order: NormalizedOrder, ctx: RuleContext): Finding[];
}

/** `ruleVersion` value for findings produced by `rule`, e.g. "R1@1". */
export function ruleVersionOf(rule: Pick<Rule, "id" | "version">): string {
  return `${rule.id}@${rule.version}`;
}

/** Deterministic finding id `${kind}:${orderId}[:${lineItemId}]`, so reruns never duplicate findings. */
export function findingId(kind: FindingKind, orderId: string, lineItemId?: string): string {
  return lineItemId ? `${kind}:${orderId}:${lineItemId}` : `${kind}:${orderId}`;
}

/** Severity by money at stake: high >= 100, medium >= 25, else low. */
export function severityFor(amount: number): FindingSeverity {
  if (amount >= 100) return "high";
  if (amount >= 25) return "medium";
  return "low";
}

/** One order whose rules threw or produced an invalid finding; none of that order's findings are kept. */
export interface RuleFailure {
  orderId: string;
  reason: string;
}

export interface RulesRun {
  findings: Finding[];
  failures: RuleFailure[];
}

/**
 * Runs every rule over every order and returns validated, de-duplicated, sorted findings plus per-order failures.
 *
 * - Orders with `needsReview = true` are skipped: their extracted fields are below the confidence threshold and
 *   unconfirmed, so any amount computed from them would be unverified (AGENTS.md rule 7). They stay in the
 *   needs-review queue and produce findings once a human confirms them and the order is re-run.
 * - Each finding's id is set to `findingId(kind, orderId, lineItemId)`; the first finding per id wins.
 * - Every finding is validated with FindingSchema. A rule that throws or produces an invalid finding fails only that
 *   order: all of its findings are dropped and it is reported in `failures`, the other orders are unaffected.
 * - Sorted by `dueAt` ascending (null last), then `amountAtStake` descending, then id.
 */
export function runRulesIsolated(
  orders: readonly NormalizedOrder[],
  rules: readonly Rule[],
  ctx: RuleContext,
): RulesRun {
  const findingsById = new Map<string, Finding>();
  const failures: RuleFailure[] = [];
  for (const order of orders) {
    if (order.needsReview) continue;
    try {
      for (const finding of evaluateOrder(order, rules, ctx, findingsById)) findingsById.set(finding.id, finding);
    } catch (error) {
      failures.push({ orderId: order.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { findings: [...findingsById.values()].sort(compareFindings), failures };
}

/** runRulesIsolated for callers where any rule failure is a bug (eval, tests, single-order re-runs): throws on the first. */
export function runRules(
  orders: readonly NormalizedOrder[],
  rules: readonly Rule[],
  ctx: RuleContext,
): Finding[] {
  const { findings, failures } = runRulesIsolated(orders, rules, ctx);
  if (failures.length > 0) throw new Error(failures[0].reason);
  return findings;
}

/** Validated findings for one order, skipping ids already in `existing` or produced earlier for this order. */
function evaluateOrder(
  order: NormalizedOrder,
  rules: readonly Rule[],
  ctx: RuleContext,
  existing: ReadonlyMap<string, Finding>,
): Finding[] {
  const byId = new Map<string, Finding>();
  for (const rule of rules) {
    let candidates: Finding[];
    try {
      candidates = rule.evaluate(order, ctx);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`Rule ${ruleVersionOf(rule)} failed on order ${order.id}: ${message}`);
    }
    for (const candidate of candidates) {
      const id = findingId(candidate.kind, candidate.orderId, candidate.lineItemId);
      if (existing.has(id) || byId.has(id)) continue;
      byId.set(id, validateFinding({ ...candidate, id }, rule));
    }
  }
  return [...byId.values()];
}

function validateFinding(finding: Finding, rule: Rule): Finding {
  const parsed = FindingSchema.safeParse(finding);
  if (!parsed.success) {
    throw new Error(
      `Rule ${ruleVersionOf(rule)} produced an invalid finding ${finding.id}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "finding"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.dueAt !== b.dueAt) {
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    const byDue = Date.parse(a.dueAt) - Date.parse(b.dueAt);
    if (byDue !== 0) return byDue;
  }
  if (a.amountAtStake !== b.amountAtStake) return b.amountAtStake - a.amountAtStake;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
