import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorBody,
  AuditResponse,
  ClaimApproveResponse,
  ClaimRegenerateResponse,
  ClaimResponse,
  FindingResponse,
  LedgerResponse,
} from "@/lib/api/types";
import type { Finding } from "@/lib/contracts";
import { loadSeedDemo } from "@/lib/demo";
import { formatMoney } from "@/lib/format";
import { getState, resetStore, setPipelineResult } from "@/lib/store";
import * as audit from "../audit/route";
import * as deleteAllRoute from "../delete-all/route";
import * as demo from "../demo/route";
import * as findingRoute from "../findings/[id]/route";
import * as ledger from "../ledger/route";
import * as exclude from "../merchants/exclude/route";
import * as approve from "./[findingId]/approve/route";
import * as claim from "./[findingId]/route";

const params = (findingId: string) => ({ params: Promise.resolve({ findingId: encodeURIComponent(findingId) }) });
const json = <T>(response: Response) => response.json() as Promise<T>;
const bodyRequest = (method: string, body?: unknown) =>
  new Request("http://localhost/api/claims/x", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const getRequest = () => new Request("http://localhost/api/claims/x");

async function loadDemoLedger(): Promise<LedgerResponse> {
  expect((await demo.POST(new Request("http://localhost/api/demo", { method: "POST" }))).status).toBe(200);
  return json<LedgerResponse>(await ledger.GET(new Request("http://localhost/api/ledger", { method: "GET" })));
}

/** Seed refund_overdue finding for Northwind order NW-48213 (expected refund $111.24). */
function northwindRefund(ledgerBody: LedgerResponse): Finding {
  const order = ledgerBody.orders.find((candidate) => candidate.orderRef === "NW-48213");
  const finding = ledgerBody.findings.find((candidate) => candidate.orderId === order?.id && candidate.kind === "refund_overdue");
  if (!finding) throw new Error("seed has no NW-48213 refund_overdue finding");
  return finding;
}

async function getClaim(findingId: string): Promise<Response> {
  return claim.GET(getRequest(), params(findingId));
}

async function statusesFor(findingId: string): Promise<number[]> {
  return [
    (await getClaim(findingId)).status,
    (await claim.POST(bodyRequest("POST", {}), params(findingId))).status,
    (await claim.PUT(bodyRequest("PUT", { subject: "s", body: "b", recipient: "" }), params(findingId))).status,
    (await approve.POST(bodyRequest("POST"), params(findingId))).status,
  ];
}

beforeEach(() => resetStore());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/claims/:findingId", () => {
  it("generates a template draft from the seed finding's numbers and stores it", async () => {
    const finding = northwindRefund(await loadDemoLedger());
    const response = await getClaim(finding.id);
    expect(response.status).toBe(200);
    const body = await json<ClaimResponse>(response);

    expect(body.finding.id).toBe(finding.id);
    expect(body.order.id).toBe(finding.orderId);
    expect(body.draft).toMatchObject({ id: `draft:${finding.id}`, findingId: finding.id, kind: "refund_overdue", edited: false, rephrased: false });
    expect(body.draft.approvedAt).toBeUndefined();
    const amount = formatMoney(finding.amountAtStake, finding.currency);
    expect(amount).toBe("$111.24");
    expect(body.draft.body).toContain(amount);
    expect(body.draft.body).toContain("NW-48213");
    expect(body.draft.facts).toContainEqual({ label: "Expected refund", value: amount });
    expect(getState().drafts.map((draft) => draft.id)).toEqual([body.draft.id]);

    const again = await json<ClaimResponse>(await getClaim(finding.id));
    expect(again.draft).toEqual(body.draft);
  });

  it("returns 404 for unknown findings and for excluded merchants, 400 for an empty id", async () => {
    const finding = northwindRefund(await loadDemoLedger());
    const missing = await getClaim("refund_overdue:order:nope");
    expect(missing.status).toBe(404);
    expect(await json<ApiErrorBody>(missing)).toEqual({ error: "Finding not found" });
    expect((await claim.GET(getRequest(), { params: Promise.resolve({ findingId: "" }) })).status).toBe(400);

    expect((await getClaim(finding.id)).status).toBe(200);
    await exclude.POST(bodyRequest("POST", { merchant: "Northwind Outfitters" }));
    expect(await statusesFor(finding.id)).toEqual([404, 404, 404, 404]);
  });

  it("returns 422 with the draftClaim reason for findings without a claim template", async () => {
    const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
    const base = seed.findings[0];
    const rewardsGap: Finding = { ...base, id: `rewards_gap:${base.orderId}`, kind: "rewards_gap" };
    setPipelineResult("demo", seed.asOf, { ...seed, findings: [...seed.findings, rewardsGap] });

    const response = await getClaim(rewardsGap.id);
    expect(response.status).toBe(422);
    expect(await json<ApiErrorBody>(response)).toEqual({
      error: "Claim drafts are not supported for rewards_gap findings.",
      details: { reason: "unsupported_kind" },
    });
    expect((await claim.POST(bodyRequest("POST"), params(rewardsGap.id))).status).toBe(422);
    expect(getState().drafts).toEqual([]);
  });
});

