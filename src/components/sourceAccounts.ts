import type { NormalizedOrder } from "@/lib/contracts";
import type { SearchSelectOption } from "@/components/ui/searchSelectOptions";

// Pure helpers for "which Gmail account did this purchase come from" (issue #115). The page wrappers pass the linked
// accounts (id + mailbox, from GET /api/account) down as plain props; `NormalizedOrder.sources` carries account ids.
// Orders from the demo or an upload have no sources, so nothing is shown for them.

/**
 * A linked Gmail account as the views need it. `mailbox` is null once the account was disconnected (or, rarely, while
 * the address is unknown); `connected` tells those two apart for the stand-in name.
 */
export interface SourceAccount {
  id: string;
  mailbox: string | null;
  connected?: boolean;
}

/** One source of a purchase, ready to display. `label` is the full address (or a plain-language stand-in). */
export interface OrderSource {
  id: string;
  label: string;
  short: string;
}

export const DISCONNECTED_ACCOUNT_LABEL = "Disconnected account";
/** A connected account whose address is not known yet. */
export const UNKNOWN_ACCOUNT_LABEL = "Gmail account";
/** Local parts longer than this are cut so the badge stays small. */
const MAX_LOCAL_PART = 12;

/**
 * "shopper@example.com" -> "shopper@e": the local part plus the first letter of the domain. A long local part is cut
 * with an ellipsis. A value without "@" is cut the same way.
 */
export function mailboxShortLabel(mailbox: string): string {
  const at = mailbox.lastIndexOf("@");
  const local = at > 0 ? mailbox.slice(0, at) : mailbox;
  const domainInitial = at > 0 ? mailbox.charAt(at + 1) : "";
  const cut = local.length > MAX_LOCAL_PART ? `${local.slice(0, MAX_LOCAL_PART - 1)}\u2026` : local;
  return domainInitial ? `${cut}@${domainInitial}` : cut;
}

function standInLabel(account: SourceAccount): string {
  return account.connected ? UNKNOWN_ACCOUNT_LABEL : DISCONNECTED_ACCOUNT_LABEL;
}

/**
 * Full display label per account id: the mailbox, or a plain stand-in ("Disconnected account") when there is none,
 * numbered when several accounts share one so the Account filter never lists two identical entries.
 */
export function accountLabels(accounts: readonly SourceAccount[]): Map<string, string> {
  const nameless = accounts.filter((account) => account.mailbox === null);
  const sameStandIn = (account: SourceAccount) => nameless.filter((other) => standInLabel(other) === standInLabel(account)).length;
  const labels = new Map<string, string>();
  const used = new Map<string, number>();
  for (const account of accounts) {
    if (account.mailbox !== null) {
      labels.set(account.id, account.mailbox);
      continue;
    }
    const base = standInLabel(account);
    const number = (used.get(base) ?? 0) + 1;
    used.set(base, number);
    labels.set(account.id, sameStandIn(account) > 1 ? `${base} ${number}` : base);
  }
  return labels;
}

function shortLabel(account: SourceAccount, label: string): string {
  return account.mailbox !== null ? mailboxShortLabel(account.mailbox) : label;
}

/** The accounts an order came from, in the order of `order.sources`. Ids that match no linked account are skipped. */
export function orderSources(sourceIds: readonly string[] | undefined, accounts: readonly SourceAccount[]): OrderSource[] {
  if (!sourceIds || sourceIds.length === 0) return [];
  const labels = accountLabels(accounts);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const sources: OrderSource[] = [];
  for (const id of sourceIds) {
    const account = byId.get(id);
    if (!account) continue;
    const label = labels.get(id)!;
    sources.push({ id, label, short: shortLabel(account, label) });
  }
  return sources;
}

export interface SourceBadgeSummary {
  /** The visible text. */
  text: string;
  /** Tooltip: every full address. */
  title: string;
  /** Screen reader text (visually hidden in the badge): "From shopper@example.com". */
  accessibleText: string;
}

/**
 * Text for the small source badge, or null when there is nothing to show. One or two sources are listed by their
 * short labels; three or more collapse to "3 accounts". `full` writes the whole address instead (detail screens).
 */
export function sourceBadgeSummary(sources: readonly OrderSource[], full = false): SourceBadgeSummary | null {
  if (sources.length === 0) return null;
  const labels = sources.map((source) => source.label);
  const title = labels.join(", ");
  const accessibleText = `From ${labels.join(" and ")}`;
  if (full) return { text: `From ${labels.join(" and ")}`, title, accessibleText };
  if (sources.length > 2) return { text: `${sources.length} accounts`, title, accessibleText };
  return { text: sources.map((source) => source.short).join(" + "), title, accessibleText };
}

/** Orders that came (also) from `accountId`; null keeps every order. */
export function filterOrdersByAccount(orders: readonly NormalizedOrder[], accountId: string | null): NormalizedOrder[] {
  if (accountId === null) return [...orders];
  return orders.filter((order) => order.sources?.includes(accountId));
}

/**
 * One Account filter option per linked account with its purchase count (an order from two inboxes counts for both).
 * Empty with fewer than two accounts: a single account has nothing to filter.
 */
export function accountFilterOptions(orders: readonly NormalizedOrder[], accounts: readonly SourceAccount[]): SearchSelectOption[] {
  if (accounts.length < 2) return [];
  const labels = accountLabels(accounts);
  return accounts.map((account) => ({
    value: account.id,
    label: labels.get(account.id)!,
    count: filterOrdersByAccount(orders, account.id).length,
  }));
}
