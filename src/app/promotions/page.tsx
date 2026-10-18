"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorState, LedgerSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { PromotionsView } from "@/components/views/PromotionsView";
import { useAccount } from "@/hooks";
import { usePromotions } from "@/hooks/usePromotions";
import { copyToClipboard, promotionsViewProps } from "./viewModel";

// Thin wrapper for "/promotions" (#131): GET /api/promotions (expired offers only with the toggle) and the linked Gmail
// accounts, handed to the props-only PromotionsView. Copying a code is the browser clipboard; nothing is sent anywhere.
export default function PromotionsPage() {
  const [showExpired, setShowExpired] = useState(false);
  const promotions = usePromotions(showExpired);
  const account = useAccount();

  if (promotions.loading) {
    return (
      <AppShell>
        <LedgerSkeleton />
      </AppShell>
    );
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
    <PromotionsView
      {...promotionsViewProps({
        data: promotions.data,
        accounts: account.data?.accounts,
        showExpired,
        onShowExpiredChange: setShowExpired,
        onCopyCode: copyToClipboard,
      })}
    />
  );
}
