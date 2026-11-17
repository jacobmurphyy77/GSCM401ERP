import { defineConfig } from "@playwright/test";
import { mkdirSync, existsSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
const mount = "/tmp/wcw-mocked-ui-site";
mkdirSync(mount, { recursive: true });
if (!existsSync(`${mount}/GSCM401ERP`)) symlinkSync(resolve("out"), `${mount}/GSCM401ERP`, "dir");
export default defineConfig({
  testDir: "./tests/ui",
  timeout: 30_000,
  workers: 1,
  reporter: "line",
  outputDir: "/tmp/wcw-mocked-ui-results",
  use: { baseURL: "http://127.0.0.1:4173", viewport: { width: 1440, height: 1000 }, headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage"] }, screenshot: "only-on-failure" },
  webServer: { command: `node node_modules/serve/build/main.js ${mount} -l 4173`, port: 4173, reuseExistingServer: true, timeout: 15_000 },
});
