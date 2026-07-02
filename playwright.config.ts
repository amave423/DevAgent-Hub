import { defineConfig, devices } from "@playwright/test";

const browserChannel = process.env.E2E_BROWSER_CHANNEL || undefined;
const skipWebServer = process.env.E2E_NO_WEBSERVER === "1";
const secretMode = process.env.E2E_SECRET_MODE === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  preserveOutput: secretMode ? "never" : "failures-only",
  reporter: secretMode
    ? [["list"]]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 900 },
    trace: secretMode ? "off" : "retain-on-failure",
    screenshot: secretMode ? "off" : "only-on-failure",
    video: secretMode ? "off" : "retain-on-failure",
    ...(browserChannel ? { channel: browserChannel } : {}),
  },
  webServer: skipWebServer
    ? undefined
    : {
        command: "node scripts/e2e_web_server.js",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
        timeout: 180_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
