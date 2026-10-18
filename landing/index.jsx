import LandingNav from "@/components/papertrail/landing/LandingNav";
import Hero from "@/components/papertrail/landing/Hero";
import FeaturesSection from "@/components/papertrail/landing/FeaturesSection";
import TrustSection from "@/components/papertrail/landing/TrustSection";
import PwaSection from "@/components/papertrail/landing/PwaSection";
import DeveloperSection from "@/components/papertrail/landing/DeveloperSection";
import Footer from "@/components/papertrail/landing/Footer";

export default function Landing() {
  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <LandingNav />
      <main>
        <Hero />
        <FeaturesSection />
        <TrustSection />
        <PwaSection />
        <DeveloperSection />
      </main>
      <Footer />
    </div>
  );
}