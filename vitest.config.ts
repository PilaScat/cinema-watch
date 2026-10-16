import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/live/**"],
    environment: "node",
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/server.ts"],
      reporter: ["text-summary", "text"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
        "src/web/**": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
      },
    },
  },
});
