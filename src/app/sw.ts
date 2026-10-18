import { defaultCache } from "@serwist/next/worker";
import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

// PWA service worker (#44). Precaches the build's static assets and keeps the app shell installable and usable offline.
// API responses (ledger, orders, auth, claims) are never cached: receipt data stays on the server and delete-all keeps
// meaning what it says.

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [{ matcher: ({ url }) => url.pathname.startsWith("/api/"), handler: new NetworkOnly() }, ...defaultCache],
  fallbacks: {
    entries: [{ url: "/~offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();
