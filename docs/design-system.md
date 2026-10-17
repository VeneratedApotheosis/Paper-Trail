# PaperTrail design system — neumorphic "soft UI"

Direction: soft, tactile UI on a single cool-slate surface. Cards and controls
are the same colour as the page, defined by **soft dual shadows** (light top-left,
dark bottom-right) rather than fills or borders. One teal accent; money values in
a deep teal serif. No traffic-light colours, no gradient blobs. Lean copy, no em
dashes. Reference: Paper file "Soft UI" artboards.

Tokens live in `tailwind.config.ts`; CSS vars + neumorphic utilities in
`src/app/globals.css`.

## Colour
| Token | Hex | Use |
|---|---|---|
| `paper` | `#dbe1ea` | base surface (page + cards) |
| `paper-raised` | `#e4e9f1` | faint card sheen |
| `paper-sunk` | `#cfd6e2` | inset wells |
| `ink` | `#1e2633` | primary text |
| `ink-muted` | `#586273` | secondary text |
| `ink-faint` | `#8a93a3` | tertiary |
| `teal` / `teal-bright` / `teal-deep` | `#15a0ab` / `#22c3cd` / `#0e7079` | the one accent (buttons, links, active nav) |
| `money` | `#0a545b` | money / "owed" values, always in the serif |

## Shadows (the core of the look)
Use the utilities, not ad-hoc shadows:
- `.neu-raised` / `.neu-raised-sm` — extruded cards and controls.
- `.neu-inset` — pressed chips, wells, input fields, active nav.
- `.neu-accent` — teal gradient primary action.
- Tailwind `shadow-soft` / `shadow-soft-lg` / `shadow-inset` are also available.

## Typography
- **Spectral** (serif, `font-serif`): money figures, headings, wordmark.
- **Hanken Grotesk** (sans, `font-sans`): UI/body, with global tabular figures.
- `.eyebrow` for small-caps section labels.
- Scale in `tailwind.config.ts`; radii are large (`rounded-lg` = 22px, `rounded-xl` = 28px).

## Layout
- `AppShell` is responsive: soft left **sidebar** on `md+`, neumorphic **bottom tab bar** on mobile.
- Content width capped at `max-w-ledger`.

## Accessibility & motion
- `:focus-visible` is a 2px teal outline. Keep it.
- `prefers-reduced-motion` disables animation/transition globally.
- Keep text at accessible contrast even where chrome stays soft.
