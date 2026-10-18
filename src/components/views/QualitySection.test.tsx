// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { qualitySectionFixture } from "./fixtures/quality";
import { QualitySection, type QualitySectionProps } from "./QualitySection";

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let cleanup: (() => Promise<void>) | undefined;
async function render(props: QualitySectionProps) {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<QualitySection {...props} />));
  cleanup = async () => { await act(async () => root.unmount()); container.remove(); delete environment.IS_REACT_ACT_ENVIRONMENT; };
  return container;
}
afterEach(async () => { await cleanup?.(); cleanup = undefined; });
const button = (container: HTMLElement, text: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text))!;

describe("QualitySection", () => {
  it("shows the latest run, history, skipped emails, label scores and the experiment warning", async () => {
    const container = await render(qualitySectionFixture);
    const text = container.textContent ?? "";
    expect(text).toContain("Latest run · Gmail");
    expect(text).toContain("30 / 18"); // plain / HTML
    expect(text).toContain("Recent runs");
    expect(text).toContain("Your order #NW-2041 is on its way");
    expect(text).toContain("Didn't look like a receipt");
    expect(text).toContain("Receipt precision");
    expect(text).toContain("88%");
    expect(text).toContain("calls Claude");
    expect(container.querySelector("svg[role=img]")).not.toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(7); // 3 buttons per skipped row + run
  });

  it("calls back with the email id and shows a failure message next to that row", async () => {
    const onMarkReceipt = vi.fn(async () => "Claude is not configured.");
    const container = await render({ ...qualitySectionFixture, onMarkReceipt });
    await act(async () => button(container, "This is a receipt").click());
    expect(onMarkReceipt).toHaveBeenCalledWith("m-101");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Claude is not configured.");
  });

  it("offers receipt, shipping-update and promotion buttons per skipped row, each calling its own callback", async () => {
    const onMarkReceipt = vi.fn(async () => null);
    const onMarkShipping = vi.fn(async () => null);
    const onMarkPromotion = vi.fn(async () => "Could not list it.");
    const container = await render({ ...qualitySectionFixture, onMarkReceipt, onMarkShipping, onMarkPromotion });
    const first = container.querySelector("[aria-label='Skipped emails'] tbody tr")!;
    expect([...first.querySelectorAll("button")].map((candidate) => candidate.textContent)).toEqual(["This is a receipt", "This is a shipping update", "This is a promotion"]);
    await act(async () => button(first as HTMLElement, "shipping update").click());
    expect(onMarkShipping).toHaveBeenCalledWith("m-101");
    await act(async () => button(first as HTMLElement, "a promotion").click());
    expect(onMarkPromotion).toHaveBeenCalledWith("m-101");
    expect(onMarkReceipt).not.toHaveBeenCalled();
    expect(first.querySelector("[role=alert]")?.textContent).toBe("Could not list it.");
  });

  it("hides the shipping-update and promotion buttons when their callbacks are not given", async () => {
    const container = await render({ ...qualitySectionFixture, onMarkShipping: undefined, onMarkPromotion: undefined });
    expect([...container.querySelectorAll("tbody button")].map((candidate) => candidate.textContent)).toEqual(["This is a receipt", "This is a receipt"]);
    expect(container.querySelectorAll("button")).toHaveLength(3);
  });

  it("runs the experiment with the chosen model and prompt, and renders both settings side by side", async () => {
    const onRunExperiment = vi.fn();
    const side = { label: "claude-haiku-5-5 · Default prompt", accuracy: 0.8, labelsScored: 7, llmCalls: 0, cachedLabels: 7, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const container = await render({ ...qualitySectionFixture, onRunExperiment, experiment: { pending: false, error: null, result: {
      labelsUsed: 7, capped: false, current: side, candidate: { ...side, label: "claude-sonnet-5-5 · Default prompt", accuracy: 0.9, llmCalls: 7, cachedLabels: 0, inputTokens: 7000, outputTokens: 900, costUsd: 0.0345 },
    } } });
    const model = container.querySelector<HTMLSelectElement>("select[aria-label=Model]")!;
    expect(model.value).toBe("claude-haiku-5-5");
    await act(async () => { model.value = "claude-sonnet-5-5"; model.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => button(container, "Run experiment").click());
    expect(onRunExperiment).toHaveBeenCalledWith("claude-sonnet-5-5", "default");
    expect(container.textContent).toContain("claude-sonnet-5-5 · Default prompt");
    expect(container.textContent).toContain("$0.0345");
    expect(container.textContent).toContain("Your live setting was not changed.");
  });

  it("shows loading, error and empty states without crashing", async () => {
    const container = await render({ ...qualitySectionFixture, loading: true, error: "Quality data is unavailable.", latest: null, history: [], skipped: [], labelEval: null });
    expect(container.textContent).toContain("Loading quality data");
    expect(container.textContent).toContain("Quality data is unavailable.");
    expect(container.textContent).toContain("No skipped emails");
    expect(container.textContent).toContain("No labels yet");
  });
});
