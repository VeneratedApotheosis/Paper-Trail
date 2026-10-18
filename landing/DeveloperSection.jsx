import { Check, Terminal } from "lucide-react";
import SurfaceCard from "../SurfaceCard";
import PrimaryButton from "../PrimaryButton";
import SecondaryButton from "../SecondaryButton";
import Reveal from "./Reveal";

const POINTS = [
  "REST API for your findings and purchases.",
  "MCP server so AI clients can read your data.",
  "Webhooks the moment new money is found.",
  "Read-only scopes. Never send, never move.",
];

const CODE = `curl https://api.papertrail.app/v1/findings \\
  -H "Authorization: Bearer $PAPERTRAIL_KEY"

# => { "owed_total": 1774.23, "findings": 14 }`;

export default function DeveloperSection() {
  return (
    <section id="developers" className="py-16 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-5 lg:px-12 grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
        <Reveal className="min-w-0">
          <p className="pt-eyebrow mb-3">For developers</p>
          <h2 className="font-heading text-[28px] lg:text-[36px] font-semibold tracking-tight text-[color:var(--ink)]">
            Build on top of your receipt data.
          </h2>
          <p className="mt-3 text-[15px] text-[color:var(--ink-muted)] max-w-md">
            Pull findings into your tools, or let your AI assistant read them. PaperTrail stays read-only.
          </p>
          <ul className="space-y-3 mt-8">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3">
                <span className="pt-inset rounded-full w-6 h-6 flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-3.5 h-3.5 text-[color:var(--teal-deep)]" strokeWidth={3} />
                </span>
                <span className="text-[15px] text-[color:var(--ink-muted)] leading-snug">{p}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col sm:flex-row gap-3 mt-8">
            <PrimaryButton className="w-full sm:w-auto h-12 sm:h-11">Read the docs</PrimaryButton>
            <SecondaryButton className="w-full sm:w-auto h-12 sm:h-11">Get an API key</SecondaryButton>
          </div>
        </Reveal>

        <Reveal delay={0.1} className="min-w-0">
          <SurfaceCard radius={22} className="p-6 min-w-0">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-3 h-3 rounded-full" style={{ background: "var(--teal-bright)" }} />
              <span className="w-3 h-3 rounded-full" style={{ background: "var(--teal)" }} />
              <span className="w-3 h-3 rounded-full" style={{ background: "var(--teal-deep)" }} />
              <span className="ml-2 flex items-center gap-1.5 text-[13px] text-[color:var(--ink-faint)]">
                <Terminal className="w-3.5 h-3.5" /> findings.sh
              </span>
            </div>
            <pre className="pt-inset rounded-[16px] p-4 overflow-x-auto text-[13px] font-mono text-[color:var(--ink)] leading-relaxed whitespace-pre">
              <code>{CODE}</code>
            </pre>
          </SurfaceCard>
        </Reveal>
      </div>
    </section>
  );
}