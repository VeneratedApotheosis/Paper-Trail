import { AppShell } from "@/components/AppShell";
import { QualitySection, type QualitySectionProps } from "./QualitySection";

// Props-only view for the "real AI work" / model accuracy screen (screen 11,
// the Visa accuracy proof). All data arrives as props; the page wrapper and
// ui-wiring map /api/eval onto these shapes. This file owns its own prop types
// (EvalMetrics / EvalViewProps) so the view stays decoupled from the backend
// eval report types. Kenan maps EvalReport -> EvalMetrics when wiring /eval.

/** One headline ratio (0..1) rendered as a neumorphic stat card. */
export interface EvalHeadline {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

/** One row of the per-class / per-kind breakdown table. */
export interface EvalClassRow {
  /** Display label for the class or finding kind, e.g. "Refund overdue". */
  label: string;
  precision: number;
  recall: number;
  f1: number;
  /** Count of gold examples in this class. */
  support: number;
}

/** Optional comparison against a simpler baseline model. */
export interface EvalBaseline {
  /** Baseline name, e.g. "Keyword baseline". */
  label: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface EvalMetrics {
  /** Page heading, e.g. "Model accuracy". */
  title: string;
  /** Short one-line framing under the heading. */
  subtitle: string;
  /** Headline figures shown as the top stat cards. */
  headline: EvalHeadline;
  /** Eyebrow label for the breakdown table, e.g. "Per class". */
  breakdownLabel: string;
  /** Rows of the breakdown table. */
  classes: EvalClassRow[];
  /** Optional baseline to compare the headline against. Omit to hide. */
  baseline?: EvalBaseline;
  /** Held-out / sample-size note shown in muted text, e.g. "Scored on 48 held-out synthetic emails." */
  sampleNote: string;
}

export interface EvalViewProps {
  metrics: EvalMetrics;
  /** Optional "Quality" section under the synthetic scores (#117): real sync reports, skipped emails, labels. Omit to hide. */
  quality?: QualitySectionProps;
}

/** Ratio 0..1 as a whole-number percent, e.g. 0.912 -> "91%". */
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="neu-raised rounded-lg px-5 py-5">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-serif text-4xl tabular-nums text-money">{percent(value)}</p>
    </div>
  );
}

export function EvalView({ metrics, quality }: EvalViewProps) {
  const { title, subtitle, headline, breakdownLabel, classes, baseline, sampleNote } = metrics;

  return (
    <AppShell>
      <div className="space-y-8">
        <header>
          <p className="eyebrow">Model accuracy</p>
          <h1 className="mt-2 font-serif text-3xl text-ink">{title}</h1>
          <p className="mt-2 max-w-prose font-sans text-base text-ink-muted">{subtitle}</p>
        </header>

        <section aria-label="Headline metrics" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Accuracy" value={headline.accuracy} />
          <StatCard label="Precision" value={headline.precision} />
          <StatCard label="Recall" value={headline.recall} />
          <StatCard label="F1" value={headline.f1} />
        </section>

        <section aria-label="Breakdown" className="neu-inset rounded-lg p-6">
          <p className="eyebrow">{breakdownLabel}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="eyebrow py-2 text-left">
                    Class
                  </th>
                  <th scope="col" className="eyebrow py-2 text-right">
                    Precision
                  </th>
                  <th scope="col" className="eyebrow py-2 text-right">
                    Recall
                  </th>
                  <th scope="col" className="eyebrow py-2 text-right">
                    F1
                  </th>
                  <th scope="col" className="eyebrow py-2 text-right">
                    Support
                  </th>
                </tr>
              </thead>
              <tbody>
                {classes.map((row) => (
                  <tr key={row.label} className="border-t border-rule">
                    <th scope="row" className="py-3 pr-4 text-left font-medium text-ink">
                      {row.label}
                    </th>
                    <td className="py-3 text-right tabular-nums text-ink">{percent(row.precision)}</td>
                    <td className="py-3 text-right tabular-nums text-ink">{percent(row.recall)}</td>
                    <td className="py-3 text-right tabular-nums text-ink">{percent(row.f1)}</td>
                    <td className="py-3 text-right tabular-nums text-ink-muted">{row.support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {baseline ? (
          <section aria-label="Baseline comparison" className="neu-inset rounded-lg p-6">
            <p className="eyebrow">Versus baseline</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="eyebrow py-2 text-left">
                      Model
                    </th>
                    <th scope="col" className="eyebrow py-2 text-right">
                      Accuracy
                    </th>
                    <th scope="col" className="eyebrow py-2 text-right">
                      Precision
                    </th>
                    <th scope="col" className="eyebrow py-2 text-right">
                      Recall
                    </th>
                    <th scope="col" className="eyebrow py-2 text-right">
                      F1
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-rule">
                    <th scope="row" className="py-3 pr-4 text-left font-medium text-ink">
                      PaperTrail
                    </th>
                    <td className="py-3 text-right tabular-nums text-money">{percent(headline.accuracy)}</td>
                    <td className="py-3 text-right tabular-nums text-money">{percent(headline.precision)}</td>
                    <td className="py-3 text-right tabular-nums text-money">{percent(headline.recall)}</td>
                    <td className="py-3 text-right tabular-nums text-money">{percent(headline.f1)}</td>
                  </tr>
                  <tr className="border-t border-rule">
                    <th scope="row" className="py-3 pr-4 text-left font-medium text-ink-muted">
                      {baseline.label}
                    </th>
                    <td className="py-3 text-right tabular-nums text-ink-muted">{percent(baseline.accuracy)}</td>
                    <td className="py-3 text-right tabular-nums text-ink-muted">{percent(baseline.precision)}</td>
                    <td className="py-3 text-right tabular-nums text-ink-muted">{percent(baseline.recall)}</td>
                    <td className="py-3 text-right tabular-nums text-ink-muted">{percent(baseline.f1)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <p className="text-sm text-ink-muted">{sampleNote}</p>

        {quality ? <QualitySection {...quality} /> : null}
      </div>
    </AppShell>
  );
}
