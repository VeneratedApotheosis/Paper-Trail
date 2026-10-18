"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// A small "i" button that discloses a short explanation. Works without hover:
// click, tap, Enter or Space toggles it; Escape or a click elsewhere closes it.
// The popover stays mounted (hidden) so aria-describedby always resolves.
export function InfoTip({
  label,
  children,
  align = "start",
}: {
  // Accessible name of the button, e.g. "What does confidence mean?".
  label: string;
  children: ReactNode;
  // Which edge of the button the popover lines up with (use "end" near the right edge).
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex align-middle"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={tipId}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full font-serif text-xs font-bold normal-case tracking-normal text-teal-deep transition-shadow ${
          open ? "neu-inset" : "neu-raised-sm"
        }`}
      >
        <span aria-hidden>i</span>
      </button>
      <span
        id={tipId}
        role="tooltip"
        hidden={!open}
        className={`neu-raised absolute top-full z-20 mt-2 w-64 max-w-[calc(100vw-3rem)] rounded-lg bg-paper p-3 text-left text-sm font-normal normal-case leading-snug tracking-normal text-ink ${
          align === "end" ? "right-0" : "left-0"
        }`}
      >
        {children}
      </span>
    </span>
  );
}
