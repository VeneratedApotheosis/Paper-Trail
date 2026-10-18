import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectView } from "@/components/views/ConnectView";
import { ReviewView } from "@/components/views/ReviewView";
import { connectViewExampleFixture, connectViewFixture } from "@/components/views/fixtures/connect";
import { reviewViewCheckedFixture, reviewViewEmptyFixture, reviewViewFixture } from "@/components/views/fixtures/review";

// Vitest compiles .tsx with the classic JSX runtime, which needs a global React.
Object.assign(globalThis, { React });

const text = (node: React.ReactElement) =>
  renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("ReviewView", () => {
  it("shows the real queue length, and an 'x of y checked' count only when supplied", () => {
    const without = text(<ReviewView {...reviewViewFixture} />);
    expect(without).toContain("2 to check");
    expect(without).not.toMatch(/\d of \d checked/);
    expect(text(<ReviewView {...reviewViewCheckedFixture} />)).toContain("0 of 2 checked");
  });

  it("keeps the quick-check rule in the copy", () => {
    expect(text(<ReviewView {...reviewViewFixture} />)).toContain("aren't counted in what you're owed until you confirm");
  });

  it("empty state offers Owed to you only with a callback", () => {
    expect(text(<ReviewView {...reviewViewEmptyFixture} />)).toContain("See Owed to you");
    expect(text(<ReviewView {...reviewViewEmptyFixture} onOpenOwed={undefined} />)).not.toContain("See Owed to you");
    expect(text(<ReviewView {...reviewViewEmptyFixture} />)).toContain("All clear");
  });
});

describe("ConnectView", () => {
  it("shows the example card only when supplied, labelled synthetic", () => {
    expect(text(<ConnectView {...connectViewFixture} />)).not.toContain("What you'll see");
    const withExample = text(<ConnectView {...connectViewExampleFixture} />);
    expect(withExample).toContain("What you'll see");
    expect(withExample).toContain("Synthetic example");
    expect(withExample).toContain("$1,774.23");
  });

  it("keeps the read-only scope and the demo label", () => {
    const html = text(<ConnectView {...connectViewFixture} />);
    expect(html).toContain("gmail.readonly");
    expect(html).toContain("Demo data is synthetic");
    expect(html).toContain("PaperTrail will never");
  });
});
