/** Pure experiment settings, shared by the server (experiment.ts) and the /eval page (no server imports here). */

export const MAX_EXPERIMENT_LABELS = 50;

export const PROMPT_VARIANTS = {
  default: { label: "Default prompt", addendum: "" },
  conservative: {
    label: "Conservative: null over guessing",
    addendum: "Be conservative: if a value is not stated in the email, return null for it and give it a low confidence instead of inferring it.",
  },
  itemized: {
    label: "Itemized: every product its own line",
    addendum: "List every purchased product as its own line item with its unit price. Never merge items, skip items or invent items.",
  },
} as const;
export type PromptVariantId = keyof typeof PROMPT_VARIANTS;
export const PROMPT_VARIANT_IDS = Object.keys(PROMPT_VARIANTS) as PromptVariantId[];

export const EXPERIMENT_WARNING =
  `Running an experiment calls Claude once per labeled email for each setting compared (at most ${MAX_EXPERIMENT_LABELS} emails). The current setting is served from the extraction cache where possible. Redacted text only is sent; your live setting and ledger are not changed.`;
