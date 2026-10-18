"use client";

import { useEffect, useRef, useState } from "react";
import type { Promotion } from "@/lib/contracts";
import { SourceBadge } from "@/components/SourceBadge";
import { orderSources, type SourceAccount } from "@/components/sourceAccounts";
import { expiryLabel, type ExpiryTone } from "@/components/promotionExpiry";
import { minSpendLine, noCodeLine } from "@/components/promotionDisplay";

// One offer: store, the offer, when it ends, copyable codes and where it came from (#139). Mobile is a single column;
// from xl the codes move to a right column, bottom aligned. Expired offers are dimmed and their codes can no longer be copied.
export type CopyCode = (code: string) => void | Promise<void>;

const CHANNEL_LABELS: Record<NonNullable<Promotion["channel"]>, string> = { online: "Online", in_store: "In store", both: "Online + in store" };
const receivedDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function PromotionCard({ promotion, now, accounts, onCopyCode }: { promotion: Promotion; now: Date; accounts: SourceAccount[]; onCopyCode: CopyCode }) {
  const expiry = expiryLabel(promotion.expiresAt, now);
  const expired = expiry.tone === "expired";
  const note = minSpendLine(promotion.discount);
  const sources = orderSources(promotion.accountId ? [promotion.accountId] : undefined, accounts);
  const more = promotion.emailIds.length - 1;
  return (
    <article
      aria-label={`${promotion.store}: ${promotion.headline}`}
      className={`grid grid-cols-[minmax(0,1fr)_auto] content-start gap-3 rounded-lg p-5 xl:grid-cols-[minmax(0,1fr)_17rem] xl:gap-x-6 xl:p-6 ${
        expired ? "neu-raised-sm opacity-80" : "neu-raised"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={`neu-raised-sm flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold xl:size-10 xl:text-base ${expired ? "text-ink-muted" : "text-teal-deep"}`}
        >
          {promotion.store.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${expired ? "text-ink-muted" : "text-ink"}`}>{promotion.store}</p>
          {promotion.storeDomain ? <p className="truncate text-label font-normal tracking-normal text-ink-muted">{promotion.storeDomain}</p> : null}
        </div>
      </div>
      <div className="flex items-center self-start xl:justify-self-end">
        <ExpiryPill text={expiry.text} tone={expiry.tone} />
      </div>

      <h2 className={`col-span-2 font-serif text-[22px] leading-7 xl:col-span-1 xl:text-2xl xl:leading-[30px] ${expired ? "text-ink-muted" : "text-ink"}`}>{promotion.headline}</h2>
      {note ? <p className="col-span-2 text-sm text-ink-muted xl:col-span-1">{note}</p> : null}

      <div className="col-span-2 xl:col-span-1 xl:col-start-2 xl:row-start-2 xl:row-span-4 xl:self-end">
        {promotion.codes.length > 0 ? (
          <ul aria-label="Promo codes" className="space-y-2.5">
            {promotion.codes.map((code) => (
              <li key={code}><CodeRow code={code} expired={expired} onCopy={onCopyCode} /></li>
            ))}
          </ul>
        ) : (
          <p className={`flex min-h-[44px] items-center gap-2 text-sm font-semibold xl:min-h-10 ${expired ? "text-ink-muted" : "text-ink"}`}>
            {!expired && promotion.discount?.kind === "free_shipping" ? (
              <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 text-teal-deep" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="6.25" strokeWidth="1.5" />
                <path d="m5.2 8.2 2 2 3.6-4" />
              </svg>
            ) : null}
            {noCodeLine(promotion, expired)}
          </p>
        )}
      </div>

      {promotion.channel || sources.length > 0 ? (
        <div className="col-span-2 flex flex-wrap items-center gap-2 xl:col-span-1">
          {promotion.channel ? <Pill>{CHANNEL_LABELS[promotion.channel]}</Pill> : null}
          <SourceBadge sources={sources} />
        </div>
      ) : null}

      <p className="col-span-2 flex items-center justify-between gap-3 text-label font-normal tracking-normal text-ink-muted xl:col-span-1 xl:justify-start xl:gap-0">
        <span>Received {receivedDate(promotion.receivedAt)}{more > 0 ? ` (and ${more} more like it)` : ""}</span>
        <span aria-hidden className="hidden px-1.5 xl:inline">·</span>
        <span>Read by {promotion.source === "llm" ? "Claude" : "rules"}</span>
      </p>
    </article>
  );
}

function Pill({ children }: { children: string }) {
  return <span className="neu-inset inline-flex h-6 items-center rounded-full px-3 text-[11px] font-semibold leading-[14px] tracking-normal text-ink-muted">{children}</span>;
}

// Urgent and soon offers get the teal text; the rest stay quiet. Under 24 hours also gets a small clock.
function ExpiryPill({ text, tone }: { text: string; tone: ExpiryTone }) {
  const urgent = tone === "urgent";
  return (
    <span
      className={`neu-inset inline-flex items-center gap-1.5 rounded-full px-3 font-bold leading-4 ${
        urgent ? "h-7 text-label tracking-normal text-teal-deep" : "h-6 text-[11px] leading-[14px] tracking-normal"
      } ${tone === "soon" ? "text-teal-deep" : urgent ? "" : "font-semibold text-ink-muted"}`}
    >
      {urgent ? (
        <svg aria-hidden viewBox="0 0 16 16" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.8V8l2.2 1.4" />
        </svg>
      ) : null}
      <span className="whitespace-nowrap">{text}</span>
    </span>
  );
}

type CopyState = "idle" | "copied" | "failed";

function CodeRow({ code, expired, onCopy }: { code: string; expired: boolean; onCopy: CopyCode }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try {
      await onCopy(code);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }
  const copied = state === "copied";
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <code
          className={`neu-inset flex h-11 min-w-0 flex-1 items-center rounded-full px-[18px] font-sans text-sm font-bold leading-[18px] tracking-[0.08em] xl:h-10 xl:px-4 ${
            expired ? "text-ink-muted line-through" : "text-ink"
          }`}
        >
          <span className="truncate">{code}</span>
        </code>
        {expired ? (
          <span className="flex h-11 w-24 shrink-0 items-center justify-center text-sm font-semibold text-ink-muted xl:h-10 xl:w-[92px]">Expired</span>
        ) : (
          <button
            type="button"
            onClick={copy}
            aria-label={`Copy code ${code}`}
            className={`flex h-11 w-24 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-bold text-teal-deep transition-shadow xl:h-10 xl:w-[92px] ${copied ? "neu-inset" : "neu-raised-sm"}`}
          >
            {copied ? (
              <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 8.5 3.2 3.2L13 4.8" />
              </svg>
            ) : (
              <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
                <path d="M10.5 3.5V3.3a1.3 1.3 0 0 0-1.3-1.3H3.8a1.3 1.3 0 0 0-1.3 1.3v5.4a1.3 1.3 0 0 0 1.3 1.3h.2" />
              </svg>
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      <p role="status" className="text-xs text-ink-muted empty:hidden">{state === "failed" ? "Couldn't copy. Select the code and copy it." : ""}</p>
    </div>
  );
}
