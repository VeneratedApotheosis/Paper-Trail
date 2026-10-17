import { LinkButton } from "@/components/ui/Button";

// Gmail test-user tokens expire after 7 days. Tell the user plainly and give a
// one-tap re-consent path (wires to the OAuth flow from #3).
export function TokenExpired({ reconnectHref = "/connect" }: { reconnectHref?: string }) {
  return (
    <div className="neu-raised mx-auto max-w-ledger rounded-xl px-8 py-12 text-center">
      <h2 className="font-serif text-2xl text-ink">Your Gmail connection expired</h2>
      <p className="mx-auto mt-3 max-w-md text-base text-ink">
        Google expires read-only access for unverified apps after 7 days. Your data
        is still here. PaperTrail just needs permission to read new receipts again.
      </p>
      <div className="mt-6 flex justify-center">
        <LinkButton href={reconnectHref}>Reconnect Gmail</LinkButton>
      </div>
    </div>
  );
}
