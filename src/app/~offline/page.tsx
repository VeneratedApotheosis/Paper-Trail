import type { Metadata } from "next";
import { EmptyState } from "@/components/states";

export const metadata: Metadata = { title: "Offline · PaperTrail" };

// Fallback the service worker (src/app/sw.ts) shows when a page is opened without a connection.
export default function OfflinePage() {
  return (
    <EmptyState title="You're offline">PaperTrail needs a connection to read your ledger. Reconnect and reload the page.</EmptyState>
  );
}
