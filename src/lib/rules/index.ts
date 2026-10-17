import type { Rule } from "./engine";
import { refundRule } from "./refund";

export * from "./engine";
export * from "./money";
export * from "./time";
export { expectedRefundAmount, refundRule, type RefundExplain } from "./refund";

/** Rules run by default, in priority order (earlier rules win de-duplication). #14/#15 append R2/R3. */
export const defaultRules: Rule[] = [refundRule];
