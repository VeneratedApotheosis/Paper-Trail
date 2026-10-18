// Headline and bar fill for the Review side panel. A "0 of 3 checked" count needs a real number of orders already
// checked, so it only appears when the wrapper supplies `checkedCount`; otherwise only the real queue length shows.
export interface ReviewProgress {
  heading: string;
  /** 0 to 100, or null when no checked count was supplied (the bar then stays empty). */
  percent: number | null;
}

export function reviewProgress(left: number, checkedCount?: number): ReviewProgress {
  if (checkedCount === undefined) {
    return { heading: left === 0 ? "All clear" : `${left} to check`, percent: null };
  }
  const total = checkedCount + left;
  if (total === 0) return { heading: "All clear", percent: null };
  return {
    heading: `${checkedCount} of ${total} checked`,
    percent: Math.round((checkedCount / total) * 100),
  };
}

/** "3 orders left to check" or "Nothing left to check". */
export function ordersLeftSentence(left: number): string {
  if (left === 0) return "Nothing left to check";
  return `${left} order${left === 1 ? "" : "s"} left to check`;
}
