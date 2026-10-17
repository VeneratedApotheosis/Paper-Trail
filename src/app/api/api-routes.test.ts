import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorBody,
  AuditResponse,
  DeleteAllResponse,
  FindingResponse,
  LedgerResponse,
  MerchantExcludeResponse,
  OrderResponse,
  PipelineRunResponse,
  UploadResponse,
} from "@/lib/api/types";
import { seedInbox } from "@/lib/demo/seed";
import { resetStore } from "@/lib/store";
import * as audit from "./audit/route";
import * as deleteAllRoute from "./delete-all/route";
import * as demo from "./demo/route";
import * as finding from "./findings/[id]/route";
import * as ledger from "./ledger/route";
import * as exclude from "./merchants/exclude/route";
import * as order from "./orders/[id]/route";
import * as prefilter from "./prefilter/route";
import * as upload from "./upload/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = <T>(response: Response) => response.json() as Promise<T>;
const jsonRequest = (method: string, body: unknown) =>
  new Request("http://localhost/api/merchants/exclude", {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const ORDER_EML = [
  'From: "Northwind Outfitters" <orders@northwind.example>',
  "To: sam@mail.example",
  "Subject: Order confirmation #NW-9001",
  "Date: Wed, 01 Oct 2026 10:00:00 +0000",
  "Message-ID: <nw-9001@northwind.example>",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Thanks for your order #NW-9001.",
  "Rain shell  1  $40.00",
  "Order total: $40.00",
].join("\r\n");

function uploadRequest(files: Array<{ name: string; content: string }>): Request {
  const form = new FormData();
  for (const file of files) form.append("files", new File([file.content], file.name, { type: "message/rfc822" }));
  return new Request("http://localhost/api/upload", { method: "POST", body: form });
}

async function loadDemo(): Promise<PipelineRunResponse> {
  const response = await demo.POST(new Request("http://localhost/api/demo", { method: "POST" }));
  expect(response.status).toBe(200);
  return json<PipelineRunResponse>(response);
}

async function getLedger(): Promise<LedgerResponse> {
  return json<LedgerResponse>(await ledger.GET(new Request("http://localhost/api/ledger", { method: "GET" })));
}

beforeEach(() => resetStore());
afterEach(() => vi.unstubAllEnvs());

describe("demo + ledger routes", () => {
  it("returns an empty ledger before anything is loaded", async () => {
    const body = await getLedger();
    expect(body).toMatchObject({ mode: "empty", asOf: null, orders: [], findings: [], reviewQueue: [] });
    expect(body.summary).toEqual({ currency: "USD", owedTotal: 0, findingCount: 0, excludedCount: 0, excludedTotal: 0 });
    expect(body.labels).toEqual({ demo: "Demo data — synthetic", simulatedPrice: "Simulated price feed", precomputedExtraction: null });
  });

  it("POST /api/demo loads the seed through the pipeline and GET /api/ledger serves it", async () => {
    const run = await loadDemo();
    expect(run).toMatchObject({ mode: "demo", asOf: seedInbox.asOf });
    expect(run.stats.findings).toBe(14);

    const body = await getLedger();
    expect(body.mode).toBe("demo");
    expect(body.findings).toHaveLength(14);
    expect(body.summary.findingCount).toBe(14);
    expect(body.summary.owedTotal).toBeGreaterThan(0);
    expect(body.findings.some((candidate) => candidate.simulated)).toBe(true);
    expect(body.labels.precomputedExtraction).toMatch(/no LLM call/);
  });

  it("DELETE /api/demo clears demo data but keeps the audit log", async () => {
    await loadDemo();
    const response = await demo.DELETE(new Request("http://localhost/api/demo", { method: "DELETE" }));
    expect(await json(response)).toEqual({ mode: "empty" });
    expect((await getLedger()).orders).toEqual([]);
    const entries = (await json<AuditResponse>(await audit.GET(new Request("http://localhost/api/audit", { method: "GET" })))).entries;
    expect(entries[0]).toMatchObject({ type: "delete", detail: "Demo data cleared from the ledger" });
  });
});

describe("order and finding routes", () => {
  it("returns an order with its findings, accepting percent-encoded ids", async () => {
    await loadDemo();
    const { findings } = await getLedger();
    const target = findings[0];
    const response = await order.GET(new Request("http://localhost"), params(encodeURIComponent(target.orderId)));
    expect(response.status).toBe(200);
    const body = await json<OrderResponse>(response);
    expect(body.order.id).toBe(target.orderId);
    expect(body.findings.map((candidate) => candidate.id)).toContain(target.id);

    const findingResponse = await finding.GET(new Request("http://localhost"), params(target.id));
    const findingBody = await json<FindingResponse>(findingResponse);
    expect(findingBody.finding.id).toBe(target.id);
    expect(findingBody.order.id).toBe(target.orderId);
  });

  it("returns 404 { error } for unknown ids and 400 for empty ids", async () => {
    const missing = await order.GET(new Request("http://localhost"), params("order:nope"));
    expect(missing.status).toBe(404);
    expect(await json<ApiErrorBody>(missing)).toEqual({ error: "Order not found" });
    expect((await finding.GET(new Request("http://localhost"), params("nope"))).status).toBe(404);
    expect((await order.GET(new Request("http://localhost"), params(""))).status).toBe(400);
  });
});

describe("merchant exclude route", () => {
  it("hides and restores a merchant across ledger and order routes", async () => {
    await loadDemo();
    const northwind = (await getLedger()).orders.find((candidate) => candidate.merchant.name === "Northwind Outfitters");
    if (!northwind) throw new Error("no Northwind order in seed");

    const excluded = await exclude.POST(jsonRequest("POST", { merchant: "Northwind Outfitters" }));
    expect(await json<MerchantExcludeResponse>(excluded)).toEqual({ excludedMerchants: ["northwind outfitters"] });
    const hidden = await getLedger();
    expect(hidden.orders.some((candidate) => candidate.merchant.name === "Northwind Outfitters")).toBe(false);
    expect(hidden.findings.some((candidate) => candidate.orderId === northwind.id)).toBe(false);
    expect(hidden.excludedMerchants).toEqual(["northwind outfitters"]);
    expect((await order.GET(new Request("http://localhost"), params(northwind.id))).status).toBe(404);

    const restored = await exclude.DELETE(jsonRequest("DELETE", { merchant: "northwind outfitters" }));
    expect(await json<MerchantExcludeResponse>(restored)).toEqual({ excludedMerchants: [] });
    expect((await order.GET(new Request("http://localhost"), params(northwind.id))).status).toBe(200);
  });

  it("rejects invalid bodies with 400 { error }", async () => {
    for (const body of ["not json", {}, { merchant: "   " }, { merchant: 42 }]) {
      const response = await exclude.POST(jsonRequest("POST", body));
      expect(response.status).toBe(400);
      expect(typeof (await json<ApiErrorBody>(response)).error).toBe("string");
    }
  });
});

describe("delete-all + audit routes", () => {
  it("purges everything and leaves a single delete audit record", async () => {
    await loadDemo();
    expect((await json<AuditResponse>(await audit.GET(new Request("http://localhost/api/audit", { method: "GET" })))).entries.length).toBeGreaterThan(2);

    const response = await deleteAllRoute.POST(new Request("http://localhost/api/delete-all", { method: "POST" }));
    const body = await json<DeleteAllResponse>(response);
    expect(body).toMatchObject({ deleted: true, ok: true, revokedToken: false });
    expect(Number.isNaN(Date.parse(body.at))).toBe(false);
    expect(body.purged.findings).toBe(14);

    const after = await getLedger();
    expect(after).toMatchObject({ mode: "empty", orders: [], findings: [] });
    const entries = (await json<AuditResponse>(await audit.GET(new Request("http://localhost/api/audit", { method: "GET" })))).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("delete");
  });

  it("audit entries never contain email bodies", async () => {
    await loadDemo();
    const serialized = JSON.stringify((await json<AuditResponse>(await audit.GET(new Request("http://localhost/api/audit", { method: "GET" })))).entries);
    for (const email of seedInbox.emails) {
      for (const line of email.text.split("\n").map((value) => value.trim()).filter((value) => value.length >= 25)) {
        expect(serialized.includes(line), line).toBe(false);
      }
    }
  });
});

describe("upload route", () => {
  it("parses an .eml upload and routes un-extractable emails to the review queue without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const response = await upload.POST(uploadRequest([{ name: "order.eml", content: ORDER_EML }]));
    expect(response.status).toBe(200);
    const body = await json<UploadResponse>(response);
    expect(body.mode).toBe("upload");
    expect(body.files).toEqual([{ name: "order.eml", emails: 1 }]);
    expect(body.parseErrors).toEqual([]);
    expect(body.stats.emails).toBe(1);

    const ledgerBody = await getLedger();
    expect(ledgerBody.mode).toBe("upload");
    expect(ledgerBody.reviewQueue).toEqual([
      expect.objectContaining({ emailId: "nw-9001@northwind.example", stage: "extract", reason: expect.stringContaining("ANTHROPIC_API_KEY") }),
    ]);
  });

  it("parses .mbox uploads and reports unparseable messages", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const mbox = `From a Wed Oct  1 10:00:00 2026\n${ORDER_EML.replace(/\r\n/g, "\n")}\n\nFrom b Wed Oct  1 10:00:00 2026\nSubject: no sender\n\nbody\n`;
    const body = await json<UploadResponse>(await upload.POST(uploadRequest([{ name: "inbox.mbox", content: mbox }])));
    expect(body.files).toEqual([{ name: "inbox.mbox", emails: 1 }]);
    expect(body.parseErrors).toEqual([{ file: "inbox.mbox", index: 1, reason: "missing From header" }]);
  });

  it("rejects bad uploads with 4xx { error }", async () => {
    const noFiles = await upload.POST(new Request("http://localhost/api/upload", { method: "POST", body: new FormData() }));
    expect(noFiles.status).toBe(400);
    const wrongType = await upload.POST(uploadRequest([{ name: "notes.txt", content: "hi" }]));
    expect(wrongType.status).toBe(400);
    expect((await json<ApiErrorBody>(wrongType)).error).toMatch(/only .eml and .mbox/);
    const notMultipart = await upload.POST(new Request("http://localhost/api/upload", { method: "POST", body: "x" }));
    expect(notMultipart.status).toBe(400);
    const unparseable = await upload.POST(uploadRequest([{ name: "bad.eml", content: "Subject: nothing\n\nbody" }]));
    expect(unparseable.status).toBe(400);
    const tooBig = await upload.POST(uploadRequest([{ name: "big.mbox", content: "x".repeat(5 * 1024 * 1024 + 1) }]));
    expect(tooBig.status).toBe(413);
  });
});

describe("prefilter route", () => {
  it("returns the Gmail query and its description", async () => {
    const body = await json<{ query: string; description: string; windowDays: number }>(await prefilter.GET());
    expect(body.query).toContain("newer_than:90d");
    expect(body.description).toContain(body.query);
    expect(body.windowDays).toBe(90);
  });
});
