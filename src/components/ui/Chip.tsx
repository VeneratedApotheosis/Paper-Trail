import type { ReactNode } from "react";

export type ChipTone = "neutral" | "owed" | "deadline" | "saved" | "review";

const tones: Record<ChipTone, string> = {
  neutral: "border-rule bg-paper-sunk text-ink-muted",
  owed: "border-owed/30 bg-owed-tint text-owed",
  deadline: "border-deadline/30 bg-deadline-tint text-deadline",
  saved: "border-saved/30 bg-saved-tint text-saved",
  review: "border-deadline/40 bg-deadline-tint text-deadline",
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
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-label font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
