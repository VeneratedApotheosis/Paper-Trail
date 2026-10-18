"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Finding, NormalizedOrder } from "@/lib/contracts";
import { encodeIdSegment } from "@/lib/api/ids";
import { OrderDetailView } from "@/components/views/OrderDetailView";
import { useAccount, useMarkEmailNotAboutOrder, useMarkNotPurchase, useRestoreOrder } from "@/hooks";

type FeedbackAction = "mark" | "email" | "restore";

// Client boundary for the order detail page: it owns navigation and supplies the
// onBack callback to the props-only OrderDetailView. The server page passes the
// already-resolved (serializable) order + findings; routing stays out of the view. The linked Gmail accounts turn
// `order.sources` ids into the mailbox the purchase came from (#115). "Not a purchase" (#134) calls the order feedback
// routes through the mutation hooks (they refresh the ledger, owed and other cached reads); after marking the whole
// purchase the order is gone, so the page keeps showing its last copy as a notice with Undo instead of re-rendering.
export function OrderDetailWrapper({
  order,
  findings,
  simulatedLabel,
}: {
  order: NormalizedOrder;
  findings: Finding[];
  simulatedLabel: string;
}) {
  const router = useRouter();
  const account = useAccount();
  const markNotPurchase = useMarkNotPurchase();
  const markEmail = useMarkEmailNotAboutOrder();
  const restore = useRestoreOrder();
  const [notice, setNotice] = useState<"purchase" | "email" | null>(null);
  const [last, setLast] = useState<FeedbackAction | null>(null);
  const errors: Record<FeedbackAction, string | null> = { mark: markNotPurchase.error, email: markEmail.error, restore: restore.error };

  async function handleMarkNotPurchase() {
    setLast("mark");
    if (await markNotPurchase.run(order.id)) setNotice("purchase");
  }

  async function handleMarkEmail(emailId: string) {
    setLast("email");
    if (await markEmail.run(order.id, emailId)) {
      setNotice((current) => current ?? "email");
      router.refresh();
    }
  }

  async function handleRestore() {
    setLast("restore");
    if (await restore.run(order.id)) {
      setNotice(null);
      router.refresh();
    }
  }

  return (
    <OrderDetailView
      order={order}
      findings={findings}
      simulatedLabel={simulatedLabel}
      accounts={account.data?.accounts}
      onBack={() => router.push("/ledger")}
      onOpenClaim={(findingId) => router.push(`/claim/${encodeIdSegment(findingId)}`)}
      onMarkNotPurchase={handleMarkNotPurchase}
      onMarkEmailNotAboutOrder={handleMarkEmail}
      onRestore={handleRestore}
      feedback={{
        pending: markNotPurchase.pending || markEmail.pending || restore.pending,
        error: last ? errors[last] : null,
        notice,
      }}
    />
  );
}
