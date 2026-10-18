import { mailtoUrl } from "@/lib/claims/mailto";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/states";
import { LinkButton } from "@/components/ui/Button";
import { getClaimForRequest, getLedgerForRequest } from "@/lib/api/server";
import { API_LABELS } from "@/lib/api/types";
import { ClaimWrapper } from "./ClaimWrapper.client";

// Thin server wrapper (#67): `id` is a finding id. getClaimForRequest returns the stored draft (or stores a fresh
// template draft, like GET /api/claims/:findingId) from the request's account store. params.id arrives still
// percent-encoded (real ids contain ':'); the helper decodes it once with safeDecode, so it is passed as is.
// Every number in the draft comes from the finding (hard rule 4); approving never sends anything (hard rule 2).
export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opened = await getClaimForRequest(id);
  if (!opened.ok && opened.reason === "not_found") notFound();
  const { mode } = await getLedgerForRequest();
  const demo = mode === "demo";

  if (!opened.ok) {
    // 422 cases: no claim template for this finding kind (e.g. rewards_gap) or a finding the template can't use.
    return (
      <AppShell demo={demo}>
        <EmptyState
          title={opened.reason === "unsupported_kind" ? "No claim letter for this finding" : "Couldn't draft this claim"}
          actions={
            <LinkButton href="/" variant="secondary">
              Back to owed
            </LinkButton>
          }
        >
          {opened.message}
        </EmptyState>
      </AppShell>
    );
  }

  return <ClaimWrapper claim={opened.claim} simulatedLabel={API_LABELS.simulatedPrice} demo={demo} initialMailtoUrl={opened.claim.draft.approvedAt ? mailtoUrl(opened.claim.draft) : null} />;
}
