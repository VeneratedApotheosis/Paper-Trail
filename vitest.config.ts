import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Tests never write the real ./papertrail.sqlite (labels, review corrections): the default database is in memory.
    env: { DATABASE_URL: ":memory:" },
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}", "tools/**/*.test.{ts,tsx}"],
  },
});
