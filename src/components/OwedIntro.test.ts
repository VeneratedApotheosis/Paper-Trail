import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfidenceChip, CONFIDENCE_EXPLAINER } from "./ConfidenceChip";
import { OwedIntro } from "./OwedIntro";

// vitest compiles .tsx with the classic JSX runtime (tsconfig says "preserve"), which expects a global React.
(globalThis as { React?: typeof React }).React = React;

const noop = () => {};

describe("OwedIntro", () => {
  const html = renderToStaticMarkup(createElement(OwedIntro, { onConnectGmail: noop, onLoadDemo: noop }));

  it("explains the three steps in plain words", () => {
    expect(html).toContain("We read your receipt emails (read-only).");
    expect(html).toContain(
      "We find money you can get back: late refunds, closing return windows, price drops.",
    );
    expect(html).toContain("You approve a claim email and send it yourself. We never send anything.");
  });

  it("offers Connect Gmail and Try demo data", () => {
    expect(html).toContain("Connect Gmail");
    expect(html).toContain("Try demo data");
  });

  it("shows only the choices it was given", () => {
    const demoOnly = renderToStaticMarkup(createElement(OwedIntro, { onLoadDemo: noop }));
    expect(demoOnly).not.toContain("Connect Gmail");
    expect(demoOnly).toContain("Try demo data");
  });

  it("avoids the old jargon", () => {
    const visibleText = html.replace(/<[^>]+>/g, " ");
    expect(visibleText).not.toMatch(/ledger|findings|maybe|confidence/i);
  });
});

describe("ConfidenceChip", () => {
  it("shows a plain label with the exact percent in the tip, not a bare percentage chip", () => {
    const html = renderToStaticMarkup(createElement(ConfidenceChip, { confidence: 0.62 }));
    expect(html).toContain("Needs a quick check");
    expect(html).toContain("Our confidence in this read: 62%");
    expect(html).toContain("aria-describedby");
    expect(html).toContain("hidden");
    expect(html).not.toMatch(/62% sure|confidence<\/span>/);
  });

  it("uses the shared explainer text", () => {
    expect(CONFIDENCE_EXPLAINER).toContain("not the chance of getting paid");
    expect(CONFIDENCE_EXPLAINER).toContain("Below 70%");
  });
});
