import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/states";
import { LinkButton } from "@/components/ui/Button";

// notFound() from page.tsx: unknown, excluded or deleted finding id.
export default function ClaimNotFound() {
  return (
    <AppShell>
      <EmptyState
        title="Claim not found"
        actions={
          <LinkButton href="/" variant="secondary">
            Back to owed
          </LinkButton>
        }
      >
        We couldn&apos;t find this finding. It may have been removed, or its merchant excluded.
      </EmptyState>
    </AppShell>
  );
}
