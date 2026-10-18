import { createElement } from "react";
import type { AppShellViewProps } from "@/components/views/AppShellView";

// Sample props for previewing AppShellView in isolation. Standalone synthetic
// data (not from @/lib/mock) so the view stays decoupled from the data layer.
export const appShellViewFixture: AppShellViewProps = {
  activePath: "/ledger",
  mode: "demo",
  demoLabel: "Demo data \u2014 synthetic, not real purchases",
  onLeaveDemo: () => {},
  nav: [
    { href: "/", label: "Owed" },
    { href: "/ledger", label: "Ledger" },
    { href: "/review", label: "Review" },
    { href: "/trust", label: "Trust" },
  ],
  account: {
    initials: "SR",
    name: "Sample account",
    sublabel: "Demo data",
  },
  children: createElement("div", { className: "neu-inset rounded-lg p-6 text-ink" }, "Page content goes here"),
};
