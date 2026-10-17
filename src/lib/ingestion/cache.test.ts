import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Extraction } from "@/lib/contracts";
import { createFileCache, createMemoryCache } from "./cache";

// Synthetic extraction for a fictional store.
const EXTRACTION: Extraction = {
  emailId: "m-nw-1001",
  class: "order",
  fields: {
    merchant: "Northwind Outfitters",
    orderRef: "NW-1001",
    date: "2026-09-01",
    currency: "USD",
    lineItems: [{ name: "Trail Runner", qty: 1, unitPrice: 129.99 }],
    totals: { total: 140.39 },
  },
  confidence: { merchant: 0.97, orderRef: 0.99 },
  evidence: { orderRef: "Order #NW-1001" },
  confMin: 0.97,
  model: "fake-model",
  cached: false,
};

const tempDirs: string[] = [];
function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "pt-cache-"));
  tempDirs.push(dir);
  return join(dir, "nested", "extractions.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("createMemoryCache", () => {
  it("stores and returns extractions by textHash", () => {
    const cache = createMemoryCache();
    expect(cache.get("hash-1")).toBeUndefined();
    cache.set("hash-1", EXTRACTION);
    expect(cache.get("hash-1")).toEqual(EXTRACTION);
  });
});

describe("createFileCache", () => {
  it("persists entries to JSON and reloads them in a new instance", () => {
    const path = tempPath();
    createFileCache(path).set("hash-1", EXTRACTION);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ "hash-1": EXTRACTION });
    expect(createFileCache(path).get("hash-1")).toEqual(EXTRACTION);
  });

  it("returns undefined when the file does not exist yet", () => {
    expect(createFileCache(tempPath()).get("hash-1")).toBeUndefined();
  });

  it("ignores entries that no longer match ExtractionSchema", () => {
    const path = tempPath();
    createFileCache(path).set("hash-1", EXTRACTION);
    const stored = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...stored, "hash-bad": { emailId: 1 } }));

    const cache = createFileCache(path);
    expect(cache.get("hash-1")).toEqual(EXTRACTION);
    expect(cache.get("hash-bad")).toBeUndefined();
  });
});
