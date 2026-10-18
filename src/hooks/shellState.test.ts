import { describe, expect, it } from "vitest";
import { API_LABELS, type LedgerResponse } from "@/lib/api/types";
import {
  DEMO_ACCOUNT,
  GMAIL_CONNECTED_ACCOUNT,
  GMAIL_DISCONNECTED_ACCOUNT,
  UPLOAD_ACCOUNT,
  deriveShellState,
  resolveShellMode,
} from "./shellState";

function ledger(
  mode: LedgerResponse["mode"],
  precomputedExtraction: LedgerResponse["labels"]["precomputedExtraction"] = null,
): Pick<LedgerResponse, "mode" | "labels"> {
  return {
    mode,
    labels: { demo: API_LABELS.demo, simulatedPrice: API_LABELS.simulatedPrice, precomputedExtraction },
  };
}

describe("deriveShellState", () => {
  it("shows nothing while the ledger is unknown and Gmail is not connected", () => {
    expect(deriveShellState(null, null)).toEqual({
      mode: "empty",
      account: undefined,
      demoLabel: undefined,
      precomputedExtractionLabel: undefined,
    });
  });

  it("labels demo mode with the API's demo and precomputed-extraction labels", () => {
    const state = deriveShellState(ledger("demo", API_LABELS.precomputedExtraction), { connected: false });
    expect(state).toEqual({
      mode: "demo",
      account: DEMO_ACCOUNT,
      demoLabel: API_LABELS.demo,
      precomputedExtractionLabel: API_LABELS.precomputedExtraction,
    });
  });

  it("describes uploads as uploaded receipts, never as demo data", () => {
    const state = deriveShellState(ledger("upload"), { connected: true });
    expect(state.mode).toBe("upload");
    expect(state.account).toEqual(UPLOAD_ACCOUNT);
  });

  it("shows Gmail as connected only when the session says so", () => {
    expect(deriveShellState(ledger("gmail"), { connected: true }).account).toEqual(GMAIL_CONNECTED_ACCOUNT);
    expect(deriveShellState(ledger("gmail"), { connected: false }).account).toEqual(GMAIL_DISCONNECTED_ACCOUNT);
    expect(deriveShellState(ledger("empty"), { connected: true }).account).toEqual(GMAIL_CONNECTED_ACCOUNT);
    expect(deriveShellState(ledger("empty"), { connected: false }).account).toBeUndefined();
  });

  it("never names a person", () => {
    for (const account of [DEMO_ACCOUNT, GMAIL_CONNECTED_ACCOUNT, GMAIL_DISCONNECTED_ACCOUNT, UPLOAD_ACCOUNT]) {
      expect(account.name).not.toMatch(/Alex|Song/);
    }
  });
});

describe("resolveShellMode", () => {
  it("uses the shared mode when the page passes no demo prop", () => {
    expect(resolveShellMode("gmail", undefined)).toBe("gmail");
    expect(resolveShellMode("demo", undefined)).toBe("demo");
  });

  it("lets an explicit demo prop win", () => {
    expect(resolveShellMode("empty", true)).toBe("demo");
    expect(resolveShellMode("demo", false)).toBe("empty");
    expect(resolveShellMode("upload", false)).toBe("upload");
  });
});
