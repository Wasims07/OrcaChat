import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    setupFiles: ["./__tests__/setup.ts"],
    testTimeout: 15000,
  },
});
