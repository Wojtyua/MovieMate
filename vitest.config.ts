import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Minimal Vitest setup for the test-plan §3 Phase 1 suite.
// - node environment: the pure recommend() layer has zero astro:* runtime deps,
//   so unit tests run clean without Astro/Cloudflare shimming.
// - tsconfigPaths resolves the `@/*` -> `./src/*` alias from tsconfig.json so
//   source imports work unchanged inside tests.
// No global astro:env shim here — that resolution is scoped to the Phase 3
// integration test to keep the unit layer infra-free.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
  },
});
