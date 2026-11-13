import { defineConfig, devices, chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (!process.env.CI && !existsSync(chromium.executablePath()) && existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

export default defineConfig({
  testDir: "./test/browser",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  outputDir: "./test-results",
  use: {
    baseURL: "http://127.0.0.1:4174/Intent-Guard/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(browserExecutable ? { launchOptions: { executablePath: browserExecutable } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: {
    command: "npm run preview -- --port 4174 --base-path /Intent-Guard/",
    url: "http://127.0.0.1:4174/Intent-Guard/",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
