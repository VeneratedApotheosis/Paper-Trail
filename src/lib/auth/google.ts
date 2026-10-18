import { z } from "zod";
import { GMAIL_SCOPE } from "./config";

export class AuthError extends Error {
  constructor(public readonly reason: "token_expired" | "oauth_failed" | "invalid_state" | "access_denied") { super(reason); }
}
const tokenResponse = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(), token_type: z.literal("Bearer"),
  scope: z.string().optional(), refresh_token_expires_in: z.number().positive().optional(),
});
export const storedTokens = z.object({
  accessToken: z.string().min(1), refreshToken: z.string().min(1),
  expiresAt: z.number(), refreshExpiresAt: z.number().optional(),
  // Connected address, sealed with the tokens (absent in rows saved before #109).
  mailbox: z.string().optional(),
});
export type Tokens = z.infer<typeof storedTokens>;
export type Fetcher = typeof fetch;

export async function requestTokens(params: URLSearchParams, fetcher: Fetcher = fetch) {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST", body: params, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    // Never expose Google's response body: it may contain credential material.
    const body: unknown = await response.json().catch(() => null);
    const expired = z.object({ error: z.literal("invalid_grant") }).safeParse(body).success;
    throw new AuthError(expired ? "token_expired" : "oauth_failed");
  }
  const parsed = tokenResponse.safeParse(await response.json());
  if (!parsed.success) throw new AuthError("oauth_failed");
  if (parsed.data.scope && parsed.data.scope.split(/\s+/).some(s => s !== GMAIL_SCOPE)) {
    throw new AuthError("oauth_failed");
  }
  return parsed.data;
}

export async function mailboxIdentity(accessToken: string, fetcher: Fetcher = fetch) {
  const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new AuthError("oauth_failed");
  const parsed = z.object({ emailAddress: z.string().email() }).safeParse(await response.json());
  if (!parsed.success) throw new AuthError("oauth_failed");
  return parsed.data.emailAddress.toLowerCase();
}
