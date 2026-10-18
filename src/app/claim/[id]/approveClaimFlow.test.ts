import { describe, expect, it, vi } from "vitest";
import type { ClaimApproveResponse, ClaimResponse } from "@/lib/api/types";
import { saveThenApproveClaim, type ApproveClaimSteps } from "./approveClaimFlow";

const edits = { subject: "Refund not received", body: "Edited body", recipient: "support@example.com" };
const approveResponse = {
  mailtoUrl: "mailto:support@example.com?subject=server",
  clipboardText: "Subject: server text",
} as ClaimApproveResponse;
const saveResponse = {} as ClaimResponse;

function steps(overrides: Partial<ApproveClaimSteps> = {}) {
  return {
    save: vi.fn(async () => saveResponse),
    approve: vi.fn(async () => approveResponse),
    copy: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("saveThenApproveClaim", () => {
  it("saves the edits, then approves, then copies the server's clipboardText", async () => {
    const order: string[] = [];
    const s = steps({
      save: vi.fn(async () => (order.push("save"), saveResponse)),
      approve: vi.fn(async () => (order.push("approve"), approveResponse)),
      copy: vi.fn(async () => void order.push("copy")),
    });
    const outcome = await saveThenApproveClaim(edits, s);
    expect(order).toEqual(["save", "approve", "copy"]);
    expect(s.save).toHaveBeenCalledWith(edits);
    expect(s.copy).toHaveBeenCalledWith("Subject: server text");
    expect(outcome).toEqual({ status: "approved", mailtoUrl: approveResponse.mailtoUrl });
  });

  it("does not approve or copy when saving fails", async () => {
    const s = steps({ save: vi.fn(async () => null) });
    expect(await saveThenApproveClaim(edits, s)).toEqual({ status: "save_failed" });
    expect(s.approve).not.toHaveBeenCalled();
    expect(s.copy).not.toHaveBeenCalled();
  });

  it("does not copy or hand out a mailto when approving fails", async () => {
    const s = steps({ approve: vi.fn(async () => null) });
    expect(await saveThenApproveClaim(edits, s)).toEqual({ status: "approve_failed" });
    expect(s.copy).not.toHaveBeenCalled();
  });

  it("reports copy_failed (still approved, with the server mailtoUrl) when the clipboard write rejects", async () => {
    const s = steps({ copy: vi.fn(async () => Promise.reject(new Error("denied"))) });
    expect(await saveThenApproveClaim(edits, s)).toEqual({
      status: "copy_failed",
      mailtoUrl: approveResponse.mailtoUrl,
    });
  });
});
