import { ConsentExplainer } from "@/components/ConsentExplainer";
import { ErrorState, TokenExpired } from "@/components/states";
import { LinkButton } from "@/components/ui/Button";

// Pre-auth entry screen (issue #24). Server component: reads `searchParams`
// (a Promise in Next 15) to branch on OAuth error outcomes. No <AppShell> here —
// the nav assumes a connected session — so this renders a standalone centered
// layout using the #9 design tokens.
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="min-h-screen bg-paper px-6 py-16 sm:py-24">
      <div className="mx-auto max-w-ledger space-y-10">
        {sp.error === "access_denied" ? (
          <ErrorState
            title="This Google account isn't on PaperTrail's test-user list"
            what="PaperTrail is a dev/test app, so Google only lets approved test users connect. The account you chose isn't on the list yet, so access was denied."
            fix="Ask a PaperTrail teammate to add your Google address as a test user, then try again — or explore with synthetic demo data in the meantime."
            actions={
              <>
                <LinkButton href="/connect">Try a different account</LinkButton>
                <LinkButton href="/ledger" variant="secondary">
                  Try demo data
                </LinkButton>
              </>
            }
          />
        ) : sp.error === "token_expired" ? (
          <TokenExpired reconnectHref="/connect" />
        ) : (
          <ConsentExplainer />
        )}
      </div>
    </main>
  );
}
