import type { ReactNode } from "react";

// The side panel of /sync (From xl: "What happens", "Limits", "Your privacy"). Every number comes from the preview the
// wrapper loaded (windowDays, maxMessages); a figure that was not supplied is left out rather than guessed.

export type StepState = "ready" | "pending" | "active" | "done";
export type SyncStage = "listing" | "fetching" | "processing" | "promotions";
export type SyncStagesKind = "preview" | "syncing" | "result" | "error";

/** Index of the step a running stage belongs to. Reading promotions feeds the last step, "Find money". */
const STAGE_STEP: Record<SyncStage, number> = { listing: 0, fetching: 1, processing: 2, promotions: 3 };

/** One state per step (List, Fetch, Process, Find money). Without live progress no step claims to be running. */
export function stepStates(kind: SyncStagesKind, stage?: SyncStage | null): StepState[] {
  if (kind === "result") return ["done", "done", "done", "done"];
  if (kind !== "syncing" || !stage) return ["ready", "ready", "ready", "ready"];
  const active = STAGE_STEP[stage];
  return [0, 1, 2, 3].map((i): StepState => (i < active ? "done" : i === active ? "active" : "pending"));
}

export type SyncErrorKindName =
  | "reconnect"
  | "already_running"
  | "timeout"
  | "rate_limited"
  | "access_denied"
  | "unreachable"
  | "failed";

const ERROR_CHIP: Record<SyncErrorKindName, string> = {
  reconnect: "Reconnect needed",
  already_running: "Already running",
  timeout: "Took too long",
  rate_limited: "Gmail asked to slow down",
  access_denied: "Access denied",
  unreachable: "Connection lost",
  failed: "Did not finish",
};

/** The short label on the error card. */
export function errorChip(kind: SyncErrorKindName): string {
  return ERROR_CHIP[kind];
}

/** The line under the "Sync stopped" heading. Only the access errors say Gmail cannot be read. */
export function errorIntro(kind: SyncErrorKindName): string {
  return kind === "reconnect" || kind === "access_denied"
    ? "PaperTrail cannot read your inbox until you reconnect Gmail."
    : "The sync did not finish. Nothing in your inbox was changed.";
}

const STEPS = [
  { title: "List", text: (w?: number) => (w ? `Find matching emails from the last ${w} days.` : "Find matching emails.") },
  { title: "Fetch", text: (_w?: number, max?: number) => (max ? `Open up to ${max} of them, read-only.` : "Open them, read-only.") },
  { title: "Process", text: () => "Remove card numbers, phones and addresses, then read each receipt." },
  { title: "Find money", text: () => "Match purchases and look for money you are owed." },
] as const;

const markerBase = "neu-inset flex size-7 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-bold leading-4";

function StepMarker({ state, index }: { state: StepState; index: number }) {
  if (state === "done") {
    return (
      <span className={`${markerBase} text-teal-deep`} aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="neu-accent flex size-7 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-bold leading-4" aria-hidden="true">
        {index + 1}
      </span>
    );
  }
  return (
    <span className={`${markerBase} ${state === "ready" ? "text-teal-deep" : "text-ink-muted"}`} aria-hidden="true">
      {index + 1}
    </span>
  );
}

function RailCard({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`neu-raised flex-col gap-4 rounded-lg p-5 xl:p-6 ${className}`}>
      <h2 className="font-serif text-xl text-ink">{title}</h2>
      {children}
    </section>
  );
}

const STATE_WORD: Record<StepState, string> = { ready: "", pending: "Not started", active: "In progress", done: "Done" };

export function StepsCard({
  states,
  windowDays,
  maxMessages,
  className = "flex",
}: {
  states: StepState[];
  windowDays?: number;
  maxMessages?: number;
  className?: string;
}) {
  return (
    <RailCard title="What happens" className={className}>
      <ol className="flex flex-col gap-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3" aria-current={states[i] === "active" ? "step" : undefined}>
            <StepMarker state={states[i]} index={i} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className={`text-sm font-bold ${states[i] === "pending" ? "text-ink-muted" : "text-ink"}`}>
                {step.title}
                {STATE_WORD[states[i]] ? <span className="sr-only">: {STATE_WORD[states[i]]}</span> : null}
              </p>
              <p className="text-sm text-ink-muted">{step.text(windowDays, maxMessages)}</p>
            </div>
          </li>
        ))}
      </ol>
    </RailCard>
  );
}

