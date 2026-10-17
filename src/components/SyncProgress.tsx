"use client";

import { useEffect, useRef, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
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

  // Overall progress across every stage, so the count and the fill bar climb
  // together through the whole pipeline (not just the fetch stage).
  const totalWork = targets.reduce((sum, value) => sum + value, 0);
  const workDone = sim.counts.reduce((sum, value) => sum + value, 0);
  const overallPct = totalWork === 0 ? 0 : Math.round((workDone / totalWork) * 100);
  const processed = Math.round((overallPct / 100) * totalMessages);

  return (
    <div className="mx-auto max-w-ledger space-y-6">
      <header className="space-y-2 text-center">
        <p className="eyebrow">Syncing</p>
        <h1 className="font-serif text-2xl text-ink">Reading your receipts</h1>
      </header>

      <div className="neu-raised rounded-xl px-7 py-9">
        <div className="text-center">
          <p className="font-serif text-3xl tabular-nums text-money">
            {processed} / {totalMessages}
          </p>
          <p className="mt-1 text-sm text-ink-muted">messages processed</p>
        </div>

        <div
          className="neu-inset mt-6 h-3 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Sync progress"
          aria-valuenow={overallPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-bright to-teal transition-[width]"
            style={{ width: `${overallPct}%` }}
          />
        </div>

        <p className="mt-4 text-center text-sm text-ink-faint">
          {redactedTokens} tokens redacted before any AI call
        </p>

        {sim.phase === "backoff" ? (
          <div
            role="status"
            className="neu-inset mt-6 rounded-lg px-5 py-4 text-center text-sm text-ink-muted"
          >
            Waiting, Gmail rate limit, retrying in {Math.ceil(sim.backoffSecondsLeft)}s
          </div>
        ) : null}

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {STAGES.map((stage, index) => {
            const target = targets[index];
            const count = sim.counts[index];
            const status =
              index < sim.stageIndex || (index === sim.stageIndex && count >= target && target > 0)
                ? "done"
                : index === sim.stageIndex
                  ? "active"
                  : "pending";
            const paused = status === "active" && sim.phase === "backoff";
            const pillClass =
              status === "done"
                ? "neu-raised-sm text-teal-deep"
                : status === "active"
                  ? paused
                    ? "neu-inset text-ink-faint"
                    : "neu-inset text-ink"
                  : "text-ink-faint";

            return (
              <span
                key={stage.key}
                aria-current={status === "active" ? "step" : undefined}
                className={`rounded-lg px-4 py-2 text-xs font-semibold ${pillClass}`}
              >
                {stage.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
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
              Back to sync
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
    <div className="mx-auto max-w-ledger">
      <div className="neu-raised rounded-xl px-8 py-12 text-center">
        <p className="eyebrow">Sync complete</p>
        <h1 className="mt-2 font-serif text-2xl text-ink">
          Found {SIMULATED_FINDINGS} things worth a look
        </h1>
        <p className="mx-auto mt-3 max-w-md text-base text-ink-muted">
          Scanned {fetched} messages, kept {receiptCount} receipts, and redacted {redactedTokens}{" "}
          tokens before any AI call. These are simulated demo numbers.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <LinkButton href="/">View what you&apos;re owed</LinkButton>
          <Button variant="ghost" onClick={onRunAgain}>
            Back to sync
          </Button>
        </div>
      </div>
    </div>
  );
}
