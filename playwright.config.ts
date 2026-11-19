import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    trace: "retain-on-failure",
  },
  // The built site, as Pages serves it, rather than the dev server.
  webServer: {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "apps/web",
    url: `http://127.0.0.1:${port}/listen/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
