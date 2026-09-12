/**
 * Read a bundled asset (the skill file, the journey helper).
 *
 * These ship as files in the published package rather than as template
 * strings in source because they are also the reviewable artifacts - the
 * design docs and the docs site point at assets/ directly, and two sources
 * of truth would drift. The package publishes dist + assets; the two
 * candidate roots cover the built layout (dist/x.js -> ../assets) and the
 * source tree under test (src/outputs/x.ts -> ../../assets).
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function assetText(name: string): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "assets", name), join(here, "..", "..", "assets", name)];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try the next layout.
    }
  }
  throw new Error(
    `webmcp-codegen: bundled asset missing: ${name} (looked in ${candidates.join(", ")})`,
  );
}
