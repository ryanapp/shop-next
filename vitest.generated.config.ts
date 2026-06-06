import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/lib/discounts/generated/**/*.test.ts"],
    pool: "forks"
  }
});
