"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

// Props-only "Quality" section for the /eval screen (#117). Everything arrives as props and user actions leave as
// callbacks; the page wrapper maps /api/quality* onto these shapes. Types are kept local (structural), like EvalView.

/** One finished sync / upload / demo run. */
export interface QualityRunRow {
  id: string;
  at: string;
  source: "gmail" | "upload" | "demo";
  fetched: number;
  prefilteredOut: number;
  skippedNonReceipt: number;
  extracted: number;
  lowConfidence: number;
  extractionFailures: number;
  matchedOrders: number;
  findings: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  bodySource: { plain: number; html: number };
}

export interface QualitySkippedRow {
  emailId: string;
  from: { name: string | null; domain: string | null };
  /** Redacted subject. */
  subject: string;
  date: string;
  reason: "prefilter" | "marketing" | "not_receipt" | "phishing";
}

export interface QualityFieldRow {
  field: string;
  accuracy: number;
  correct: number;
  total: number;
}

/** Scores against the labels people saved by correcting or confirming. */
export interface QualityLabelEval {
  labels: number;
  receipts: number;
  notReceipts: number;
  withFields: number;
  precision: number;
  recall: number;
  fieldRows: QualityFieldRow[];
  /** Overall field accuracy, or null when no label has corrected fields yet. */
  fieldAccuracy: number | null;
  /** Labels with corrected fields that the cache could not score. */
  unscored: number;
  caveat: string;
}

export interface QualityExperimentSide {
  label: string;
  accuracy: number;
  labelsScored: number;
  llmCalls: number;
  cachedLabels: number;
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD, or null for a model without a known price. */
  costUsd: number | null;
}

export interface QualityExperimentResult {
  labelsUsed: number;
  capped: boolean;
  current: QualityExperimentSide;
  candidate: QualityExperimentSide | null;
}

export interface QualitySectionProps {
  loading: boolean;
  /** Message when the quality data could not be loaded. */
  error: string | null;
  latest: QualityRunRow | null;
  /** Oldest first. */
  history: QualityRunRow[];
  skipped: QualitySkippedRow[];
  labelEval: QualityLabelEval | null;
  currentModel: string;
  /** Models offered by the experiment picker (the current model is always first). */
  modelOptions: string[];
  promptOptions: Array<{ id: string; label: string }>;
  /** Shown above the Run button: says that the experiment calls Claude. */
  experimentWarning: string;
  experiment: { pending: boolean; error: string | null; result: QualityExperimentResult | null };
  /** Resolves to an error message, or null when the email was re-run. */
  onMarkReceipt: (emailId: string) => Promise<string | null>;
  onRunExperiment: (model: string, promptVariant: string) => void;
}

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;
const number = new Intl.NumberFormat("en-US");
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const REASONS: Record<QualitySkippedRow["reason"], string> = {
  prefilter: "Didn't look like a receipt",
  marketing: "Marketing",
  not_receipt: "Not a receipt",
  phishing: "Look-alike sender",
};
const SOURCES: Record<QualityRunRow["source"], string> = { gmail: "Gmail", upload: "Upload", demo: "Demo" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="neu-raised rounded-lg px-4 py-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-serif text-2xl tabular-nums text-money">{value}</p>
    </div>
  );
}

