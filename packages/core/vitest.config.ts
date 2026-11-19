import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "core",
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
