import type { Rule } from "./engine";
import { priceDropRule } from "./pricedrop";
import { refundRule } from "./refund";
import { returnRule } from "./return";

export * from "./engine";
export * from "./money";
export * from "./owed";
export * from "./time";
export { expectedRefundAmount, refundRule, type RefundExplain } from "./refund";
export * from "./policies";
export { returnRule, type ReturnExplain } from "./return";
export { priceDropRule, type PriceDropExplain } from "./pricedrop";

/** Rules run by default, in priority order (earlier rules win de-duplication). */
export const defaultRules: Rule[] = [refundRule, returnRule, priceDropRule];
