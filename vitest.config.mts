import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/report",
      reporter: ["text", "json-summary", "lcov"],
      include: [
        "packages/language-core/src/**/*.ts",
        "packages/language-server/src/{server,workspace-index}.ts",
        "packages/vscode-client/src/runner.ts",
      ],
      exclude: [
        "packages/language-server/src/{node,browser}.ts",
        "packages/vscode-client/src/{desktop,browser,common,preview}.ts",
      ],
      thresholds: { lines: 90, functions: 90, branches: 75, statements: 85 },
    },
    include: ["packages/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
