import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/states";
import { OrderDetailWrapper } from "./OrderDetailWrapper";
import { findings, getOrder } from "@/lib/mock/data";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = getOrder(id);

  if (!order) {
    return (
      <AppShell>
        <EmptyState
          title="Order not found"
          actions={
            <Link
              href="/ledger"
              className="neu-raised-sm rounded-sm px-4 py-2 text-sm font-bold text-ink-muted transition-shadow hover:text-ink"
            >
              Back to ledger
            </Link>
          }
        >
          We couldn&apos;t find an order with id <code>{id}</code>. It may have been removed.
        </EmptyState>
      </AppShell>
    );
  }

  const orderFindings = findings.filter((f) => f.orderId === order.id);

  return <OrderDetailWrapper order={order} findings={orderFindings} />;
}
