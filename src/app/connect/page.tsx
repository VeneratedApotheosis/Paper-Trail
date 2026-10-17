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
        <div className="w-full max-w-ledger">
          <ErrorState
            title="This Google account isn't on PaperTrail's test-user list"
            what="PaperTrail is a dev/test app, so Google only lets approved test users connect. The account you chose isn't on the list yet, so access was denied."
            fix="Ask a PaperTrail teammate to add your Google address as a test user, then try again, or explore with synthetic demo data in the meantime."
            actions={
              <>
                <LinkButton href="/connect">Try a different account</LinkButton>
                <LinkButton href="/ledger" variant="secondary">
                  Try demo data
                </LinkButton>
              </>
            }
          />
        </div>
      ) : sp.error === "token_expired" ? (
        <div className="w-full max-w-ledger">
          <TokenExpired reconnectHref="/connect" />
        </div>
      ) : (
        <ConsentExplainer />
      )}
    </main>
  );
}
