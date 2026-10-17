/** Money helpers for the rules engine. Amounts are major currency units (e.g. 19.99). */

/** Rounds to the nearest cent (half away from zero for positive amounts). */
export function roundCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Sum of amounts, rounded to cents. */
export function sumMoney(amounts: readonly number[]): number {
  return roundCents(amounts.reduce((total, amount) => total + amount, 0));
}

/** Sum of `amountOf(item)` over items, rounded to cents. */
export function sumMoneyBy<T>(items: readonly T[], amountOf: (item: T) => number): number {
  return sumMoney(items.map(amountOf));
}

/**
 * How far a refund may fall below the expected amount before it counts as short:
 * max($0.50, 2% of expected) (deepdive_S14 §4 R1). Not rounded, so comparisons follow the exact formula.
 */
export function refundTolerance(expected: number): number {
  return Math.max(0.5, 0.02 * expected);
}