describe("PUT /api/claims/:findingId", () => {
  it("saves edits, keeps facts, and warns when a cited number was changed", async () => {
    const finding = northwindRefund(await loadDemoLedger());
    const original = (await json<ClaimResponse>(await getClaim(finding.id))).draft;

    const changedBody = original.body.replace("$111.24", "$11.24");
    const response = await claim.PUT(
      bodyRequest("PUT", { subject: "Where is my refund?", body: changedBody, recipient: "help@northwind.example" }),
      params(finding.id),
    );
    expect(response.status).toBe(200);
    const edited = (await json<ClaimResponse>(response)).draft;
    expect(edited).toMatchObject({ subject: "Where is my refund?", body: changedBody, recipient: "help@northwind.example", edited: true });
    expect(edited.facts).toEqual(original.facts);
    expect(edited.warnings.slice(0, original.warnings.length)).toEqual(original.warnings);
    expect(edited.warnings).toContain("Edited body no longer contains: Expected refund ($111.24)");
    expect((await json<ClaimResponse>(await getClaim(finding.id))).draft).toEqual(edited);

    const restored = await json<ClaimResponse>(
      await claim.PUT(bodyRequest("PUT", { subject: original.subject, body: original.body, recipient: "" }), params(finding.id)),
    );
    expect(restored.draft.warnings).toEqual(original.warnings);
    expect(restored.draft.edited).toBe(true);
  });

  it("rejects invalid edit bodies with 400 { error }", async () => {
    const finding = northwindRefund(await loadDemoLedger());
    const invalid = [
      "not json",
      {},
      { subject: "", body: "b", recipient: "" },
      { subject: "s", body: "b", recipient: "not an email" },
      { subject: "s", body: "x".repeat(10_001), recipient: "" },
    ];
    for (const body of invalid) {
      const response = await claim.PUT(bodyRequest("PUT", body), params(finding.id));
      expect(response.status).toBe(400);
      expect(typeof (await json<ApiErrorBody>(response)).error).toBe("string");
    }
  });
});

describe("POST /api/claims/:findingId (regenerate)", () => {
  it("regenerates from the template without a key, discarding edits, with no network call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const finding = northwindRefund(await loadDemoLedger());
    const original = (await json<ClaimResponse>(await getClaim(finding.id))).draft;
    await claim.PUT(bodyRequest("PUT", { subject: "edited", body: "edited body", recipient: "" }), params(finding.id));

    const response = await claim.POST(
      bodyRequest("POST", { rephrase: true, supportEmail: "refunds@northwind.example", profileName: "Sam" }),
      params(finding.id),
    );
    expect(response.status).toBe(200);
    const body = await json<ClaimRegenerateResponse>(response);
    expect(body.rephrased).toBe(false);
    expect(body.reason).toMatch(/ANTHROPIC_API_KEY is not set/);
    expect(body.draft).toMatchObject({
      subject: original.subject,
      body: original.body,
      recipient: "refunds@northwind.example",
      recipientVerified: true,
      edited: false,
      rephrased: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    const defaults = await json<ClaimRegenerateResponse>(await claim.POST(bodyRequest("POST"), params(finding.id)));
    expect(defaults).toMatchObject({ rephrased: false, reason: expect.stringMatching(/not requested/) });
    expect(defaults.draft.recipient).toBe(original.recipient);
    expect((await claim.POST(bodyRequest("POST", { rephrase: "yes" }), params(finding.id))).status).toBe(400);
  });

  it("rephrases with the LLM when a key is set, audits the call, and never returns the key", async () => {
    const key = "sk-test-claims-route-key";
    vi.stubEnv("ANTHROPIC_API_KEY", key);
    const finding = northwindRefund(await loadDemoLedger());
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const content = request.messages[0].content.split("Email body to reword:\n")[1];
      return Response.json({
        model: "claude-test",
        content: [{ type: "tool_use", name: "submit_rephrased_claim", input: { body: content.replace("Hello", "Hi") } }],
        usage: { input_tokens: 120, output_tokens: 80 },
      });
    });

    const response = await claim.POST(bodyRequest("POST", { rephrase: true }), params(finding.id));
    const text = await response.text();
    expect(text).not.toContain(key);
    const body = JSON.parse(text) as ClaimRegenerateResponse;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(body.rephrased).toBe(true);
    expect(body.reason).toBeUndefined();
    expect(body.draft.rephrased).toBe(true);
    expect(body.draft.body.startsWith("Hi Northwind Outfitters")).toBe(true);
    expect(body.draft.body).toContain("$111.24");

    const entries = (await json<AuditResponse>(await audit.GET(new Request("http://localhost/api/audit", { method: "GET" })))).entries;
    expect(entries[0]).toMatchObject({ type: "llm_call", model: "claude-test" });
    expect(entries[0].detail).toContain(finding.id);
    expect(JSON.stringify(entries)).not.toContain(key);
  });
});

