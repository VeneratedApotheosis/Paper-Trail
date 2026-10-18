import { Button } from "@/components/ui/Button";

export function FinalCta({
  onOpenApp,
  onConnectGmail,
  onTryDemo,
}: {
  onOpenApp: () => void;
  onConnectGmail?: () => void;
  onTryDemo?: () => void;
}) {
  return (
    <section className="mx-auto max-w-ledger px-5 py-16 xl:max-w-5xl xl:px-0 xl:py-24">
      <div className="neu-raised soft-lg mx-auto flex max-w-2xl flex-col items-center rounded-2xl p-10 text-center sm:p-14">
        <h2 className="font-serif text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Find money your receipts say you&apos;re owed
        </h2>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Button variant="primary" onClick={onConnectGmail ?? onOpenApp}>
            Connect Gmail
          </Button>
          <Button variant="secondary" onClick={onTryDemo ?? onOpenApp}>
            Try demo data
          </Button>
        </div>
        <p className="mt-4 text-sm text-ink-muted">Demo data is synthetic. No real inbox needed.</p>
      </div>
    </section>
  );
}
