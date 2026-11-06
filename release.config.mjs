import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./release-checks",
  outputDir: "./test-results-release",
  timeout: 45000,
  expect: { timeout: 10000 },
  globalTimeout: 240000,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results-release/summary.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4211",
    trace: "off",
    screenshot: "only-on-failure",
    actionTimeout: 7000,
  },
  projects: [
    {
      name: "chromium-production",
      testMatch: ["**/production.spec.mjs", "**/platform.spec.mjs"],
      use: {
        browserName: "chromium",
        channel: "chromium",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "touch-production",
      testMatch: "**/production.spec.mjs",
      use: {
        browserName: "chromium",
        channel: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 1,
      },
    },
    {
      name: "webkit-production",
      testMatch: "**/production.spec.mjs",
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 4211",
    url: "http://127.0.0.1:4211/game/index.html",
    reuseExistingServer: false,
    timeout: 30000,
    env: { NEXT_TELEMETRY_DISABLED: "1", WRANGLER_SEND_METRICS: "false" },
  },
});
