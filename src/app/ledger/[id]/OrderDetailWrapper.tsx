"use client";

import { useRouter } from "next/navigation";
import type { Finding, NormalizedOrder } from "@/lib/contracts";
import { OrderDetailView } from "@/components/views/OrderDetailView";

// Client boundary for the order detail page: it owns navigation and supplies the
// onBack callback to the props-only OrderDetailView. The server page passes the
// already-resolved (serializable) order + findings; routing stays out of the view.
export function OrderDetailWrapper({
  order,
  findings,
}: {
  order: NormalizedOrder;
  findings: Finding[];
}) {
  const router = useRouter();
  return (
    <OrderDetailView
      order={order}
      findings={findings}
      onBack={() => router.push("/ledger")}
    />
  );
}
