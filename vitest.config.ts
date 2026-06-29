import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./src", import.meta.url)) + "/",
      },
    ],
  },
  test: {
    environment: "edge-runtime",
    env: {
      NODE_ENV: "test",
      ALLOW_AUTH_TEST_BYPASS: "1",
    },
  },
});
