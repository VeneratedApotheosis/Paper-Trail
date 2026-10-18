export default function Footer() {
  return (
    <footer className="pt-10 pb-12" style={{ borderTop: "1px solid var(--rule)" }}>
      <div className="max-w-[1200px] mx-auto px-5 lg:px-12 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="font-heading text-[20px] font-semibold text-[color:var(--ink)]">PaperTrail</div>
        <p className="text-[13px] text-[color:var(--ink-faint)]">
          Read-only receipt intelligence. You stay in control.
        </p>
      </div>
    </footer>
  );
}