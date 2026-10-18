import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Spectral, Hanken_Grotesk } from "next/font/google";
import { ShellStateProvider } from "@/hooks/shellState";
import { THEME_COLOR } from "./manifest";
import "./globals.css";

// Display serif for headings and the money figures (calm, bookish — Spectral).
const display = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

// UI/body grotesk with real tabular figures for aligned ledger amounts.
const ui = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PaperTrail",
  description: "Find the money your inbox says you're owed.",
  applicationName: "PaperTrail",
  appleWebApp: { capable: true, title: "PaperTrail", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body className="bg-paper font-sans text-ink antialiased">
        <ShellStateProvider>{children}</ShellStateProvider>
      </body>
    </html>
  );
}
