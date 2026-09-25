import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "bundle",
    environment: "node",
    include: ["tests/bundle/**/*.test.ts"],
  },
});
