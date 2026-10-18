// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMarkEmailNotAboutOrder, useMarkNotPurchase, useRestoreOrder } from "./actions";
import { CACHE_KEYS, resetCache, subscribe } from "./cache";

// Vitest compiles .tsx with the classic JSX runtime, which needs a global React.
Object.assign(globalThis, { React });
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn(async () => Response.json({ summary: { owedTotal: 1 } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  resetCache();
  vi.unstubAllGlobals();
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});

type Actions = { mark: ReturnType<typeof useMarkNotPurchase>; email: ReturnType<typeof useMarkEmailNotAboutOrder>; restore: ReturnType<typeof useRestoreOrder> };
async function mountActions(): Promise<{ current: () => Actions; unmount: () => Promise<void> }> {
  let latest!: Actions;
  function Probe() {
    latest = { mark: useMarkNotPurchase(), email: useMarkEmailNotAboutOrder(), restore: useRestoreOrder() };
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  return { current: () => latest, unmount: () => act(async () => root.unmount()) };
}

describe("not a purchase hooks", () => {
  it("run the request and refresh every mounted cached read (ledger and owed, audit, account)", async () => {
    const loadLedger = vi.fn(async () => "ledger");
    const loadAudit = vi.fn(async () => "audit");
    const unsubscribe = [subscribe(CACHE_KEYS.ledger, () => undefined, loadLedger), subscribe(CACHE_KEYS.audit, () => undefined, loadAudit)];
    await act(async () => { await Promise.resolve(); });
    expect(loadLedger).toHaveBeenCalledTimes(1);

    const actions = await mountActions();
    let result: unknown;
    await act(async () => { result = await actions.current().mark.run("order:x:1"); });
    expect(result).toMatchObject({ summary: { owedTotal: 1 } });
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/order%3Ax%3A1/not-purchase", expect.objectContaining({ method: "POST" }));
    expect(loadLedger).toHaveBeenCalledTimes(2);
    expect(loadAudit).toHaveBeenCalledTimes(2);

    await act(async () => { await actions.current().email.run("order:x:1", "m1"); });
    await act(async () => { await actions.current().restore.run("order:x:1"); });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/orders/order%3Ax%3A1/not-purchase",
      "/api/orders/order%3Ax%3A1/emails/m1/not-about-order",
      "/api/orders/order%3Ax%3A1/restore",
    ]);
    expect(loadLedger).toHaveBeenCalledTimes(4);
    await actions.unmount();
    unsubscribe.forEach((stop) => stop());
  });

  it("reports a refusal as an error message and resolves null without refreshing", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Nothing to undo for this purchase." }, { status: 404 }));
    const loadLedger = vi.fn(async () => "ledger");
    const stop = subscribe(CACHE_KEYS.ledger, () => undefined, loadLedger);
    await act(async () => { await Promise.resolve(); });
    const actions = await mountActions();
    let result: unknown = "unset";
    await act(async () => { result = await actions.current().restore.run("order:x:1"); });
    expect(result).toBeNull();
    expect(actions.current().restore.error).toBe("Nothing to undo for this purchase.");
    expect(loadLedger).toHaveBeenCalledTimes(1);
    await actions.unmount();
    stop();
  });
});
