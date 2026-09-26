import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Pick up the repo-root .env for local runs (CI can just set env vars).
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Integration tests share one database; run files serially to avoid cross-test interference.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
