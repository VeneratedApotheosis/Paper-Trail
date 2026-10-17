"use client";

import { useEffect, useRef, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/states";

// Named pipeline stages, in order (deepdive §2): fetch → redact → classify →
// extract → match → rules. Each writes an audit row in the real pipeline; here
// we only visualise progress with simulated counts.
const STAGES = [
  { key: "fetch", label: "Fetch", desc: "Downloading receipt-like messages from Gmail" },
  { key: "redact", label: "Redact", desc: "Replacing card numbers, phones, addresses with tokens" },
  { key: "classify", label: "Classify", desc: "Sorting receipts from everything else" },
  { key: "extract", label: "Extract", desc: "Reading amounts, dates, and order numbers" },
  { key: "match", label: "Match", desc: "Grouping events into orders" },
  { key: "rules", label: "Rules", desc: "Checking for money you're owed" },
] as const;

const TICK_MS = 150;
const STEP = 2; // messages processed per tick
const BACKOFF_SECONDS = 4;
const TOTAL_REDACTED_TOKENS = 47; // simulated PII tokens produced during redact
const SIMULATED_FINDINGS = 3;

type Phase = "running" | "backoff" | "complete";

interface SimState {
  stageIndex: number; // active stage; === STAGES.length once complete
  counts: number[]; // processed count per stage
  phase: Phase;
  backoffSecondsLeft: number;
  backoffTriggered: boolean; // the 429 backoff fires exactly once
}

// Per-stage targets. fetch/redact/classify touch every message; extract/match/
// rules only touch the receipts classify kept (0 in the no-receipts demo).
function stageTargets(total: number, receipts: number): number[] {
  return [total, total, total, receipts, receipts, receipts];
}

function initialSim(): SimState {
  return {
    stageIndex: 0,
    counts: STAGES.map(() => 0),
    phase: "running",
    backoffSecondsLeft: 0,
    backoffTriggered: false,
  };
}

// Final state used both when the run finishes and when prefers-reduced-motion is
// set (we render the completed state directly instead of ticking).
function finalSim(total: number, receipts: number): SimState {
  return {
    stageIndex: STAGES.length,
    counts: stageTargets(total, receipts),
    phase: "complete",
    backoffSecondsLeft: 0,
    backoffTriggered: true,
  };
}

// Pure transition: given the previous simulation state, return the next one.
// Kept pure so the timer callback stays trivial and the logic is easy to reason about.
function advance(prev: SimState, total: number, receipts: number): SimState {
  if (prev.phase === "complete") return prev;

  if (prev.phase === "backoff") {
    const left = prev.backoffSecondsLeft - TICK_MS / 1000;
    if (left <= 0) return { ...prev, phase: "running", backoffSecondsLeft: 0 };
    return { ...prev, backoffSecondsLeft: left };
  }

  const targets = stageTargets(total, receipts);
  const stage = prev.stageIndex;
  const target = targets[stage];
  const current = prev.counts[stage];

  // Simulated Gmail 429: pause partway through fetch, show the backoff, resume.
  if (stage === 0 && !prev.backoffTriggered && current >= Math.ceil(target / 2)) {
    return {
      ...prev,
      phase: "backoff",
      backoffSecondsLeft: BACKOFF_SECONDS,
      backoffTriggered: true,
    };
  }

  const next = Math.min(current + STEP, target);
  const counts = [...prev.counts];
  counts[stage] = next;

  if (next >= target) {
    // Move to the next stage, skipping any with a zero target (no-receipts demo).
    let nextStage = stage + 1;
    while (nextStage < targets.length && targets[nextStage] === 0) nextStage += 1;
    if (nextStage >= targets.length) {
      return { ...prev, counts, stageIndex: targets.length, phase: "complete" };
    }
    return { ...prev, counts, stageIndex: nextStage };
  }

  return { ...prev, counts };
}

// Shown during the run (issue #25, criteria 2–5): named stages with climbing
// counts, a redacted-token tally, a visible 429 backoff, cancel, and a terminal
// state that either routes to the hero or shows an EmptyState for no receipts.
export function SyncProgress({
  totalMessages,
  simulateNoReceipts,
  onCancel,
}: {
  totalMessages: number;
  simulateNoReceipts: boolean;
  onCancel: () => void;
}) {
  const receiptCount = simulateNoReceipts ? 0 : 12;
  const [sim, setSim] = useState<SimState>(initialSim);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // No ticking: render the final state immediately.
      setSim(finalSim(totalMessages, receiptCount));
      return;
    }
    intervalRef.current = setInterval(() => {
      setSim((prev) => advance(prev, totalMessages, receiptCount));
    }, TICK_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [totalMessages, receiptCount]);

  // Stop the timer once the run completes.
  useEffect(() => {
    if (sim.phase === "complete" && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [sim.phase]);

  const targets = stageTargets(totalMessages, receiptCount);
  const fetched = sim.counts[0];
  const redactedTokens = Math.round((sim.counts[1] / Math.max(totalMessages, 1)) * TOTAL_REDACTED_TOKENS);
  const complete = sim.phase === "complete";

  if (complete) {
    return (
      <SyncResult
        fetched={totalMessages}
        receiptCount={receiptCount}
        redactedTokens={TOTAL_REDACTED_TOKENS}
        onRunAgain={onCancel}
      />
    );
  }

  return (
    <div className="mx-auto max-w-ledger space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-label uppercase tracking-wide text-ink-faint">Syncing</p>
          <h1 className="font-serif text-3xl text-ink">Reading your receipts</h1>
        </div>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </header>

      <div className="flex flex-wrap gap-6 rounded-lg border border-rule bg-paper-raised px-6 py-5">
        <Stat label="Messages fetched" value={`${fetched} / ${totalMessages}`} />
        <Stat label="Tokens redacted" value={`${redactedTokens}`} />
      </div>

      {sim.phase === "backoff" ? (
        <div
          role="status"
          className="rounded-lg border border-deadline/30 bg-deadline-tint px-6 py-4 text-sm text-deadline"
        >
          Waiting — Gmail rate limit, retrying in {Math.ceil(sim.backoffSecondsLeft)}s. The run
          resumes where it left off.
        </div>
      ) : null}

      <ol className="space-y-3">
        {STAGES.map((stage, index) => {
          const target = targets[index];
          const count = sim.counts[index];
          const status =
            index < sim.stageIndex || (index === sim.stageIndex && count >= target && target > 0)
              ? "done"
              : index === sim.stageIndex
                ? "active"
                : "pending";
          const skipped = target === 0 && index < sim.stageIndex;
          const pct = target === 0 ? (skipped ? 100 : 0) : Math.round((count / target) * 100);
          const isActive = status === "active" && sim.phase !== "backoff";

          return (
            <li
              key={stage.key}
              className="rounded-lg border border-rule bg-paper-raised px-6 py-4"
              aria-current={status === "active" ? "step" : undefined}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{stage.label}</span>
                    {status === "done" ? (
                      <Chip tone="saved">done</Chip>
                    ) : isActive ? (
                      <Chip tone="deadline">working</Chip>
                    ) : status === "active" ? (
                      <Chip tone="deadline">paused</Chip>
                    ) : (
                      <Chip tone="neutral">queued</Chip>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{stage.desc}</p>
                </div>
                <span className="text-sm tabular-nums text-ink-faint">
                  {target === 0 ? (skipped ? "0 / 0" : "—") : `${count} / ${target}`}
                </span>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-sm bg-paper-sunk">
                <div
                  className="h-full rounded-sm bg-ink transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-label uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="font-serif text-2xl tabular-nums text-ink">{value}</p>
    </div>
  );
}

// Terminal state: route to the hero when receipts were found, otherwise invite
// the user into demo mode / .eml import instead of dead-ending.
function SyncResult({
  fetched,
  receiptCount,
  redactedTokens,
  onRunAgain,
}: {
  fetched: number;
  receiptCount: number;
  redactedTokens: number;
  onRunAgain: () => void;
}) {
  if (receiptCount === 0) {
    return (
      <EmptyState
        title="No receipts found in this inbox"
        query="newer_than:90d category:purchases"
        actions={
          <>
            <LinkButton href="/ledger">Explore demo data</LinkButton>
            <Button variant="secondary" onClick={onRunAgain}>
              Run sync again
            </Button>
          </>
        }
      >
        We scanned {fetched} messages and redacted {redactedTokens} tokens, but none looked like a
        purchase. You can explore PaperTrail with synthetic demo data, or import a receipt as a
        .eml file to see how parsing works.
      </EmptyState>
    );
  }

  return (
    <div className="mx-auto max-w-ledger space-y-8">
      <header className="space-y-2">
        <Chip tone="saved">Sync complete</Chip>
        <h1 className="font-serif text-3xl text-ink">
          Found {SIMULATED_FINDINGS} things worth a look
        </h1>
        <p className="max-w-md text-base text-ink-muted">
          Scanned {fetched} messages, kept {receiptCount} receipts, and redacted {redactedTokens}{" "}
          tokens before anything was read. These are simulated demo numbers.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <LinkButton href="/">View what you&apos;re owed</LinkButton>
        <Button variant="ghost" onClick={onRunAgain}>
          Run sync again
        </Button>
      </div>
    </div>
  );
}
