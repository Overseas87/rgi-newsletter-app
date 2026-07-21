import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:21412",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm run dev",
    cwd: import.meta.dirname,
    env: {
      PORT: "21412",
      NODE_ENV: "test",
      VITE_ADMIN_API_KEY: "browser-fixture-key",
    },
    url: "http://127.0.0.1:21412/opportunities",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
