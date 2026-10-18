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
  return (
    <div className="min-h-screen bg-paper">
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
