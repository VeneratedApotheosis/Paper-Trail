import { ConnectClient } from "./ConnectClient";
import type { ConnectErrorState } from "@/components/views/ConnectView";

// Pre-auth entry screen (issue #24). Server component: reads `searchParams`
// (a Promise in Next 15) to branch on OAuth error outcomes, then hands the
// computed state to a tiny client wrapper that owns the actions/navigation.
// The props-only ConnectView renders a standalone centered neumorphic layout
// (no AppShell — the nav assumes a connected session).
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  const errorState: ConnectErrorState =
    sp.error === "access_denied"
      ? "access_denied"
      : sp.error === "token_expired"
        ? "token_expired"
        : sp.error
          ? "other"
          : "none";

  return <ConnectClient errorState={errorState} />;
}
