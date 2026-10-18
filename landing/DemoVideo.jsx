import { Play } from "lucide-react";
import SurfaceCard from "../SurfaceCard";

/**
 * Drop a real demo video in by passing a `src`.
 * Without one it shows a neumorphic app preview with a play button.
 */
export default function DemoVideo({ src }) {
  return (
    <SurfaceCard radius={28} className="p-3 lg:p-4">
      <div className="pt-inset rounded-[20px] aspect-video relative overflow-hidden">
        {src ? (
          <video
            src={src}
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-full object-cover rounded-[20px]"
          />
        ) : (
          <div className="absolute inset-0 p-5 lg:p-7 flex flex-col">
            <div className="flex items-center justify-between">
              <span className="font-heading text-[15px] font-semibold text-[color:var(--ink)]">PaperTrail</span>
              <span className="pt-inset rounded-[99px] px-2 h-5 flex items-center text-[11px] font-semibold text-[color:var(--ink-muted)]">
                Demo
              </span>
            </div>
            <div className="mt-4 lg:mt-6">
              <p className="pt-eyebrow">You're owed</p>
              <div className="pt-money text-[28px] lg:text-[40px] leading-none mt-1">$1,774.23</div>
            </div>
            <div className="mt-4 lg:mt-5 pt-inset rounded-[99px] h-2.5 p-[2px] overflow-hidden flex">
              <div className="h-full" style={{ width: "63%", background: "var(--teal-deep)" }} />
              <div className="h-full" style={{ width: "30%", background: "var(--teal)" }} />
              <div className="h-full" style={{ width: "7%", background: "var(--teal-bright)" }} />
            </div>
            <div className="mt-auto space-y-2">
              <div className="pt-raised-sm rounded-[12px] h-9" />
              <div className="pt-raised-sm rounded-[12px] h-9 w-3/4" />
            </div>

            <button
              type="button"
              aria-label="Play demo"
              className="pt-accent pt-focus absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full flex items-center justify-center"
            >
              <Play className="w-7 h-7 text-white ml-1" fill="currentColor" />
            </button>
          </div>
        )}
      </div>
      <p className="text-[13px] text-[color:var(--ink-faint)] text-center mt-3">A 60-second walkthrough</p>
    </SurfaceCard>
  );
}