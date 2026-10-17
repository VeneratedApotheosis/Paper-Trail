/** Claim drafts (issue #32): deterministic templates, optional fact-checked LLM rephrase, copy/mailto hand-off. */
export {
  claimClosing,
  draftClaim,
  formatClaimDate,
  RETURN_ON_SITE_NOTE,
  SIMULATED_PRICE_WARNING,
} from "./draft";
export type {
  ClaimDraft,
  ClaimDraftErrorReason,
  ClaimDraftResult,
  ClaimFact,
  ClaimKind,
  DraftClaimOptions,
} from "./draft";
export { factCheckRephrase, REPHRASE_TOOL, rephraseDraft } from "./rephrase";
export type { RephraseAuditEntry, RephraseDeps, RephraseResult } from "./rephrase";
export { clipboardText, mailtoUrl } from "./mailto";
