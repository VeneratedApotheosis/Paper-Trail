import type { AccountResponse } from "@/lib/api/types";
import { anonymousGmailStatus, gmailAccountStatuses } from "@/lib/auth/account";
import { authConfig } from "@/lib/auth/config";
import { resolveSessionUser } from "@/lib/auth/session";
import { authStore } from "@/lib/auth/store";
import { withAccountStore } from "@/lib/gmail/context";
import { gmailProgress } from "@/lib/gmail/progress";
import { redactionMode } from "@/lib/ingestion";
import { getAccountSyncTimes, getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Account-scoped status for the account page. Anonymous visitors get `gmail.connected: false`; no tokens are returned.
 * `accounts` lists every linked Gmail account (#114); `gmail` mirrors the first connected one, else the first account.
 */
async function handleGET(request: Request): Promise<Response> {
  const userId = resolveSessionUser(request, { requireToken: false });
  const state = getState();
  const progress = userId ? gmailProgress.read(userId) : null;
  const linked = userId ? await gmailAccountStatuses(userId, authConfig(), authStore()) : [];
  const primary = linked.find(account => account.connected) ?? linked[0];
  const syncTimes = getAccountSyncTimes();
  const body: AccountResponse = {
    gmail: primary ? { connected: primary.connected, expired: primary.expired, mailbox: primary.mailbox } : anonymousGmailStatus,
    accounts: linked.map(account => ({ id: account.id, mailbox: account.mailbox, connected: account.connected,
      expired: account.expired, lastSyncAt: syncTimes[account.id] ?? null })),
    mode: state.mode,
    asOf: state.asOf,
    lastSyncAt: state.lastSyncAt,
    counts: { orders: state.orders.length, findings: state.findings.length, reviewItems: state.reviewQueue.length },
    excludedMerchants: state.excludedMerchants,
    syncing: progress !== null && ["listing", "fetching", "processing", "promotions"].includes(progress.stage),
    redaction: redactionMode(),
  };
  return Response.json(body);
}

export const GET = withAccountStore(handleGET);
