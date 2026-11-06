import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = process.env.E2E_DATABASE_URL ?? "postgres://rc@127.0.0.1:54329/rc_e2e";

export const E2E_ENV = {
  DATABASE_URL: DB,
  APP_URL: `http://localhost:${PORT}`,
  SITE_MODE: "preproduction",
  EMAIL_DRIVER: "file",
  MAIL_OUTBOX_DIR: "test-results/e2e-mail",
  TEAM_NOTIFICATION_EMAIL: "equipe@e2e.invalid",
  SESSION_SECRET: "e2e-session-secret-0123456789abcdefghij",
  HASH_SALT: "e2e-salt",
  CRON_SECRET: "e2e-cron-secret-123456",
  ADMIN_SETUP_TOKEN: "e2e-setup-token-123",
  MIN_FILL_MS: "0",
  FILE_ENCRYPTION_KEY: "ZTJlLWNsZS1kZS10ZXN0LTMyLW9jdGV0cy0xMjM0NTY=", // clé de TEST (32 octets), jamais en production
  RATE_LIMIT_REQUESTS: "1000",
  DEMO_ADMIN_EMAIL: "admin@demo.invalid",
  DEMO_ADMIN_PASSWORD: "demo-admin-1234",
};

/** 2e serveur (même build) volontairement mal configuré pour l'ouverture : doit rester fermé (P0-C). */
export const LOCKED_PORT = PORT + 1;
export const LOCKED_ENV = {
  ...E2E_ENV,
  APP_URL: `http://localhost:${PORT + 1}`,
  SITE_MODE: "production",
  LEGAL_TEXTS_VALIDATED: "false",
  PREVIEW_PASSWORD: "e2e-preview-secret",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "fr-FR", timezoneId: "Europe/Paris" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }, testIgnore: /preprod-lock\.spec\.ts/ },
    { name: "preprod-lock", use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORT + 1}` }, testMatch: /preprod-lock\.spec\.ts/ },
    { name: "mobile-390", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } }, testMatch: /(public|preorder)\.spec\.ts/ },
    { name: "mobile-375", use: { ...devices["Pixel 5"], viewport: { width: 375, height: 740 } }, testMatch: /public\.spec\.ts/ },
  ],
  webServer: [
    {
      command: process.env.E2E_SKIP_BUILD ? `npx tsx scripts/e2e-prepare.ts && npx next start -p ${PORT}` : `npx tsx scripts/e2e-prepare.ts && npx next build && npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/`,
      timeout: 300_000,
      reuseExistingServer: false,
      env: E2E_ENV,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `node scripts/wait-url.mjs http://localhost:${PORT}/ && npx next start -p ${PORT + 1}`,
      url: `http://localhost:${PORT + 1}/admin/login`,
      timeout: 360_000,
      reuseExistingServer: false,
      env: LOCKED_ENV,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
