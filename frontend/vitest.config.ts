import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest config, separate from vite.config.ts so the dev/build path stays
// unaffected. Run with `npm test` (watch) or `npm run test:ci` (one-shot).
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Test files live next to source as `*.test.ts(x)` or `*.spec.ts(x)`,
    // OR under any __tests__ folder. We keep it broad now and tighten
    // later if globbing slows.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
