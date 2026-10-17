# PaperTrail design system (#9)

Direction: **calm editorial ledger** (scope_features §3/§9). Warm paper, ink
numerals, tabular figures, exactly one signal colour per state, sparing receipt
perforation. No gradients, no purple, no generic-SaaS card kit. The hero figure
is the one bold moment; everything around it stays quiet.

Tokens live in `tailwind.config.ts` (source of truth) and are mirrored as CSS
vars in `src/app/globals.css` for raw motifs.

## Colour

| Token | Hex | Use |
|---|---|---|
| `paper` | `#faf6ee` | page background (unbleached ledger paper) |
| `paper-raised` | `#fffdf8` | cards / rows above the page |
| `paper-sunk` | `#f1ebdd` | wells, insets, table headers |
| `ink` | `#1a1814` | primary text / numerals (warm near-black) |
| `ink-muted` | `#6b6358` | secondary text, labels |
| `ink-faint` | `#9a9185` | tertiary / disabled |
| `rule` | `#ded5c4` | hairline ledger rules + borders |
| `owed` | `#c23a1b` | money you're owed — **vermilion**, one meaning only |
| `deadline` | `#b07a09` | closing window — **amber/ochre** |
| `saved` | `#2f7d4f` | resolved / money saved — **green** |

Each signal colour has a `-tint` wash (e.g. `bg-owed-tint`) for faint backgrounds.
Signal colours are reserved for their one meaning — never decorative.

## Typography

- **Display / headings / hero figure:** Fraunces (serif, editorial), via `font-serif`.
- **UI / body / ledger amounts:** Inter, via `font-sans`, with `tabular-nums`
  (set globally on `body`) so amounts align column to column.
- Scale (`tailwind.config.ts` `fontSize`): `label`, `sm`, `base`, `lg`, `xl`,
  `2xl`, `3xl`, `hero`. Reading measure capped at `max-w-ledger` (~72ch).

## Receipt-perforation motif (use sparingly)

- `.perf-rule` — a dashed hairline; a ledger rule / receipt perforation. Use to
  mark a section tear, not as a divider everywhere.
- `.perf-edge` — a scalloped torn-receipt bottom edge (CSS mask). Reserve for the
  cover / hero receipt moment.
- `.col-head` — small-caps letterspaced column header for **real** tables only.

## Accessibility & motion

- `:focus-visible` shows a 2px `owed` outline — never remove focus styling.
- `prefers-reduced-motion` disables animation/transition globally (globals.css).
- Signal colours pair with text/icon labels, never colour alone.

## Shared building blocks

- Primitives: `src/components/ui/Button.tsx`, `src/components/ui/Chip.tsx`.
- System states (#26): `src/components/states/` + `src/components/DemoBanner.tsx`.
- Page chrome: `src/components/AppShell.tsx`.
- UI contract + mock data: `src/lib/types.ts`, `src/lib/format.ts`, `src/lib/mock/data.ts`.
