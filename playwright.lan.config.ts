import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const frontendPort = process.env.MTC_LAN_E2E_FRONTEND_PORT ?? "4174";
const backendPort = process.env.MTC_LAN_E2E_BACKEND_PORT ?? "18766";
const sharedToken =
  process.env.MTC_LAN_E2E_TOKEN ?? "lan_e2e_token_1234567890abcdef";
const venvPython = resolve(
  process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python",
);
const python = process.env.MTC_E2E_PYTHON ?? (existsSync(venvPython) ? venvPython : "python");
const quotedPython = `"${python.replaceAll('"', '\\"')}"`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "lan-session.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `${quotedPython} -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port ${backendPort}`,
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        APP_HOST: "127.0.0.1",
        APP_PORT: backendPort,
        MTC_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
        MTC_INFERENCE_MODEL: "mock-deterministic",
        MTC_SHARED_TOKEN: sharedToken,
      },
    },
    {
      command: "node scripts/frontend-command.mjs dev",
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        APP_PORT: backendPort,
        MTC_FRONTEND_HOST: "127.0.0.1",
        MTC_FRONTEND_PORT: frontendPort,
        MTC_PACKAGE_MANAGER: "pnpm",
      },
    },
  ],
  projects: [
    {
      name: "mobile-chromium-lan",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
