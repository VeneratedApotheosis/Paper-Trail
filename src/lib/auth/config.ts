import { z } from "zod";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const TRANSACTION_COOKIE = "papertrail_oauth";
export const SESSION_COOKIE = "papertrail_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function authConfig() {
  const env = z.object({
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    AUTH_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    AUTH_BASE_URL: z.string().url().default("http://localhost:3000"),
  }).parse(process.env);
  const url = new URL(env.AUTH_BASE_URL);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))) {
    throw new Error("Invalid auth origin");
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    key: env.AUTH_ENCRYPTION_KEY, origin: url.origin,
    redirectUri: `${url.origin}/api/auth/callback`, secure: url.protocol === "https:" };
}
