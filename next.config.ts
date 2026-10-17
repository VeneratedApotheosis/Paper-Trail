import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Pin the workspace root; a stray lockfile in a parent folder otherwise confuses Next.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
