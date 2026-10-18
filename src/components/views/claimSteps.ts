import type { Finding } from "@/lib/contracts";

// The four "Your steps" on the claim page. Pure so it can be tested: the state of each step comes only from what the
// server confirmed (approved, and whether the copy worked), never from a click that has not come back yet.
export type ClaimStepState = "done" | "current" | "todo";

export interface ClaimStep {
  title: string;
  hint: string;
  state: ClaimStepState;
}

export interface ClaimStepsInput {
  /** True only once the server confirmed the approval and the draft has no unsaved edits. */
  approved: boolean;
  copyStatus: "idle" | "copied" | "failed";
  findingStatus: Finding["status"];
}

export function claimSteps({ approved, copyStatus, findingStatus }: ClaimStepsInput): ClaimStep[] {
  const resolved = findingStatus === "resolved";
  const copied = approved && copyStatus === "copied";

  const approve: ClaimStepState = approved || resolved ? "done" : "current";
  const copy: ClaimStepState = resolved || copied ? "done" : approved ? "current" : "todo";
  const send: ClaimStepState = resolved ? "done" : copied ? "current" : "todo";
  const resolve: ClaimStepState = resolved ? "done" : "todo";

  return [
    { title: "Approve the draft", hint: "Check the address and wording", state: approve },
    {
      title: "Copy it",
      hint:
        approved && copyStatus === "failed"
          ? "The copy did not work. Use Copy again"
          : approved && !copied
            ? "Not copied yet. Use Copy again"
            : "Done for you when you approve",
      state: copy,
    },
    { title: "Send it yourself", hint: "From your own mail app", state: send },
    { title: "Mark resolved", hint: "When the money arrives", state: resolve },
  ];
}