describe("POST /api/claims/:findingId/approve", () => {
  it("sets approvedAt, marks the finding drafted, audits without body text, and returns the hand-off", async () => {
    const finding = northwindRefund(await loadDemoLedger());
    const draft = (await json<ClaimResponse>(await getClaim(finding.id))).draft;

    const response = await approve.POST(bodyRequest("POST"), params(finding.id));
    expect(response.status).toBe(200);
    const body = await json<ClaimApproveResponse>(response);
    expect(Number.isNaN(Date.parse(body.draft.approvedAt ?? ""))).toBe(false);
    expect(body.draft).toMatchObject({ id: draft.id, body: draft.body, subject: draft.subject });
    expect(body.mailtoUrl.startsWith(`mailto:${draft.recipient}?subject=`)).toBe(true);
    expect(body.clipboardText).toBe(`Subject: ${draft.subject}\n\n${draft.body}`);

    const findingBody = await json<FindingResponse>(await findingRoute.GET(getRequest(), { params: Promise.resolve({ id: finding.id }) }));
    expect(findingBody.finding.status).toBe("drafted");
    expect((await json<ClaimResponse>(await getClaim(finding.id))).draft.approvedAt).toBe(body.draft.approvedAt);

    const entries = (await json<AuditResponse>(await audit.GET(new Request("http://localhost/api/audit", { method: "GET" })))).entries;
    const approval = entries[0];
    expect(approval.type).toBe("approval");
    expect(approval.detail).toContain(finding.id);
    expect(approval.detail).toContain("nothing sent");
    for (const line of [draft.subject, ...draft.body.split("\n").filter((value) => value.trim().length >= 20)]) {
      expect(approval.detail.includes(line), line).toBe(false);
    }
    expect(approval.detail).not.toContain("$111.24");
  });

  it("refuses to approve before a draft exists, and edits clear an earlier approval", async () => {
    const finding = northwindRefund(await loadDemoLedger());
    const early = await approve.POST(bodyRequest("POST"), params(finding.id));
    expect(early.status).toBe(409);
    expect(getState().audit.some((entry) => entry.type === "approval")).toBe(false);

    const draft = (await json<ClaimResponse>(await getClaim(finding.id))).draft;
    await approve.POST(bodyRequest("POST"), params(finding.id));
    const edited = await json<ClaimResponse>(
      await claim.PUT(bodyRequest("PUT", { subject: draft.subject, body: `${draft.body}\nP.S.`, recipient: draft.recipient }), params(finding.id)),
    );
    expect(edited.draft.approvedAt).toBeUndefined();
  });
});

describe("delete-all", () => {
  it("makes every claims route 404 afterwards", async () => {
    const finding = northwindRefund(await loadDemoLedger());
    expect((await getClaim(finding.id)).status).toBe(200);
    await deleteAllRoute.POST(new Request("http://localhost/api/delete-all", { method: "POST" }));
    expect(await statusesFor(finding.id)).toEqual([404, 404, 404, 404]);
    expect(getState().drafts).toEqual([]);
  });
});
