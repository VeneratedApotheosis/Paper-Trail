import type { PromotionsResponse } from "@/lib/api/types";
import type { SourceAccount } from "@/components/sourceAccounts";
import type { PromotionsViewProps } from "@/components/views/PromotionsView";

/** Maps GET /api/promotions (and the linked accounts from GET /api/account) onto the Promotions view's props. Pure. */
export interface PromotionsViewInput {
  data: PromotionsResponse;
  accounts: SourceAccount[] | undefined;
  showExpired: boolean;
  onShowExpiredChange: (show: boolean) => void;
  onCopyCode: PromotionsViewProps["onCopyCode"];
}

export function promotionsViewProps(input: PromotionsViewInput): PromotionsViewProps {
  const { data } = input;
  return {
    promotions: data.promotions,
    asOf: data.asOf,
    accounts: input.accounts,
    showExpired: input.showExpired,
    onShowExpiredChange: input.onShowExpiredChange,
    expiredHidden: data.expiredHidden,
    enriching: data.enriching,
    onCopyCode: input.onCopyCode,
  };
}

/** Writes text to the clipboard; rejects when the browser refuses (no permission, insecure page). */
export async function copyToClipboard(text: string, clipboard: Pick<Clipboard, "writeText"> | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard): Promise<void> {
  if (!clipboard) throw new Error("The clipboard is not available in this browser.");
  await clipboard.writeText(text);
}
