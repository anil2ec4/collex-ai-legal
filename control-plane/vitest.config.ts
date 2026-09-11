import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // All tests are offline: no real network calls. The gateway test uses a
    // local in-process node:http mock server bound to 127.0.0.1.
  },
});