export function LimitsCard({ windowDays, maxMessages }: { windowDays?: number; maxMessages?: number }) {
  const rows: Array<[string, string]> = [];
  if (windowDays !== undefined) rows.push(["Search window", `Last ${windowDays} days`]);
  if (maxMessages !== undefined) rows.push(["Emails per sync", `Up to ${maxMessages}`]);
  rows.push(["Gmail access", "7 days, then reconnect"]);
  return (
    <RailCard title="Limits" className="hidden xl:flex">
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 border-t border-rule py-3 first:border-t-0 first:pt-0 last:pb-0">
            <dt className="text-sm text-ink-muted">{label}</dt>
            <dd className="text-right text-sm font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </RailCard>
  );
}

export function PrivacyCard({ redactionOff }: { redactionOff: boolean }) {
  const points = [
    { title: "Read-only", text: "PaperTrail cannot send, change or delete your mail." },
    redactionOff
      ? { title: "Sent to the AI as is", text: "Redaction is off, so receipt text goes to the AI unchanged." }
      : { title: "Redacted before AI", text: "Card numbers, phones and street addresses are removed first." },
    { title: "Nothing sent", text: "Claims are drafts. You approve and send them yourself." },
  ];
  return (
    <RailCard title="Your privacy" className="hidden gap-3.5 xl:flex">
      <ul className="flex flex-col gap-3.5">
        {points.map((point) => (
          <li key={point.title} className="flex gap-3">
            <span aria-hidden="true" className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-teal-deep" />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-bold text-ink">{point.title}</p>
              <p className="text-sm text-ink-muted">{point.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

/** The whole side panel. `stepsOnPhone` keeps "What happens" visible on phones (the preview screen does that). */
export function SyncRail({
  states,
  windowDays,
  maxMessages,
  redactionOff,
  stepsOnPhone,
}: {
  states: StepState[];
  windowDays?: number;
  maxMessages?: number;
  redactionOff: boolean;
  stepsOnPhone: boolean;
}) {
  return (
    <aside aria-label="About this sync" className={`${stepsOnPhone ? "flex" : "hidden xl:flex"} flex-col gap-5`}>
      <StepsCard states={states} windowDays={windowDays} maxMessages={maxMessages} />
      <LimitsCard windowDays={windowDays} maxMessages={maxMessages} />
      <PrivacyCard redactionOff={redactionOff} />
    </aside>
  );
}

/** Shared frame of every /sync screen: the read-only strip, heading, and the main column beside the side panel. */
export function SyncLayout({
  mode,
  title,
  intro,
  rail,
  children,
}: {
  mode: "gmail" | "import";
  title: string;
  intro: ReactNode;
  rail: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      {mode === "gmail" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="neu-inset inline-flex h-6 items-center rounded-full px-3 text-[0.6875rem] font-semibold text-ink-muted">
            Gmail: read-only
          </span>
          <p className="text-[0.75rem] leading-4 text-ink-muted">
            PaperTrail can read your mail but never send, change or delete it.
          </p>
        </div>
      ) : null}
      <header className="space-y-2">
        <h1 className="font-serif text-[2.125rem] leading-10 tracking-[-0.01em] text-ink xl:text-[2.5rem] xl:leading-[3rem]">{title}</h1>
        <p className="max-w-[40rem] text-base text-ink-muted">{intro}</p>
      </header>
      <div className="space-y-5 xl:grid xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start xl:gap-8 xl:space-y-0">
        <div className="min-w-0 space-y-5">{children}</div>
        {rail}
      </div>
    </div>
  );
}

export const mainCard = "neu-raised flex flex-col gap-4 rounded-lg p-5 xl:gap-5 xl:p-8";
export const insetTile = "neu-inset rounded-md p-4 xl:p-5";
