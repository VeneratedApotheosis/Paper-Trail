import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as deleteAll } from "@/app/api/delete-all/route";
import { GET as ledger } from "@/app/api/ledger/route";
import { POST as markPromotion } from "@/app/api/quality/skipped/[emailId]/promotion/route";
import { GET as skipped } from "@/app/api/quality/skipped/route";
import { POST as upload } from "@/app/api/upload/route";
import { createLabelStore, setLabelStore, type LabelStore } from "@/lib/quality/labels";
import { listPromotions } from "@/lib/promotions/state";
import { resetStore, withStoreScope } from "@/lib/store";
import type { PromotionsResponse } from "@/lib/api/types";
import { GET as promotions } from "./route";

/** Synthetic promo emails, dated "today" so their end dates are still in the future when the test runs. */
const today = new Date();
const day = (offsetDays: number) => new Date(today.getTime() + offsetDays * 86_400_000);
const rfc = (date: Date) => date.toUTCString().replace("GMT", "+0000");
const monthDay = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function eml(id: string, from: string, subject: string, body: string, date = today) {
  return `From: ${from}
To: Sam Rivera <sam.rivera@mail.example>
Subject: ${subject}
Date: ${rfc(date)}
Message-ID: <${id}@edge.example>
Content-Type: text/plain; charset=utf-8

${body}
Unsubscribe from promotional email any time.
`;
}
const FALL20 = eml("fall20", '"Lumen Beauty" <offers@e.lumenbeauty.example>', "Fall into savings", `Take 20% off everything. Use code FALL20 at checkout. Sale ends ${monthDay(day(5))}.`);
const ULTA_LIKE = eml("ulta", '"Northwind Outfitters" <deals@northwind.example>', "Ends tomorrow! Get $10 off your $40 order when you pick it up at the store", "Show this email in store.");
const NEWSLETTER = eml("news", '"The Oakhaven Journal" <journal@oakhaven.example>', "Five ways to layer textures", "This month in the Journal: five ways to layer textures.");
const EXPIRED = eml("old", '"Spring Co" <deals@springco.example>', "Spring sale", `Take 10% off with code SPRING10. Ends ${monthDay(day(-40))}.`, day(-45));

function uploadRequest(files: Array<{ name: string; content: string }>) {
  const form = new FormData();
  for (const file of files) form.append("files", new File([file.content], file.name));
  return new Request("http://localhost/api/upload", { method: "POST", body: form });
}
const get = (query = "") => promotions(new Request(`http://localhost/api/promotions${query}`));
const json = async <T,>(response: Response) => (await response.json()) as T;

let labels: LabelStore;
beforeEach(() => {
  resetStore(); labels = createLabelStore(":memory:"); setLabelStore(labels);
  vi.stubEnv("PROMO_LLM_LIMIT", "0"); // rules only: no Claude call
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});
afterEach(() => { setLabelStore(undefined); resetStore(); vi.unstubAllEnvs(); });

describe("GET /api/promotions", () => {
  it("lists the promotions of an upload, soonest end first, expired hidden by default", async () => {
    const uploaded = await upload(uploadRequest([FALL20, ULTA_LIKE, NEWSLETTER, EXPIRED].map((content, index) => ({ name: `m${index}.eml`, content }))));
    expect(uploaded.status).toBe(200);
    const body = await json<PromotionsResponse>(await get());
    expect(body.promotions.map((promotion) => promotion.store)).toEqual(["Northwind Outfitters", "Lumen Beauty"]);
    expect(body.promotions[0]).toMatchObject({ headline: "$10 off a $40 pickup order", channel: "in_store", source: "rules" });
    expect(body.promotions[1]).toMatchObject({ codes: ["FALL20"], discount: { kind: "percent", value: 20 } });
    expect(body).toMatchObject({ total: 2, expiredHidden: 1, enriching: false });
    expect(Date.parse(body.asOf)).toBeGreaterThan(Date.now() - 60_000);

    const all = await json<PromotionsResponse>(await get("?include=expired"));
    expect(all.total).toBe(3);
    expect(all.expiredHidden).toBe(0);
    expect(all.promotions.at(-1)?.codes).toEqual(["SPRING10"]);
  });

  it("never touches the owed total or the ledger", async () => {
    await upload(uploadRequest([FALL20, ULTA_LIKE].map((content, index) => ({ name: `m${index}.eml`, content }))));
    const body = await json<{ orders: unknown[]; findings: unknown[]; summary: { owedTotal?: number } }>(await ledger(new Request("http://localhost/api/ledger")));
    expect(body.orders).toEqual([]);
    expect(body.findings).toEqual([]);
  });

  it("keeps each profile's promotions apart and delete-all clears them", async () => {
    await upload(uploadRequest([{ name: "fall20.eml", content: FALL20 }]));
    expect((await json<PromotionsResponse>(await get())).total).toBe(1);
    // Another profile's scope has its own (empty) list.
    expect(withStoreScope("profile-b", () => listPromotions().total)).toBe(0);
    expect((await json<PromotionsResponse>(await get())).total).toBe(1);

    const deleted = await deleteAll(new Request("http://localhost/api/delete-all", { method: "POST", headers: { origin: "http://localhost" } }));
    expect(deleted.status).toBe(200);
    expect((await json<PromotionsResponse>(await get())).total).toBe(0);
  });
});

describe("POST /api/quality/skipped/:emailId/promotion", () => {
  const params = (emailId: string) => ({ params: Promise.resolve({ emailId }) });
  const post = (emailId: string) => markPromotion(new Request(`http://localhost/api/quality/skipped/${emailId}/promotion`, { method: "POST" }), params(emailId));

  it("lists a skipped email as a promotion, saves a label and removes it from the skipped list", async () => {
    await upload(uploadRequest([{ name: "news.eml", content: NEWSLETTER }]));
    const list = await json<{ skipped: Array<{ emailId: string }> }>(await skipped(new Request("http://localhost/api/quality/skipped")));
    expect(list.skipped).toHaveLength(1);
    const emailId = list.skipped[0].emailId;
    expect((await get()).status).toBe(200);
    expect((await json<PromotionsResponse>(await get())).total).toBe(0);

    const response = await post(encodeURIComponent(emailId));
    expect(response.status).toBe(200);
    expect(await json<{ promotion: { store: string }; labeled: boolean }>(response)).toMatchObject({ labeled: true, promotion: { store: "The Oakhaven Journal" } });
    expect(labels.get("anonymous", emailId)).toMatchObject({ class: "marketing", source: "feedback" });
    expect((await json<PromotionsResponse>(await get())).total).toBe(1);
    expect((await json<{ total: number }>(await skipped(new Request("http://localhost/api/quality/skipped")))).total).toBe(0);
  });

  it("answers 404 for an email that is not skipped and 403 for a cross-site request", async () => {
    expect((await post("nope")).status).toBe(404);
    const crossSite = await markPromotion(new Request("http://localhost/api/quality/skipped/x/promotion", { method: "POST", headers: { origin: "https://evil.example" } }), params("x"));
    expect(crossSite.status).toBe(403);
  });
});
