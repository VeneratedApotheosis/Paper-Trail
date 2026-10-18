import SurfaceCard from "../SurfaceCard";
import InsetChip from "../InsetChip";
import Reveal from "./Reveal";

const STEPS = [
  "Open PaperTrail in your mobile browser.",
  "Tap the Share button.",
  "Choose Add to Home Screen.",
  "Launch it from your home screen like an app.",
];

export default function PwaSection() {
  return (
    <section id="pwa" className="py-16 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-5 lg:px-12 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <Reveal>
          <p className="pt-eyebrow mb-3">On your phone</p>
          <h2 className="font-heading text-[28px] lg:text-[36px] font-semibold tracking-tight text-[color:var(--ink)]">
            Run PaperTrail as an app on your home screen.
          </h2>
          <p className="mt-3 text-[15px] text-[color:var(--ink-muted)] max-w-md">
            It's a progressive web app. No app store, no update hassle. It opens full screen and works like a native app.
          </p>
          <ol className="space-y-4 mt-8">
            {STEPS.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="pt-inset rounded-full w-8 h-8 flex items-center justify-center text-[14px] font-bold text-[color:var(--teal-deep)] shrink-0">
                  {i + 1}
                </span>
                <p className="text-[15px] text-[color:var(--ink-muted)] leading-snug pt-1">{step}</p>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="flex justify-center">
            <div className="pt-raised rounded-[40px] p-3 w-[260px]">
              <div className="pt-inset rounded-[30px] aspect-[9/19] p-5 flex flex-col">
                <div className="font-heading text-[18px] font-semibold tracking-tight text-[color:var(--ink)]">PaperTrail</div>
                <div className="mt-6">
                  <p className="pt-eyebrow">You're owed</p>
                  <div className="pt-money text-[32px] leading-none mt-1">$1,774.23</div>
                </div>
                <div className="mt-5 pt-inset rounded-[99px] h-2.5 p-[2px] overflow-hidden">
                  <div className="h-full rounded-[99px]" style={{ width: "63%", background: "linear-gradient(90deg, var(--teal-deep), var(--teal-bright))" }} />
                </div>
                <div className="mt-auto space-y-2">
                  <div className="pt-raised-sm rounded-[14px] h-10" />
                  <div className="pt-raised-sm rounded-[14px] h-10" />
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}