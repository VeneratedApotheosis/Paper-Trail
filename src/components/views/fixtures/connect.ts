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

// Synthetic example (not a real inbox) for the optional example prop.
export const connectViewExampleFixture: ConnectViewProps = {
  errorState: "none",
  ...baseCallbacks,
  example: {
    total: 1774.23,
    currency: "USD",
    items: [
      { label: "Refund overdue, Voltline", amount: 163.5 },
      { label: "Return window closing, Grandmart", amount: 134.22 },
    ],
  },
};
