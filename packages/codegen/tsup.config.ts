import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineConfig, type Options } from "tsup";

/**
 * The build, plus one plugin.
 *
 * `?raw` imports (see src/outputs/assets.ts) are how the agent skill and the
 * journey helper travel: vitest resolves them natively, and this plugin does
 * the same for the shipped build, so the package carries their text instead
 * of reading its own files at runtime.
 *
 * That matters beyond tidiness. A runtime read of a package's own files is
 * invisible to bundlers and file tracers, and the hosted playground deployed
 * without assets/ and threw "bundled asset missing" in production. With the
 * text embedded, no host has to be told about these files at all.
 */
const embedRawAssets: NonNullable<Options["esbuildPlugins"]>[number] = {
  name: "embed-raw-assets",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      // The real path, without the suffix, resolved from the importer.
      path: resolve(dirname(args.importer), args.path.replace(/\?raw$/, "")),
      namespace: "raw-asset",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw-asset" }, async (args) => ({
      contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))};`,
      loader: "js",
    }));
  },
};

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/sources/index.ts",
    "src/outputs/index.ts",
    "src/dev/index.ts",
    "src/dev/server.ts",
    "src/dev/ui.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  esbuildPlugins: [embedRawAssets],
});
