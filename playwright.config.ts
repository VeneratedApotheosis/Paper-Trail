import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:3107", browserName: "chromium",
    screenshot: "only-on-failure", trace: "retain-on-failure",
    // The production build registers the PWA service worker (#44); keep it out so page.route mocks see every request.
    serviceWorkers: "block" },
  webServer: {
    command: "npm run start -- --hostname localhost --port 3107",
    url: "http://localhost:3107",
    reuseExistingServer: false,
    env: { AUTH_BASE_URL: "http://localhost:3107", GOOGLE_CLIENT_ID: "synthetic-e2e",
      GOOGLE_CLIENT_SECRET: "synthetic-e2e", AUTH_ENCRYPTION_KEY: "ab".repeat(32),
      ANTHROPIC_API_KEY: "", DATABASE_URL: "/tmp/papertrail-e2e.sqlite" },
  },
});
