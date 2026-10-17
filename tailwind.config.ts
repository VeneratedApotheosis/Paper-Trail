import type { Config } from "tailwindcss";

// PaperTrail design system — neumorphic "soft UI" direction.
// Cool slate base, soft dual shadows (raised + inset), dark-teal serif money,
// one teal accent. No traffic-light colours. Documented in docs/design-system.md.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Single base surface. Cards are the same colour as the page and are
        // defined by soft shadows, not by fills or borders.
        paper: {
          DEFAULT: "#dbe1ea",
          raised: "#e4e9f1", // faint diagonal sheen on raised cards
          sunk: "#cfd6e2", // inset wells
        },
        ink: {
          DEFAULT: "#1e2633",
          muted: "#586273",
          faint: "#8a93a3",
        },
        rule: "#c3ccd9",
        // One accent: a lighter, saturated teal (gradient stops live in CSS).
        teal: {
          DEFAULT: "#15a0ab",
          bright: "#22c3cd",
          deep: "#0e7079",
        },
        // Money / "owed" values: a deep, confident teal set in the serif.
        money: "#0a545b",
        // Soft-shadow endpoints (for arbitrary rgba use).
        shadowdark: "#b2bccb",
        shadowlight: "#f3f7fc",
      },
      fontFamily: {
        // Display serif = Spectral (see src/app/layout.tsx).
        serif: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-ui)", "system-ui", "sans-serif"],
      },
      fontSize: {
        label: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.08em" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.55rem" }],
        lg: ["1.125rem", { lineHeight: "1.6rem" }],
        xl: ["1.4rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.85rem", { lineHeight: "2rem" }],
        "3xl": ["2.5rem", { lineHeight: "1.05" }],
        hero: ["4.5rem", { lineHeight: "1", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        sm: "10px",
        DEFAULT: "16px",
        lg: "22px",
        xl: "28px",
      },
      boxShadow: {
        // Neumorphic raised (light from top-left). Softer = larger blur.
        "soft-sm": "6px 6px 14px rgba(176,188,206,0.6), -6px -6px 14px rgba(248,251,255,0.85)",
        soft: "8px 8px 20px rgba(176,188,206,0.6), -8px -8px 20px rgba(248,251,255,0.9)",
        "soft-lg": "12px 12px 30px rgba(176,188,206,0.75), -12px -12px 30px rgba(248,251,255,0.95)",
        // Pressed / inset.
        "inset-sm": "inset 3px 3px 7px rgba(176,188,206,0.8), inset -3px -3px 7px rgba(248,251,255,0.9)",
        inset: "inset 4px 4px 10px rgba(176,188,206,0.8), inset -4px -4px 10px rgba(248,251,255,0.9)",
      },
      maxWidth: {
        ledger: "44rem",
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
