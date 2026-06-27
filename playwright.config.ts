import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
