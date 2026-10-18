"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { ConnectView, type ConnectErrorState } from "@/components/views/ConnectView";
import { useLoadDemo } from "@/hooks";
import { CONSENT_EXAMPLE } from "./consentExample";

// Client boundary for /connect (#71): owns the two explicit user choices the props-only ConnectView emits.
// - "Connect Gmail" starts the read-only OAuth flow: a GET route handler that redirects to Google, so it is a full
//   navigation, not router.push.
// - "Try demo data" loads the synthetic seed (POST /api/demo) only on click, then opens "/". The view stays in its
//   loading state until the navigation lands, so the button can't be clicked twice.
// The "What you'll see" card gets a labelled synthetic example from the seed inbox (consentExample.ts).
export function ConnectClient({ errorState }: { errorState: ConnectErrorState }) {
  const router = useRouter();
  const demo = useLoadDemo();
  const [openingHome, setOpeningHome] = useState(false);

  function connectGmail() {
    window.location.href = "/api/auth/google";
  }

  async function tryDemo() {
    if (!(await demo.run())) return;
    setOpeningHome(true);
    router.push("/");
  }

  // ConnectView has no demo-error state, so a failed POST /api/demo uses the shared ErrorState (same as "/").
  if (demo.error) {
    return (
      <AppShell demo={false}>
        <ErrorState
          title="Couldn't load the demo data"
          what={demo.error}
          fix="Check that the app server is running, then try again."
          actions={
            <>
              <Button type="button" onClick={tryDemo} disabled={demo.pending}>
                Try again
              </Button>
              <Button type="button" variant="secondary" onClick={connectGmail}>
                Connect Gmail
              </Button>
            </>
          }
        />
      </AppShell>
    );
  }

  return (
    <ConnectView
      errorState={errorState}
      onConnect={connectGmail}
      onTryDemo={tryDemo}
      demoLoading={demo.pending || openingHome}
      example={CONSENT_EXAMPLE}
    />
  );
}
