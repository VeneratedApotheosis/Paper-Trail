// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FindingCard } from "@/components/FindingCard";
import { owedViewFixture } from "@/components/views/fixtures/owed";

it("renders a synthetic fixture with accessible evidence disclosure and claim callback", async () => {
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const claim = vi.fn();
  const fixture = owedViewFixture.owedItems[0];
  try {
    await act(async () => root.render(<FindingCard {...fixture} simulatedLabel="Simulated price feed" onDraftClaim={claim} />));
    expect(container.textContent).toContain(fixture.merchant);
    const why = [...container.querySelectorAll("button")].find(button => button.textContent === "Why?")!;
    expect(why.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(why.getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(true);
    await act(async () => why.click());
    expect(why.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain(fixture.finding.evidence[0].quote);
    const draft = [...container.querySelectorAll("button")].find(button => button.textContent === "Draft a claim")!;
    await act(async () => draft.click());
    expect(claim).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount()); container.remove();
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  }
});
