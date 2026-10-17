"use client";

import { useRouter } from "next/navigation";
import { ConnectView, type ConnectErrorState } from "@/components/views/ConnectView";

// Tiny client wrapper for the CONNECT page: it owns the routing/navigation the
// props-only ConnectView is not allowed to do. The server page computes
// `errorState` and hands it down here.
//
// onConnect starts the real OAuth flow (#3) — a GET redirect to a route handler,
// so a full navigation (not next/router) is correct. onTryDemo routes into demo
// mode; for the mock split it just pushes to /ledger (the real loadDemo call is
// ui-wiring, #4).
export function ConnectClient({ errorState }: { errorState: ConnectErrorState }) {
  const router = useRouter();

  return (
    <ConnectView
      errorState={errorState}
      onConnect={() => {
        window.location.href = "/api/auth/google";
      }}
      onTryDemo={() => {
        router.push("/ledger");
      }}
    />
  );
}
