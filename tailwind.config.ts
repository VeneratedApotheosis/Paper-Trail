import type { Config } from "tailwindcss";

// PaperTrail design system (#9) — "calm editorial ledger".
// Warm paper base, ink numerals, one signal colour per state, sparing receipt
// perforation. Palette and scale documented in docs/design-system.md.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces — unbleached ledger paper, warm not grey.
        paper: {
          DEFAULT: "#faf6ee",
          raised: "#fffdf8", // cards / rows that sit above the page
          sunk: "#f1ebdd", // wells, insets, table headers
        },
        // Ink — warm near-black, never pure #000.
        ink: {
          DEFAULT: "#1a1814",
          muted: "#6b6358", // secondary text, labels
          faint: "#9a9185", // tertiary / disabled
        },
        rule: "#ded5c4", // hairline ledger rules and borders
        // Signal colours — exactly one meaning each (scope_features §3/§9).
        owed: {
          DEFAULT: "#c23a1b", // money you're owed (vermilion)
          tint: "#f7e7df", // faint wash behind owed figures
        },
        deadline: {
          DEFAULT: "#b07a09", // closing window (amber/ochre)
          tint: "#f6edd6",
        },
        saved: {
          DEFAULT: "#2f7d4f", // resolved / money saved (green)
          tint: "#e2efe5",
        },
      },
      fontFamily: {
        serif: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-ui)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Modular scale (~1.25), editorial. Line-heights tuned per role.
        label: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.55rem" }],
        lg: ["1.125rem", { lineHeight: "1.6rem" }],
        xl: ["1.4rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.85rem", { lineHeight: "2rem" }],
        "3xl": ["2.5rem", { lineHeight: "2.5rem" }],
        hero: ["4.25rem", { lineHeight: "1", letterSpacing: "-0.02em" }],
      },
      borderColor: {
        DEFAULT: "#ded5c4",
      },
      borderRadius: {
        sm: "3px",
        DEFAULT: "6px",
        lg: "10px",
      },
      boxShadow: {
        // One quiet shadow; cards are mostly defined by hairline rules, not shadow.
        raised: "0 1px 2px rgba(26, 24, 20, 0.05)",
      },
      maxWidth: {
        ledger: "46rem", // ~72ch reading measure for ledger content
      },
      keyframes: {
        "fade-rise": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-rise": "fade-rise 0.4s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
