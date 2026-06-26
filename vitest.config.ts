import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    testTimeout: 20000,
    include: ["test/**/*.test.ts"],
  },
});
