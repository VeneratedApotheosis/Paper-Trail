import type { AccountResponse } from "@/lib/api/types";
import { anonymousGmailStatus, gmailAccountStatus } from "@/lib/auth/account";
import { authConfig } from "@/lib/auth/config";
import { resolveSessionUser } from "@/lib/auth/session";
import { authStore } from "@/lib/auth/store";
import { withAccountStore } from "@/lib/gmail/context";
import { gmailProgress } from "@/lib/gmail/progress";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Account-scoped status for the account page. Anonymous visitors get `gmail.connected: false`; no tokens are returned. */
async function handleGET(request: Request): Promise<Response> {
  const userId = resolveSessionUser(request, { requireToken: false });
  const state = getState();
  const progress = userId ? gmailProgress.read(userId) : null;
  const body: AccountResponse = {
    gmail: userId ? await gmailAccountStatus(userId, authConfig(), authStore()) : anonymousGmailStatus,
    mode: state.mode,
    asOf: state.asOf,
    lastSyncAt: state.lastSyncAt,
    counts: { orders: state.orders.length, findings: state.findings.length, reviewItems: state.reviewQueue.length },
    excludedMerchants: state.excludedMerchants,
    syncing: progress !== null && ["listing", "fetching", "processing"].includes(progress.stage),
  };
  return Response.json(body);
}

export const GET = withAccountStore(handleGET);
