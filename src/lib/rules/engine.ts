import {
  FindingSchema,
  type Finding,
  type FindingKind,
  type FindingSeverity,
  type NormalizedOrder,
} from "@/lib/contracts";

/** Inputs shared by all rules. Rules never read the system clock; `now` is always passed in. */
export interface RuleContext {
  now: Date;
  /** Price source for R3 (#15). Typed `unknown` until #15 defines it; rules must narrow before use. */
  priceFeed?: unknown;
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

/**
 * Runs every rule over every order and returns validated, de-duplicated, sorted findings.
 *
 * - Orders with `needsReview = true` are skipped: their extracted fields are below the confidence threshold and
 *   unconfirmed, so any amount computed from them would be unverified (AGENTS.md rule 7). They stay in the
 *   needs-review queue and produce findings once a human confirms them and the order is re-run.
 * - Each finding's id is set to `findingId(kind, orderId, lineItemId)`; the first finding per id wins.
 * - Every finding is validated with FindingSchema; an invalid finding is a rule bug and throws.
 * - Sorted by `dueAt` ascending (null last), then `amountAtStake` descending, then id.
 */
export function runRules(
  orders: readonly NormalizedOrder[],
  rules: readonly Rule[],
  ctx: RuleContext,
): Finding[] {
  const findingsById = new Map<string, Finding>();
  for (const order of orders) {
    if (order.needsReview) continue;
    for (const rule of rules) {
      for (const candidate of rule.evaluate(order, ctx)) {
        const id = findingId(candidate.kind, candidate.orderId, candidate.lineItemId);
        if (findingsById.has(id)) continue;
        findingsById.set(id, validateFinding({ ...candidate, id }, rule));
      }
    }
  }
  return [...findingsById.values()].sort(compareFindings);
}

function validateFinding(finding: Finding, rule: Rule): Finding {
  const parsed = FindingSchema.safeParse(finding);
  if (!parsed.success) {
    throw new Error(
      `Rule ${ruleVersionOf(rule)} produced an invalid finding ${finding.id}: ${parsed.error.message}`,
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
