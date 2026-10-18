import { afterEach, describe, expect, it } from "vitest";
import { getAccountSyncTimes, resetStore } from "./index";

const STORE_KEY = Symbol.for("papertrail.store");

describe("store data from older code (dev hot reload after git pull)", () => {
  afterEach(() => resetStore());

  it("fills fields added since the data was created instead of crashing", () => {
    const holder = globalThis as unknown as Record<symbol, Record<string, unknown>>;
    resetStore();
    const old = holder[STORE_KEY];
    delete old.accountResults;
    holder[STORE_KEY] = { ...old };

    expect(getAccountSyncTimes()).toEqual({});
  });
});
