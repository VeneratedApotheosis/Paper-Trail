import type { PromotionsResponse } from "@/lib/api/types";
import type { SourceAccount } from "@/components/sourceAccounts";
import type { PromotionsViewProps } from "@/components/views/PromotionsView";

/**
 * Maps GET /api/promotions (and the linked accounts from GET /api/account) onto the Promotions view's props. Pure.
 * `data` is null during the first load: the view then shows its own placeholder cards (`loading`).
 */
export interface PromotionsViewInput {
  data: PromotionsResponse | null;
  accounts: SourceAccount[] | undefined;
  showExpired: boolean;
  onShowExpiredChange: (show: boolean) => void;
  onCopyCode: PromotionsViewProps["onCopyCode"];
  onSyncInbox?: PromotionsViewProps["onSyncInbox"];
}

export function promotionsViewProps(input: PromotionsViewInput): PromotionsViewProps {
  const { data } = input;
  return {
    promotions: data?.promotions ?? [],
    asOf: data?.asOf ?? new Date(0).toISOString(),
    accounts: input.accounts,
    showExpired: input.showExpired,
    onShowExpiredChange: input.onShowExpiredChange,
    expiredHidden: data?.expiredHidden ?? 0,
    enriching: data?.enriching ?? false,
    loading: data === null,
    onCopyCode: input.onCopyCode,
    onSyncInbox: input.onSyncInbox,
  };
}

/** Writes text to the clipboard; rejects when the browser refuses (no permission, insecure page). */
export async function copyToClipboard(text: string, clipboard: Pick<Clipboard, "writeText"> | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard): Promise<void> {
  if (!clipboard) throw new Error("The clipboard is not available in this browser.");
  await clipboard.writeText(text);
}
