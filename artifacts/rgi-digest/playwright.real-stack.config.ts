import path from "node:path";
import { defineConfig } from "@playwright/test";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for real-stack E2E.`);
  return value;
}

const projectId = requiredEnvironment("FIREBASE_PROJECT_ID");
const firestoreEmulatorHost = requiredEnvironment("FIRESTORE_EMULATOR_HOST");
const authEmulatorHost = requiredEnvironment("FIREBASE_AUTH_EMULATOR_HOST");

if (!projectId.startsWith("demo-")) {
  throw new Error(`Refusing real-stack E2E for non-demo project ${projectId}.`);
}
for (const [name, value] of [
  ["FIRESTORE_EMULATOR_HOST", firestoreEmulatorHost],
  ["FIREBASE_AUTH_EMULATOR_HOST", authEmulatorHost],
] as const) {
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(value)) {
    throw new Error(`${name} must be a loopback emulator host.`);
  }
}

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const frontendUrl = "http://127.0.0.1:21413";
const apiUrl = "http://127.0.0.1:3013";

const inheritedEnvironment = { ...process.env };
for (const name of Object.keys(inheritedEnvironment)) {
  if (
    name === "ADMIN_API_KEY" ||
    name === "FIREBASE_SERVICE_ACCOUNT_JSON" ||
    name === "GOOGLE_APPLICATION_CREDENTIALS" ||
    /^VITE_.*ADMIN.*KEY$/i.test(name)
  ) {
    delete inheritedEnvironment[name];
  }
}

function apiWebServer(port: string, overrides: Record<string, string>) {
  return {
    command: "node --enable-source-maps ./artifacts/api-server/dist/index.mjs",
    cwd: workspaceRoot,
    env: {
      ...inheritedEnvironment,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: port,
      FIREBASE_PROJECT_ID: projectId,
      FIRESTORE_EMULATOR_HOST: firestoreEmulatorHost,
      FIREBASE_AUTH_EMULATOR_HOST: authEmulatorHost,
      RGI_EDITOR_UIDS: "rgi-e2e-editor",
      PROFESSOR_LIBRARY_WRITES_ENABLED: "false",
      RGI_START_SCHEDULER: "false",
      RGI_INLINE_JOBS: "false",
      RGI_PRETTY_LOGS: "false",
      FRONTEND_URL: frontendUrl,
      ...overrides,
    },
    url: `http://127.0.0.1:${port}/api/readyz`,
    reuseExistingServer: false,
    timeout: 120_000,
  };
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/opportunities.real-stack.spec.ts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: frontendUrl,
    timezoneId: "America/New_York",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    apiWebServer("3013", {
      STORY_OPPORTUNITIES_READS_ENABLED: "true",
      STORY_OPPORTUNITIES_WRITES_ENABLED: "true",
      RGI_READ_ONLY_STARTUP: "false",
    }),
    apiWebServer("3014", {
      STORY_OPPORTUNITIES_READS_ENABLED: "false",
      STORY_OPPORTUNITIES_WRITES_ENABLED: "false",
      RGI_READ_ONLY_STARTUP: "false",
    }),
    apiWebServer("3015", {
      STORY_OPPORTUNITIES_READS_ENABLED: "true",
      STORY_OPPORTUNITIES_WRITES_ENABLED: "true",
      RGI_READ_ONLY_STARTUP: "true",
    }),
    {
      command: "pnpm run dev",
      cwd: import.meta.dirname,
      env: {
        ...inheritedEnvironment,
        PORT: "21413",
        NODE_ENV: "test",
        VITE_API_BASE_URL: apiUrl,
        VITE_FIREBASE_API_KEY: "demo-api-key",
        VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
        VITE_FIREBASE_PROJECT_ID: projectId,
        VITE_FIREBASE_APP_ID: "1:000000000000:web:demo",
        VITE_FIREBASE_AUTH_EMULATOR_URL: `http://${authEmulatorHost}`,
      },
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
