"use client";

import { useRouter } from "next/navigation";
import { useLoadDemo } from "@/hooks";
import { LandingView } from "@/components/views/LandingView";

// Thin wrapper for /welcome (marketing landing, issue #145). "Open the app"
// goes straight to "/", which already handles the empty-ledger state on its
// own. "Connect Gmail" starts the same OAuth redirect as the rest of the app
// (see startGmailConnect in src/app/page.tsx); "Try demo data" loads the
// shared synthetic demo via the same hook Home uses, then drops the user into
// the now-populated app. Within-page navigation (nav links, "See how it
// works") is plain anchors handled inside LandingView itself.
export default function WelcomePage() {
  const router = useRouter();
  const loadDemo = useLoadDemo();

  function handleConnectGmail() {
    window.location.href = "/api/auth/google";
  }

  async function handleTryDemo() {
    await loadDemo.run();
    router.push("/");
  }

  return (
    <LandingView onOpenApp={() => router.push("/")} onConnectGmail={handleConnectGmail} onTryDemo={handleTryDemo} />
  );
}
