"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { filterSearchSelectOptions, type SearchSelectOption } from "./searchSelectOptions";

export type { SearchSelectOption } from "./searchSelectOptions";

export interface SearchSelectProps {
  // Visible label above the button, also the accessible name of the control.
  label: string;
  options: readonly SearchSelectOption[];
  // Selected option value, or null for the "all" choice.
  value: string | null;
  onChange: (value: string | null) => void;
  // Text of the first "all" option, e.g. "All stores". Hidden while a search is active.
  allLabel: string;
  // Count shown next to the "all" option.
  allCount?: number;
  searchPlaceholder?: string;
  // Shown when the search matches nothing, e.g. "No stores match".
  emptyText: string;
}

// Searchable single-select dropdown (WAI-ARIA combobox + listbox). A button shows the
// current choice and opens a popover with a search field and a scrollable list. DOM focus
// stays in the search field; the highlighted option is tracked with aria-activedescendant.
// Keys: ArrowDown/ArrowUp/Home/End move, Enter selects, Escape closes and refocuses the
// button, Tab closes. Under 640px the button and popover are full width.
export function SearchSelect({
  label,
  options,
  value,
  onChange,
  allLabel,
  allCount,
  searchPlaceholder = "Search",
  emptyText,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const ids = useId();
  const labelId = `${ids}-label`;
  const listId = `${ids}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The "all" choice is a normal option with an empty value, only offered when not searching.
  const visible = useMemo(() => {
    const matches = filterSearchSelectOptions(options, query);
    return query.trim() === ""
      ? [{ value: "", label: allLabel, count: allCount }, ...matches]
      : matches;
  }, [options, query, allLabel, allCount]);

  const selected = options.find((option) => option.value === value);
  const optionId = (index: number) => `${ids}-opt-${index}`;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[id="${optionId(activeIndex)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
    // optionId only depends on ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex]);

  function openList() {
    const selectedIndex =
      value === null ? 0 : options.findIndex((option) => option.value === value) + 1;
    setQuery("");
    setActiveIndex(Math.max(selectedIndex, 0));
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(index: number) {
    const option = visible[index];
    if (!option) return;
    onChange(option.value === "" ? null : option.value);
    close(true);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = visible.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => (last < 0 ? 0 : Math.min(index + 1, last)));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(last, 0));
        break;
      case "Enter":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(true);
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative w-full sm:w-auto"
      onBlur={(event) => {
        // Focus moved to another control (e.g. Shift+Tab): close without stealing it back.
        const next = event.relatedTarget as Node | null;
        if (open && next && !rootRef.current?.contains(next)) setOpen(false);
      }}
    >
      <span id={labelId} className="eyebrow mb-1.5 block">
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${ids}-value`}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            openList();
          }
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-sm px-4 py-2 text-left text-sm font-bold text-ink transition-shadow sm:w-72 ${
          open ? "neu-inset" : "neu-raised-sm"
        }`}
      >
        <span id={`${ids}-value`} className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">{selected ? selected.label : allLabel}</span>
          <Count value={selected ? selected.count : allCount} />
        </span>
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className={`h-3 w-3 shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>

      {open ? (
        <div className="neu-raised absolute left-0 top-full z-20 mt-2 w-full rounded-lg bg-paper p-3 sm:w-80">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={visible.length > 0 ? optionId(activeIndex) : undefined}
            aria-label={`Search ${label.toLowerCase()}`}
            autoComplete="off"
            spellCheck={false}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onSearchKeyDown}
            className="neu-inset w-full rounded-sm bg-transparent px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-offset-0"
          />
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="mt-3 max-h-56 overflow-y-auto sm:max-h-64 overscroll-contain"
          >
            {visible.map((option, index) => {
              const isSelected = (option.value === "" ? null : option.value) === value;
              return (
                <li
                  key={option.value || "__all"}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                  onMouseMove={() => setActiveIndex(index)}
                  className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-sm px-3 py-2 text-sm ${
                    index === activeIndex ? "neu-inset" : ""
                  } ${isSelected ? "font-bold text-teal-deep" : "text-ink"}`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  <Count value={option.count} />
                </li>
              );
            })}
          </ul>
          {visible.length === 0 ? (
            <p role="status" className="px-3 py-3 text-sm text-ink-muted">
              {emptyText}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return <span className="shrink-0 text-xs font-normal text-ink-faint">{value}</span>;
}

