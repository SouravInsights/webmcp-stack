import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { assetText } from "./assets.js";

/**
 * The build embeds these files (see the `?raw` imports in assets.ts) so the
 * shipped package never reads its own files at runtime. That embedding is
 * also the deployment fix: a runtime read is invisible to bundlers and file
 * tracers, which is how the hosted playground deployed without assets/ and
 * failed with "bundled asset missing".
 *
 * These tests are the guard on the other side: the embedded text must stay
 * byte-for-byte equal to the reviewed file, because a stale embed would ship
 * an old journey helper or agent skill and nothing else would notice.
 */

const ASSETS = new URL("../../assets/", import.meta.url);

describe("assetText", () => {
  it("returns each reviewed asset byte for byte", async () => {
    for (const name of ["journey.webmcp.ts", "skill/SKILL.md"]) {
      const onDisk = await readFile(new URL(name, ASSETS), "utf8");
      expect(await assetText(name)).toBe(onDisk);
    }
  });

  it("says which assets exist when asked for one that does not", async () => {
    await expect(assetText("nope.md")).rejects.toThrow(/unknown asset: nope\.md/);
    await expect(assetText("nope.md")).rejects.toThrow(/journey\.webmcp\.ts, skill\/SKILL\.md/);
  });
});
