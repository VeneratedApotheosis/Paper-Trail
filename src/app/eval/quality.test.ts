import { describe, expect, it } from "vitest";
import type { QualityEvalResponse } from "@/lib/api/types";
import { runRealEval } from "@/lib/eval/real";
import { qualityViewProps } from "./quality";

const input = (evaluation: QualityEvalResponse | null) => ({
  loading: false, error: null, reports: null, skipped: null, evaluation,
  experiment: { pending: false, error: null, result: null }, onMarkReceipt: async () => null, onRunExperiment: () => undefined,
});

describe("qualityViewProps", () => {
  it("handles missing data", () => {
    const props = qualityViewProps(input(null));
    expect(props).toMatchObject({ latest: null, history: [], skipped: [], labelEval: null, currentModel: "claude-sonnet-5-5" });
    expect(props.modelOptions[0]).toBe("claude-sonnet-5-5");
    expect(props.modelOptions).toContain("claude-sonnet-5-5");
    expect(props.promptOptions.map((option) => option.id)).toEqual(["default", "conservative", "itemized"]);
    expect(props.experimentWarning).toMatch(/calls Claude/);
  });

  it("maps the label eval and puts the live model first in the picker", async () => {
    const report = await runRealEval([], { cache: { get: () => undefined, set: () => undefined } });
    const props = qualityViewProps(input({ ...report, model: "claude-sonnet-5-5" }));
    expect(props.modelOptions[0]).toBe("claude-sonnet-5-5");
    expect(props.modelOptions.filter((model) => model === "claude-sonnet-5-5")).toHaveLength(1);
    expect(props.labelEval).toMatchObject({ labels: 0, fieldRows: [], fieldAccuracy: null, unscored: 0 });
  });
});
