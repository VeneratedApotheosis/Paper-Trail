import { ConsentExplainer } from "@/components/ConsentExplainer";
import { ErrorState, TokenExpired } from "@/components/states";
import { LinkButton } from "@/components/ui/Button";

// Pre-auth entry screen (issue #24). Server component: reads `searchParams`
// (a Promise in Next 15) to branch on OAuth error outcomes. No AppShell here:
// the nav assumes a connected session, so this renders a standalone centered
// neumorphic layout on the paper surface.
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-16 sm:py-20">
      {sp.error === "access_denied" ? (
        <ErrorState
          title="Gmail wasn't connected"
          what="Access was denied. You may have declined the consent screen, or this account may not be on PaperTrail's approved test-user list yet."
          fix="Try again, or ask a teammate to add you as a test user, or explore with synthetic demo data in the meantime."
          actions={
            <>
              <LinkButton href="/connect">Try again</LinkButton>
              <LinkButton href="/ledger" variant="secondary">
                Try demo data
              </LinkButton>
            </>
          }
        />
      ) : sp.error === "token_expired" ? (
        <TokenExpired reconnectHref="/connect" />
      ) : sp.error ? (
        <ErrorState
          title="Couldn't complete sign-in"
          what="Please try again."
          actions={
            <>
              <LinkButton href="/connect">Try again</LinkButton>
              <LinkButton href="/ledger" variant="secondary">
                Try demo data
              </LinkButton>
            </>
          }
        />
      ) : (
        <ConsentExplainer />
      )}
    </main>
  );
}
