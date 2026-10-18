"use client";

import { useRouter } from "next/navigation";
import type { Finding, NormalizedOrder } from "@/lib/contracts";
import { OrderDetailView } from "@/components/views/OrderDetailView";
import { useAccount } from "@/hooks";

// Client boundary for the order detail page: it owns navigation and supplies the
// onBack callback to the props-only OrderDetailView. The server page passes the
// already-resolved (serializable) order + findings; routing stays out of the view. The linked Gmail accounts turn
// `order.sources` ids into the mailbox the purchase came from (#115).
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
  return (
    <OrderDetailView
      order={order}
      findings={findings}
      simulatedLabel={simulatedLabel}
      accounts={account.data?.accounts}
      onBack={() => router.push("/ledger")}
    />
  );
}
