import type { Config } from "tailwindcss";

// "Calm editorial ledger" palette (scope_features §9): warm paper, ink, one signal colour per state.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#faf6ee",
        ink: "#1a1814",
        owed: "#d6401f", // vermilion = owed
        deadline: "#c98a0b", // amber = deadline
        saved: "#2f7d4f", // green = saved
      },
    },
  },
  plugins: [],
};

export default config;
