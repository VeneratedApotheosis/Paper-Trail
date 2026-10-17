import { z } from "zod";
import { EmailClassSchema, RawEmailSchema } from "./email";
import { ExtractedFieldsSchema } from "./extraction";
import { FindingKindSchema } from "./findings";

/**
 * File formats for the synthetic seed data (issue #5). All seed data is fictional.
 *
 * - `seed/inbox.json`             -> SeedInbox
 * - `seed/expected_findings.json` -> ExpectedFindingsFile
 * - `seed/gold_labels.json`       -> GoldLabelsFile (eval ground truth, issue #21)
 */

export const SeedInboxSchema = z.object({
  synthetic: z.literal(true),
  /** Fixed "today" for the seed scenario; rules/eval run with now = asOf so results are stable. */
  asOf: z.string().datetime({ offset: true }),
  emails: z.array(RawEmailSchema),
});
export type SeedInbox = z.infer<typeof SeedInboxSchema>;

export const ExpectedFindingSchema = z.object({
  kind: FindingKindSchema,
  merchant: z.string(),
  orderRef: z.string(),
  /** Line item name for item-level findings (price drops), else omitted. */
  lineItem: z.string().optional(),
  /** Expected amountAtStake, compared with a $0.01 tolerance. */
  amountAtStake: z.number().nonnegative(),
  /** Expected dueAt date (YYYY-MM-DD) where applicable. */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Email ids that justify the finding. */
  messageIds: z.array(z.string()).min(1),
  note: z.string().optional(),
});
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>;

export const ExpectedFindingsFileSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  findings: z.array(ExpectedFindingSchema),
});
export type ExpectedFindingsFile = z.infer<typeof ExpectedFindingsFileSchema>;

export const GoldLabelSchema = z.object({
  emailId: z.string(),
  class: EmailClassSchema,
  /** Only the fields that apply; omitted fields are not scored. */
  fields: ExtractedFieldsSchema.partial(),
  /** Holdout emails are never used for prompt tuning (issue #21). */
  holdout: z.boolean().default(false),
  /** Edge-case tags, e.g. "partial_return", "phishing_lookalike". */
  tags: z.array(z.string()).default([]),
});
export type GoldLabel = z.infer<typeof GoldLabelSchema>;

export const GoldLabelsFileSchema = z.object({
  labels: z.array(GoldLabelSchema),
});
export type GoldLabelsFile = z.infer<typeof GoldLabelsFileSchema>;