/** Extracted receipts per run, oldest to newest. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 160},${34 - (value / max) * 30}`).join(" ");
  return (
    <svg role="img" aria-label={`Receipts extracted per run: ${values.join(", ")}`} viewBox="0 0 160 36" className="h-9 w-40 text-teal-deep">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function SkippedList({ skipped, onMarkReceipt }: Pick<QualitySectionProps, "skipped" | "onMarkReceipt">) {
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  async function mark(emailId: string) {
    setBusy(emailId);
    const message = await onMarkReceipt(emailId);
    setBusy(null);
    if (message) setMessages((current) => ({ ...current, [emailId]: message }));
  }
  if (skipped.length === 0) return <p className="mt-4 text-sm text-ink-muted">No skipped emails in the latest run.</p>;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="eyebrow py-2 text-left">Sender</th>
            <th scope="col" className="eyebrow py-2 text-left">Subject</th>
            <th scope="col" className="eyebrow py-2 text-left">Why skipped</th>
            <th scope="col" className="eyebrow py-2 text-right"><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {skipped.map((row) => (
            <tr key={row.emailId} className="border-t border-rule align-top">
              <td className="py-3 pr-4 text-ink">
                {row.from.name ?? row.from.domain ?? "Unknown sender"}
                {row.from.name && row.from.domain ? <span className="block text-xs text-ink-muted">{row.from.domain}</span> : null}
              </td>
              <td className="py-3 pr-4 text-ink">
                {row.subject || "(no subject)"}
                <span className="block text-xs text-ink-muted">{dateTime(row.date)}</span>
              </td>
              <td className="py-3 pr-4"><span className="neu-raised-sm rounded-full px-2 py-0.5 text-xs text-ink-muted">{REASONS[row.reason]}</span></td>
              <td className="py-3 text-right">
                <Button type="button" variant="secondary" className="px-3 py-2" disabled={busy !== null} onClick={() => mark(row.emailId)}>
                  {busy === row.emailId ? "Reading…" : "This is a receipt"}
                </Button>
                {messages[row.emailId] ? <p role="alert" className="mt-2 max-w-xs text-xs text-ink-muted">{messages[row.emailId]}</p> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExperimentRunner(props: Pick<QualitySectionProps, "currentModel" | "modelOptions" | "promptOptions" | "experimentWarning" | "experiment" | "onRunExperiment">) {
  const { currentModel, modelOptions, promptOptions, experimentWarning, experiment, onRunExperiment } = props;
  const [model, setModel] = useState(currentModel);
  const [prompt, setPrompt] = useState(promptOptions[0]?.id ?? "default");
  const { result } = experiment;
  const side = (value: QualityExperimentSide) => (
    <tr key={value.label} className="border-t border-rule">
      <th scope="row" className="py-3 pr-4 text-left font-medium text-ink">{value.label}</th>
      <td className="py-3 text-right tabular-nums text-money">{percent(value.accuracy)}</td>
      <td className="py-3 text-right tabular-nums text-ink">{value.llmCalls} <span className="text-ink-muted">(+{value.cachedLabels} cached)</span></td>
      <td className="py-3 text-right tabular-nums text-ink">{number.format(value.inputTokens)} / {number.format(value.outputTokens)}</td>
      <td className="py-3 text-right tabular-nums text-ink">{value.costUsd === null ? "n/a" : `$${value.costUsd.toFixed(4)}`}</td>
    </tr>
  );
  return (
    <div className="mt-4">
      <p className="max-w-prose text-sm text-ink-muted">{experimentWarning}</p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-sm text-ink-muted">Model
          <select aria-label="Model" value={model} onChange={(event) => setModel(event.target.value)} disabled={experiment.pending}
            className="neu-inset mt-2 block rounded-lg bg-transparent px-3 py-2 text-ink">
            {modelOptions.map((option) => <option key={option} value={option}>{option === currentModel ? `${option} (current)` : option}</option>)}
          </select>
        </label>
        <label className="text-sm text-ink-muted">Prompt
          <select aria-label="Prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={experiment.pending}
            className="neu-inset mt-2 block rounded-lg bg-transparent px-3 py-2 text-ink">
            {promptOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <Button type="button" disabled={experiment.pending} onClick={() => onRunExperiment(model, prompt)}>
          {experiment.pending ? "Running…" : "Run experiment (calls Claude)"}
        </Button>
      </div>
      {experiment.error ? <p role="alert" className="mt-4 text-sm text-ink">{experiment.error}</p> : null}
      {result ? (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="eyebrow py-2 text-left">Setting</th>
                <th scope="col" className="eyebrow py-2 text-right">Field accuracy</th>
                <th scope="col" className="eyebrow py-2 text-right">Claude calls</th>
                <th scope="col" className="eyebrow py-2 text-right">Tokens in / out</th>
                <th scope="col" className="eyebrow py-2 text-right">Est. cost</th>
              </tr>
            </thead>
            <tbody>{[result.current, result.candidate].filter((value): value is QualityExperimentSide => value !== null).map(side)}</tbody>
          </table>
          <p className="mt-3 text-sm text-ink-muted">
            Scored on {result.current.labelsScored} of {result.labelsUsed} labeled emails{result.capped ? " (the most recent 50)" : ""}.
            {result.candidate ? " Your live setting was not changed." : " The chosen setting equals the current one."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function QualitySection(props: QualitySectionProps) {
  const { loading, error, latest, history, skipped, labelEval } = props;
  return (
    <section aria-label="Quality tracking" className="space-y-8">
      <header>
        <p className="eyebrow">Quality on real data</p>
        <h2 className="mt-2 font-serif text-2xl text-ink">How your last sync went</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          Counts only: no email text is shown here. Corrections you make in Review and below become labels kept on this computer until you delete everything.
        </p>
      </header>

      {loading ? <p className="text-sm text-ink-muted">Loading quality data…</p> : null}
      {error ? <p role="alert" className="text-sm text-ink">{error}</p> : null}

      {!loading && !error && !latest ? (
        <p className="neu-inset rounded-lg p-6 text-sm text-ink-muted">Nothing to report yet. Sync Gmail, upload emails or load the demo, and the numbers appear here.</p>
      ) : null}

      {latest ? (
        <div aria-label="Latest run">
          <p className="eyebrow">Latest run · {SOURCES[latest.source]} · {dateTime(latest.at)}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Fetched" value={number.format(latest.fetched)} />
            <Stat label="Filtered out" value={number.format(latest.prefilteredOut)} />
            <Stat label="Marketing / not a receipt" value={number.format(latest.skippedNonReceipt)} />
            <Stat label="Extracted" value={number.format(latest.extracted)} />
            <Stat label="Low confidence" value={number.format(latest.lowConfidence)} />
            <Stat label="Extraction failures" value={number.format(latest.extractionFailures)} />
            <Stat label="Orders / findings" value={`${latest.matchedOrders} / ${latest.findings}`} />
            <Stat label="Claude calls" value={number.format(latest.llmCalls)} />
            <Stat label="Tokens in / out" value={`${number.format(latest.inputTokens)} / ${number.format(latest.outputTokens)}`} />
            <Stat label="Text from plain / HTML" value={`${latest.bodySource.plain} / ${latest.bodySource.html}`} />
          </div>
        </div>
      ) : null}

      {history.length > 1 ? (
        <div className="neu-inset rounded-lg p-6" aria-label="History">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="eyebrow">Recent runs · receipts extracted</p>
            <Sparkline values={history.map((run) => run.extracted)} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="eyebrow py-2 text-left">When</th>
                  <th scope="col" className="eyebrow py-2 text-left">Source</th>
                  <th scope="col" className="eyebrow py-2 text-right">Fetched</th>
                  <th scope="col" className="eyebrow py-2 text-right">Extracted</th>
                  <th scope="col" className="eyebrow py-2 text-right">Low conf.</th>
                  <th scope="col" className="eyebrow py-2 text-right">Orders</th>
                  <th scope="col" className="eyebrow py-2 text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((run) => (
                  <tr key={run.id} className="border-t border-rule">
                    <td className="py-3 pr-4 text-ink">{dateTime(run.at)}</td>
                    <td className="py-3 pr-4 text-ink-muted">{SOURCES[run.source]}</td>
                    <td className="py-3 text-right tabular-nums text-ink">{run.fetched}</td>
                    <td className="py-3 text-right tabular-nums text-ink">{run.extracted}</td>
                    <td className="py-3 text-right tabular-nums text-ink-muted">{run.lowConfidence}</td>
                    <td className="py-3 text-right tabular-nums text-ink">{run.matchedOrders}</td>
                    <td className="py-3 text-right tabular-nums text-ink-muted">{run.llmCalls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="neu-inset rounded-lg p-6" aria-label="Skipped emails">
        <p className="eyebrow">Skipped emails · {skipped.length}</p>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">These did not become orders. If one is really a receipt, say so: it is read again and added, and the correction is remembered.</p>
        <SkippedList skipped={skipped} onMarkReceipt={props.onMarkReceipt} />
      </div>

      <div className="neu-inset rounded-lg p-6" aria-label="Accuracy on your labels">
        <p className="eyebrow">Accuracy on your labels</p>
        {labelEval && labelEval.labels > 0 ? (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Labels saved" value={String(labelEval.labels)} />
              <Stat label="Receipt precision" value={percent(labelEval.precision)} />
              <Stat label="Receipt recall" value={percent(labelEval.recall)} />
              <Stat label="Field accuracy" value={labelEval.fieldAccuracy === null ? "n/a" : percent(labelEval.fieldAccuracy)} />
            </div>
            {labelEval.fieldRows.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="eyebrow py-2 text-left">Field</th>
                      <th scope="col" className="eyebrow py-2 text-right">Accuracy</th>
                      <th scope="col" className="eyebrow py-2 text-right">Correct</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labelEval.fieldRows.map((row) => (
                      <tr key={row.field} className="border-t border-rule">
                        <th scope="row" className="py-3 pr-4 text-left font-medium text-ink">{row.field}</th>
                        <td className="py-3 text-right tabular-nums text-ink">{percent(row.accuracy)}</td>
                        <td className="py-3 text-right tabular-nums text-ink-muted">{row.correct} / {row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="mt-4 text-sm text-ink-muted">
              {labelEval.receipts} receipts and {labelEval.notReceipts} non-receipts labeled; {labelEval.withFields} with corrected fields
              {labelEval.unscored > 0 ? `, ${labelEval.unscored} not scored because Claude's earlier answer is no longer cached (run an experiment to score them)` : ""}. {labelEval.caveat}
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">No labels yet. Confirm or edit an order in Review, or mark a skipped email, and the scores appear here.</p>
        )}
      </div>

      <div className="neu-inset rounded-lg p-6" aria-label="Experiments">
        <p className="eyebrow">Try another model or prompt</p>
        <ExperimentRunner {...props} />
      </div>
    </section>
  );
}
