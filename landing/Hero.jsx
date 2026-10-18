import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import PrimaryButton from "../PrimaryButton";
import SecondaryButton from "../SecondaryButton";
import DemoVideo from "./DemoVideo";
import Reveal from "./Reveal";

export default function Hero() {
  return (
    <section id="top" className="max-w-[1200px] mx-auto px-5 lg:px-12 pt-10 lg:pt-20 pb-16 lg:pb-24">
      <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <Reveal>
          <p className="pt-eyebrow mb-4">Receipts into money back</p>
          <h1 className="font-heading text-[40px] lg:text-[56px] font-semibold tracking-tight leading-[1.05] text-[color:var(--ink)]">
            Get back the money your receipts say you're owed.
          </h1>
          <p className="mt-5 text-[16px] lg:text-[17px] text-[color:var(--ink-muted)] max-w-md leading-relaxed">
            PaperTrail reads your receipt emails, finds late refunds, closing return windows, and price drops, then drafts the claim. You send it yourself.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <PrimaryButton as={Link} to="/app" className="w-full sm:w-auto h-12 sm:h-11">
              Open the app
            </PrimaryButton>
            <SecondaryButton as="a" href="#features" className="w-full sm:w-auto h-12 sm:h-11">
              See what it does
            </SecondaryButton>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <span className="pt-inset rounded-full w-6 h-6 flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5 text-[color:var(--teal-deep)]" strokeWidth={3} />
            </span>
            <p className="text-[14px] text-[color:var(--ink-muted)]">
              Read-only access. PaperTrail never sends email or moves money.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <DemoVideo />
        </Reveal>
      </div>
    </section>
  );
}