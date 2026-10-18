import { EyeOff, Send, Lock, FlaskConical } from "lucide-react";
import SurfaceCard from "../SurfaceCard";
import Reveal from "./Reveal";

const ITEMS = [
  { icon: EyeOff, title: "Read-only by design", body: "We never write to or send from your inbox." },
  { icon: Send, title: "You send every claim", body: "No email leaves your account unless you press send." },
  { icon: Lock, title: "No money moves", body: "PaperTrail never touches your accounts or funds." },
  { icon: FlaskConical, title: "Demo data is synthetic", body: "Try the whole app without a real inbox." },
];

export default function TrustSection() {
  return (
    <section id="trust" className="py-16 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-5 lg:px-12">
        <Reveal>
          <p className="pt-eyebrow mb-3">Trust</p>
          <h2 className="font-heading text-[28px] lg:text-[36px] font-semibold tracking-tight text-[color:var(--ink)] max-w-2xl">
            Built so you stay in control of your inbox and your money.
          </h2>
        </Reveal>

        <div className="grid gap-6 mt-10 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item, i) => {
            const Icon = item.icon;
            return (
              <Reveal key={item.title} delay={i * 0.06}>
                <SurfaceCard radius={22} className="p-6 h-full">
                  <div className="pt-inset rounded-[16px] w-12 h-12 flex items-center justify-center mb-5">
                    <Icon className="w-6 h-6 text-[color:var(--teal-deep)]" strokeWidth={2} />
                  </div>
                  <h3 className="font-heading text-[18px] font-semibold text-[color:var(--ink)] mb-2">{item.title}</h3>
                  <p className="text-[14px] text-[color:var(--ink-muted)] leading-relaxed">{item.body}</p>
                </SurfaceCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}