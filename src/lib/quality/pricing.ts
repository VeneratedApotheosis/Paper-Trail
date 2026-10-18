/**
 * List prices in USD per million tokens, used only to ESTIMATE what a quality experiment costs. They are rough and
 * may be out of date; a model that is not listed gets no estimate (null), never a guess.
 */
export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-haiku-5-5": { inputPerMillion: 1, outputPerMillion: 5 },
  "claude-sonnet-5-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-opus-5-5": { inputPerMillion: 15, outputPerMillion: 75 },
};

/** Estimated USD for the given token counts, or null when the model's price is unknown. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  return (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000;
}
