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
