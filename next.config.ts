import { randomUUID } from "node:crypto";
import path from "node:path";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Pin the workspace root; a stray lockfile in a parent folder otherwise confuses Next.
  outputFileTracingRoot: path.join(__dirname),
};

// PWA service worker (#44): built from src/app/sw.ts into public/sw.js on `next build`; off in `next dev`.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // The offline fallback page in src/app/sw.ts; a new revision per build refreshes it.
  additionalPrecacheEntries: [{ url: "/~offline", revision: randomUUID() }],
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
