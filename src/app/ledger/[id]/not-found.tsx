import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/states";
import { LinkButton } from "@/components/ui/Button";

// notFound() from page.tsx: unknown, excluded or deleted order id.
export default function OrderNotFound() {
  return (
    <AppShell>
      <EmptyState
        title="Order not found"
        actions={
          <LinkButton href="/ledger" variant="secondary">
            Back to ledger
          </LinkButton>
        }
      >
        We couldn&apos;t find this order. It may have been removed, or its merchant excluded.
      </EmptyState>
    </AppShell>
  );
}
