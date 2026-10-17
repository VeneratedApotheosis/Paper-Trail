import type { ReactNode } from "react";

export type ChipTone = "neutral" | "owed" | "deadline" | "saved" | "review";

// Neumorphic pressed pills. One accent only: tone changes the text colour, not
// the surface. `owed` uses the deep money teal; time/status tones use the accent.
const tones: Record<ChipTone, string> = {
  neutral: "text-ink-muted",
  owed: "text-money",
  deadline: "text-teal-deep",
  saved: "text-teal-deep",
  review: "text-teal-deep",
};

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: ChipTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`neu-inset inline-flex items-center gap-1 rounded-sm px-3 py-1 text-label font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
