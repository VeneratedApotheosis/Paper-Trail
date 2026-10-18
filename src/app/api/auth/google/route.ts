import { startAuthorization } from "@/lib/auth/start";

export const runtime = "nodejs";
export function GET() {
  return startAuthorization(false);
}
