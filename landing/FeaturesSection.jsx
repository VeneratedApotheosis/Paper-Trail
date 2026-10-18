import { Inbox, RotateCcw, Clock, TrendingDown, MailCheck, ShieldCheck } from "lucide-react";
import SurfaceCard from "../SurfaceCard";
import Reveal from "./Reveal";

const FEATURES = [
  { icon: Inbox, title: "Reads your receipts", body: "Connects to your inbox read-only and turns every purchase into a row." },
  { icon: RotateCcw, title: "Finds refunds you're owed", body: "Late and short refunds, flagged the moment they go overdue." },
  { icon: Clock, title: "Watches return windows", body: "Tells you before a return window closes, so you act in time." },
  { icon: TrendingDown, title: "Catches price drops", body: "Spots drops after you bought and labels simulated prices honestly." },
  { icon: MailCheck, title: "Drafts your claim", body: "Writes a ready-to-send claim email with the evidence attached." },
  { icon: ShieldCheck, title: "You stay in control", body: "You approve and send every email. PaperTrail never sends or moves money." },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="max-w-[1200px] mx-auto px-5 lg:px-12 py-16 lg:py-24">
      <Reveal>
        <p className="pt-eyebrow mb-3">What it does</p>
        <h2 className="font-heading text-[28px] lg:text-[36px] font-semibold tracking-tight text-[color:var(--ink)] max-w-2xl">
          Everything PaperTrail does to find money you're owed.
        </h2>
      </Reveal>

      <div className="grid gap-6 mt-10 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => {
          const Icon = f.icon;
          return (
            <Reveal key={f.title} delay={i * 0.06}>
              <SurfaceCard radius={22} className="p-6 h-full">
                <div className="pt-inset rounded-[16px] w-12 h-12 flex items-center justify-center mb-5">
                  <Icon className="w-6 h-6 text-[color:var(--teal-deep)]" strokeWidth={2} />
                </div>
                <h3 className="font-heading text-[20px] font-semibold text-[color:var(--ink)] mb-2">{f.title}</h3>
                <p className="text-[15px] text-[color:var(--ink-muted)] leading-relaxed">{f.body}</p>
              </SurfaceCard>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}