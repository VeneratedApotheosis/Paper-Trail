import { startAuthorization } from "@/lib/auth/start";

export const runtime = "nodejs";
// Adds another Gmail account to the signed-in profile instead of switching to it (#114); see /api/auth/callback.
export function GET() {
  return startAuthorization(true);
}
