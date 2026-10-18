import { describe, expect, it } from "vitest";
import { absoluteTimeLabel, relativeTimeLabel } from "./timeLabels";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTimeLabel", () => {
  it("says just now under a minute and for future timestamps", () => {
    expect(relativeTimeLabel(ago(10_000), NOW)).toBe("just now");
    expect(relativeTimeLabel(ago(-5 * MINUTE), NOW)).toBe("just now");
  });

  it("counts whole minutes, hours and days", () => {
    expect(relativeTimeLabel(ago(MINUTE), NOW)).toBe("1 minute ago");
    expect(relativeTimeLabel(ago(5 * MINUTE + 30_000), NOW)).toBe("5 minutes ago");
    expect(relativeTimeLabel(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(relativeTimeLabel(ago(3 * HOUR), NOW)).toBe("3 hours ago");
    expect(relativeTimeLabel(ago(DAY), NOW)).toBe("1 day ago");
    expect(relativeTimeLabel(ago(6 * DAY), NOW)).toBe("6 days ago");
  });

  it("falls back to the calendar date after a week", () => {
    expect(relativeTimeLabel("2026-10-01T12:00:00.000Z", NOW)).toBe("Oct 1, 2026");
  });
});

describe("absoluteTimeLabel", () => {
  it("formats date and time in the given time zone", () => {
    expect(absoluteTimeLabel("2026-10-18T01:02:03.000Z", "UTC")).toBe("Oct 18, 2026, 1:02 AM");
  });
});
