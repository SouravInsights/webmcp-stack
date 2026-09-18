/**
 * `?raw` imports come back as strings.
 *
 * vitest resolves them natively; the published build does it with the plugin
 * in tsup.config.ts. Mirrors what vite/client declares for the same syntax.
 */
declare module "*?raw" {
  const text: string;
  export default text;
}
