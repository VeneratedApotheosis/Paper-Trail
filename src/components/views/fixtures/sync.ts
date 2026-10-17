import type { SyncViewProps } from "@/components/views/SyncView";

// Sample props for previewing SyncView in isolation. Standalone synthetic data
// (not from @/lib/mock) so the view stays decoupled from the data layer.
const noop = () => {};

export const syncViewFixture: SyncViewProps = {
  query: "newer_than:90d category:purchases",
  windowDays: 90,
  onStart: noop,
  onUpload: noop,
  onComplete: noop,
  onCancel: noop,
};
