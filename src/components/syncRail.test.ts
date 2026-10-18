import { describe, expect, it } from "vitest";
import { errorChip, errorIntro, stepStates } from "@/components/SyncRail";

describe("stepStates", () => {
  it("claims no running step without live progress", () => {
    expect(stepStates("preview")).toEqual(["ready", "ready", "ready", "ready"]);
    expect(stepStates("syncing", null)).toEqual(["ready", "ready", "ready", "ready"]);
    expect(stepStates("error")).toEqual(["ready", "ready", "ready", "ready"]);
  });

  it("marks steps before the running stage done and later ones pending", () => {
    expect(stepStates("syncing", "listing")).toEqual(["active", "pending", "pending", "pending"]);
    expect(stepStates("syncing", "fetching")).toEqual(["done", "active", "pending", "pending"]);
    expect(stepStates("syncing", "processing")).toEqual(["done", "done", "active", "pending"]);
    expect(stepStates("syncing", "promotions")).toEqual(["done", "done", "done", "active"]);
  });

  it("marks everything done only for a confirmed result", () => {
    expect(stepStates("result")).toEqual(["done", "done", "done", "done"]);
  });
});

describe("error copy", () => {
  it("only says the inbox cannot be read for access errors", () => {
    expect(errorIntro("reconnect")).toContain("until you reconnect Gmail");
    expect(errorIntro("access_denied")).toContain("until you reconnect Gmail");
    expect(errorIntro("timeout")).not.toContain("reconnect");
    expect(errorIntro("failed")).toContain("Nothing in your inbox was changed");
  });

  it("has a short label for every kind", () => {
    expect(errorChip("reconnect")).toBe("Reconnect needed");
    expect(errorChip("already_running")).toBe("Already running");
  });
});
