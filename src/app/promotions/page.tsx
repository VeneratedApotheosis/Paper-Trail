"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { PromotionsView } from "@/components/views/PromotionsView";
import { useAccount } from "@/hooks";
import { usePromotions } from "@/hooks/usePromotions";
import { copyToClipboard, promotionsViewProps } from "./viewModel";

// Thin wrapper for "/promotions" (#131): GET /api/promotions (expired offers only with the toggle) and the linked Gmail
// accounts, handed to the props-only PromotionsView. Copying a code is the browser clipboard; nothing is sent anywhere.
// While the first load runs the view shows its own placeholder cards; "Sync inbox" on the empty state opens /sync.
export default function PromotionsPage() {
  const router = useRouter();
  const [showExpired, setShowExpired] = useState(false);
  const promotions = usePromotions(showExpired);
  const account = useAccount();
  const viewInput = {
    accounts: account.data?.accounts,
    showExpired,
    onShowExpiredChange: setShowExpired,
    onCopyCode: copyToClipboard,
    onSyncInbox: () => router.push("/sync"),
  };

  if (promotions.loading) {
    return <PromotionsView {...promotionsViewProps({ ...viewInput, data: null })} />;
  }
  if (promotions.error || !promotions.data) {
    return (
      <AppShell>
        <ErrorState
          title="Couldn't load promotions"
          what={promotions.error}
          fix="Check that the app server is running, then try again."
          actions={<Button type="button" onClick={promotions.refetch}>Try again</Button>}
        />
      </AppShell>
    );
  }
  return (
    <PromotionsView {...promotionsViewProps({ ...viewInput, data: promotions.data })} />
  );
}
