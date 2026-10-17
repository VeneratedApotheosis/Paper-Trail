"use client";

import { useRouter } from "next/navigation";
import { SyncView } from "@/components/views/SyncView";

// Thin wrapper (issue #25): SyncView is props-only, so the page owns navigation.
// Real getPrefilter / loadDemo / uploadFiles wiring is a separate ui-wiring task,
// so onStart/onUpload are no-ops for the mock split and onComplete routes to the
// hero. The query mirrors deepdive §2/§5 (receipt-like, last 90 days).
const PLACEHOLDER_QUERY = "newer_than:90d category:purchases";

export default function SyncPage() {
  const router = useRouter();

  return (
    <SyncView
      query={PLACEHOLDER_QUERY}
      windowDays={90}
      onStart={() => {}}
      onUpload={() => {}}
      onComplete={() => router.push("/")}
      onCancel={() => {}}
    />
  );
}
