import type { NormalizedOrder } from "@/lib/contracts";

/** Return window used when the order's policy states none (issue #14). */
export const DEFAULT_RETURN_WINDOW_DAYS = 30;

export type ReturnWindowSource = "email_text" | "user" | "default";
export type ReturnWindowAnchor = "order" | "delivery";

export interface ReturnWindow {
  days: number;
  source: ReturnWindowSource;
  /** What the window counts from. Unknown anchor => "order" (the earlier, safer deadline). */
  anchor: ReturnWindowAnchor;
  /** Policy text backing the window, when the email had one. */
  quote: string | null;
}

/**
 * Return window for `order` from its merchant policy.
 * Stated window: source "user" when the user set it, "default" when it came from the merchant default table,
 * else "email_text". No stated window: DEFAULT_RETURN_WINDOW_DAYS counted from the order date.
 */
export function resolveReturnWindow(order: NormalizedOrder): ReturnWindow {
  const policy = order.merchant.policy;
  const quote = policy.policyQuote;
  if (policy.returnWindowDays == null) {
    return { days: DEFAULT_RETURN_WINDOW_DAYS, source: "default", anchor: "order", quote };
  }
  const source: ReturnWindowSource =
    policy.policySource === "user"
      ? "user"
      : policy.policySource === "default_table"
        ? "default"
        : "email_text";
  return { days: policy.returnWindowDays, source, anchor: policy.windowAnchor ?? "order", quote };
}
