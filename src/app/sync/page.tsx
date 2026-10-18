import { SyncClient } from "./SyncClient";

// Thin wrapper for /sync (#73). The flow depends on the browser's Gmail session, so the client wrapper reads it and
// runs the Gmail sync (connected) or the .eml/.mbox import and demo load (not connected). Nothing runs on page load
// except the session check and the read-only preview; every sync, import, or demo load is an explicit click.
export default function SyncPage() {
  return <SyncClient />;
}
