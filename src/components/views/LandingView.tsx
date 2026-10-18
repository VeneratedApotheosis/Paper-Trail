"use client";

import { useEffect, useRef } from "react";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { FindingsShowcase } from "@/components/landing/FindingsShowcase";
import { TrustHighlights } from "@/components/landing/TrustHighlights";
import { FinalCta } from "@/components/landing/FinalCta";
import { LandingFooter } from "@/components/landing/LandingFooter";

// Props-only marketing landing page view (ui-design, issue #145). Composes the
// real app components (HeroCard, OwedBreakdown, FindingCard, OwedIntro's
// steps, TrustView's copy) with sample data clearly labeled, so the page shows
// what the product actually does rather than an invented mockup. No fetch, no
// @/lib/api|store|mock|auth, no routing: wiring onOpenApp/onConnectGmail/
// onTryDemo to real routes is a separate ui-wiring task.
export interface LandingViewProps {
  onOpenApp: () => void;
  onConnectGmail?: () => void;
  onTryDemo?: () => void;
}

export function LandingView({ onOpenApp, onConnectGmail, onTryDemo }: LandingViewProps) {
  const root = useRef<HTMLDivElement>(null);

  // Scroll reveal: sections below the hero fade up once as they enter the screen. Everything is visible until this
  // runs (and without JS), so the server render never hides content.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const sections = Array.from(el.querySelectorAll<HTMLElement>("main > section:not(#top)"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    for (const section of sections) {
      section.classList.add("reveal");
      observer.observe(section);
    }
    el.classList.add("reveal-ready");
    return () => {
      observer.disconnect();
      el.classList.remove("reveal-ready");
      for (const section of sections) section.classList.remove("reveal", "is-visible");
    };
  }, []);

  return (
    <div ref={root} className="min-h-screen bg-paper">
      <LandingNav />
      <main>
        <LandingHero onOpenApp={onOpenApp} onConnectGmail={onConnectGmail} onTryDemo={onTryDemo} />
        <HowItWorksSection />
        <FindingsShowcase onOpenApp={onOpenApp} />
        <TrustHighlights />
        <FinalCta onOpenApp={onOpenApp} onConnectGmail={onConnectGmail} onTryDemo={onTryDemo} />
      </main>
      <LandingFooter />
    </div>
  );
}
