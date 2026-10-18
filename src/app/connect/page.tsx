import { ConnectClient } from "./ConnectClient";
import type { ConnectErrorState } from "@/components/views/ConnectView";

// Thin server wrapper for /connect (issues #24, #71). The OAuth callback redirects here with `?error=<reason>`
// (access_denied, token_expired, invalid_state, oauth_failed, ...); reasons the view has no dedicated state for
// render its generic "other" state. Nothing loads on page load: the user explicitly picks "Try demo data" or
// "Connect Gmail" (#28 DECISION), and the client wrapper owns both actions.
function toConnectErrorState(error: string | string[] | undefined): ConnectErrorState {
  const reason = Array.isArray(error) ? error[0] : error;
  if (!reason) return "none";
  if (reason === "access_denied" || reason === "token_expired") return reason;
  return "other";
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  return <ConnectClient errorState={toConnectErrorState(error)} />;
}
