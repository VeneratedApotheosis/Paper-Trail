import type { ConnectViewProps } from "@/components/views/ConnectView";

// Sample props for previewing ConnectView in isolation, one per errorState.
// Callbacks are no-ops so the view stays decoupled from routing and the data
// layer.
const noop = () => {};

const baseCallbacks = {
  onConnect: noop,
  onTryDemo: noop,
} satisfies Pick<ConnectViewProps, "onConnect" | "onTryDemo">;

export const connectViewFixture: ConnectViewProps = {
  errorState: "none",
  ...baseCallbacks,
};

export const connectViewDemoLoadingFixture: ConnectViewProps = {
  errorState: "none",
  demoLoading: true,
  ...baseCallbacks,
};

export const connectViewAccessDeniedFixture: ConnectViewProps = {
  errorState: "access_denied",
  ...baseCallbacks,
};

export const connectViewTokenExpiredFixture: ConnectViewProps = {
  errorState: "token_expired",
  ...baseCallbacks,
};

export const connectViewOtherErrorFixture: ConnectViewProps = {
  errorState: "other",
  ...baseCallbacks,
};
