import { expect, it } from "vitest";
import { createGmailProgressStore } from "./progress";

it("isolates accounts and returns snapshots without mutable shared references", () => {
  const store = createGmailProgressStore();
  const run = store.begin("synthetic-one");
  run.update({ stage: "fetching", fetched: 1, total: 3, skipped: 1 });
  const value = store.read("synthetic-one");
  expect(value).toEqual({ stage: "fetching", fetched: 1, total: 3, skipped: 1 });
  value.fetched = 999;
  expect(store.read("synthetic-one").fetched).toBe(1);
  expect(store.read("synthetic-two").stage).toBe("idle");
  run.complete();
  expect(store.read("synthetic-one").stage).toBe("complete");
});
it("clears expired entries without polling extending their retention", () => {
  let now = 1000;
  const store = createGmailProgressStore(() => now);
  const run = store.begin("synthetic");
  now += 14 * 60000;
  expect(store.read("synthetic").stage).toBe("listing");
  now += 60000;
  expect(store.read("synthetic").stage).toBe("idle");
  run.fail();
  expect(store.read("synthetic").stage).toBe("idle");
});
it("bounds retained entries and ignores callbacks from superseded runs", () => {
  const store = createGmailProgressStore();
  const old = store.begin("synthetic");
  const current = store.begin("synthetic");
  old.fail();
  expect(store.read("synthetic").stage).toBe("listing");
  current.fail();
  expect(store.read("synthetic").stage).toBe("failed");
  for (let i = 0; i < 1000; i++) store.begin(`synthetic-${i}`).complete();
  expect(store.read("synthetic").stage).toBe("idle");
  expect(store.read("synthetic-999").stage).toBe("complete");
});
it("reports each account of a multi-account sync and sums them at the top level", () => {
  const store = createGmailProgressStore();
  const run = store.begin("synthetic");
  const first = run.forAccount("acct-a", "a@example.test");
  const second = run.forAccount("acct-b", null);
  expect(store.read("synthetic")).toEqual({ stage: "listing", fetched: 0, total: null, skipped: 0, accounts: [
    { accountId: "acct-a", mailbox: "a@example.test", stage: "idle", fetched: 0, total: null },
    { accountId: "acct-b", mailbox: null, stage: "idle", fetched: 0, total: null },
  ] });
  first.update({ stage: "fetching", fetched: 1, total: 3, skipped: 1 });
  expect(store.read("synthetic")).toMatchObject({ stage: "fetching", fetched: 1, total: null, skipped: 1 });
  first.complete();
  second.update({ stage: "processing", fetched: 2, total: 2, skipped: 0 });
  const value = store.read("synthetic");
  expect(value).toMatchObject({ stage: "processing", fetched: 3, total: 5, skipped: 1 });
  value.accounts![0].fetched = 999; // snapshots are copies
  expect(store.read("synthetic").accounts![0].fetched).toBe(1);
  second.fail();
  run.complete();
  expect(store.read("synthetic").stage).toBe("complete");
  expect(store.read("synthetic").accounts!.map(account => account.stage)).toEqual(["complete", "failed"]);
});
