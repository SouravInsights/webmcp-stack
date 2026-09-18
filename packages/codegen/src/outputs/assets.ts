/**
 * Read a bundled asset (the skill file, the journey helper).
 *
 * These ship as files in the published package rather than as template
 * strings in source because they are also the reviewable artifacts - the
 * design docs and the docs site point at assets/ directly, and two sources
 * of truth would drift. assets/ stays the source; the *build* embeds a
 * snapshot of it (the `?raw` imports below), so the shipped code carries the
 * text and never reads its own files at runtime.
 *
 * That second part is not a micro-optimization. A runtime readFile() of a
 * package's own files is invisible to bundlers and file tracers, and the
 * hosted playground shipped without assets/ and threw "bundled asset
 * missing" in production. Embedding removes the runtime read, so no host
 * has to be told about these files. Add the import for any new asset.
 */

import journeyHelper from "../../assets/journey.webmcp.ts?raw";
import agentSkill from "../../assets/skill/SKILL.md?raw";

/** Every asset a host can ask for, embedded at build time. */
const ASSETS: Record<string, string> = {
  "journey.webmcp.ts": journeyHelper,
  "skill/SKILL.md": agentSkill,
};

export async function assetText(name: string): Promise<string> {
  const text = ASSETS[name];
  if (text === undefined) {
    throw new Error(
      `webmcp-codegen: unknown asset: ${name}. ` +
        `Add it to src/outputs/assets.ts. Known: ${Object.keys(ASSETS).join(", ")}.`,
    );
  }
  return text;
}
