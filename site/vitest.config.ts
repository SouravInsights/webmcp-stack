import { defineConfig } from "vitest/config";

/**
 * The site's tests run against a DOM: the dashboard is mounted into a shadow
 * root and its own script drives the markup, so the environment is the point
 * of the test, not a detail. Vitest resolves vitest and happy-dom from the
 * workspace root, the same way the codegen package runs its tests.
 */
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["**/*.test.ts"],
  },
});
