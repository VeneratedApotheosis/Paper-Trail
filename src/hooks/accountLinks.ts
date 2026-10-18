// Where a full-page navigation starts Google's read-only consent for the Gmail buttons (#115).
import { gmailConnectUrl } from "@/lib/api/client";
import type { AccountResponse } from "@/lib/api/types";

/**
 * Reconnect and "Add another Gmail account" both go through /api/auth/link when the profile already has an account:
 * it keeps the signed-in profile (and so its ledger) and refreshes a mailbox it already has instead of switching to a
 * separate profile, which /api/auth/google would do for a different mailbox. Without any account (first connect,
 * demo, signed out) it is the plain sign-in.
 */
export function connectHref(account: Pick<AccountResponse, "accounts"> | null): string {
  return gmailConnectUrl({ link: account !== null && account.accounts.length > 0 });
}

/** "Add another Gmail account": always the link flow (Google asks which account). */
export function addAccountHref(): string {
  return gmailConnectUrl({ link: true });
}
