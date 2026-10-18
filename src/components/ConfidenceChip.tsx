import { Chip } from "@/components/ui/Chip";
import { InfoTip } from "@/components/ui/InfoTip";
import { confidenceLabel, confidenceLevel, confidencePercent } from "@/lib/format";

// The one explanation of confidence, shown by every confidence tip. It is about
// reading the email correctly, never the chance of getting paid.
export const CONFIDENCE_EXPLAINER =
  "Confidence is how sure we are that we read the email correctly, not the chance of getting paid. Below 70%, an order waits in 'Needs a quick check' and isn't counted in what you're owed until you confirm it.";

// "i" button that explains confidence; with `confidence` it also shows the exact percent.
export function ConfidenceTip({
  confidence,
  align,
}: {
  confidence?: number;
  align?: "start" | "end";
}) {
  return (
    <InfoTip label="What does confidence mean?" align={align}>
      {confidence !== undefined ? (
        <span className="mb-1 block font-semibold">
          Our confidence in this read: {confidencePercent(confidence)}
        </span>
      ) : null}
      {CONFIDENCE_EXPLAINER}
    </InfoTip>
  );
}

// Plain-language confidence chip ("Clear", "Probably right", "Needs a quick
// check") with the exact percent and the explainer behind the tip.
export function ConfidenceChip({
  confidence,
  align,
}: {
  confidence: number;
  align?: "start" | "end";
}) {
  return (
    <Chip tone={confidenceLevel(confidence) === "needs_check" ? "review" : "neutral"}>
      {confidenceLabel(confidence)}
      <ConfidenceTip confidence={confidence} align={align} />
    </Chip>
  );
}
