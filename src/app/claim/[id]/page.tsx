import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ClaimDraft } from "@/components/ClaimDraft";
import { EmptyState } from "@/components/states";
import { getDraftForFinding, getFinding, getOrder } from "@/lib/mock/data";

// Claim draft sheet (#17 — UI only). `id` is a *finding* id (findings link here
// from the hero FindingCard via /claim/${finding.id}). Data loads here on the
// server from mock data; the editable draft + approve/copy flow lives in the
// <ClaimDraft/> client component. Production drafting is backend (src/lib/claims,
// team-owned): the LLM only writes wording — every number comes from the rule /
// finding (AGENTS.md hard rule #4), and the app never sends email (hard rule #2).
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const finding = getFinding(id);

  if (!finding) {
    return (
      <AppShell>
        <EmptyState
          title="Claim not found"
          actions={
            <Link
              href="/"
              className="neu-raised-sm inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-bold text-teal-deep transition-[box-shadow,transform] active:scale-[0.99]"
            >
              Back to owed
            </Link>
          }
        >
          We couldn&apos;t find a finding with id <code>{id}</code>. It may have been
          resolved or removed.
        </EmptyState>
      </AppShell>
    );
  }

  const order = getOrder(finding.orderId);
  const existingDraft = getDraftForFinding(finding.id);

  return (
    <AppShell>
      <ClaimDraft finding={finding} order={order} existingDraft={existingDraft} />
    </AppShell>
  );
}
