/**
 * The remembered-choices file: `.webmcp-codegen.json` at the project root.
 *
 * It is plain data - never code - so it works in the pure-npx flow (no
 * install needed) and can be read and written safely by the CLI and the dev
 * dashboard alike. It holds two kinds of things:
 *
 *   - choices we asked for once and should never ask again
 *     ("which of these packages is your web app?")
 *   - overrides   per-tool edits made in the dashboard (description,
 *                 enabled). They are applied after the safety review, so
 *                 they survive regeneration.
 *
 * The config file (codegen.config.mjs) stays the source of truth for
 * *structure* (sources, outputs, safety). This file is for *choices and
 * tweaks*. Editing it by hand is fine; it is meant to be committed.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolOverrides } from "./types.js";

export const DATA_FILE_NAME = ".webmcp-codegen.json";

export interface DataFile {
  /** The spec we used (or were told to use), relative to the project root. */
  spec?: string;
  /** The web app package directory, relative to the project root. */
  app?: string;
  /** Per-tool tweaks, keyed by tool name. */
  overrides?: ToolOverrides;
  /**
   * The tool names the last generate run produced, mapped to each tool's
   * route ref. The ref is the durable identity; the name is derived. This
   * ledger is how a rename between runs is reported and how overrides move
   * with the renamed tool instead of being orphaned.
   */
  names?: Record<string, string>;
}

export async function loadDataFile(cwd: string): Promise<DataFile> {
  try {
    const parsed = JSON.parse(await readFile(join(cwd, DATA_FILE_NAME), "utf8")) as DataFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Merge and write. Only the keys given are touched; everything already in
 * the file (especially overrides) survives. Writes nothing when the merged
 * result equals what's already there, so watch mode never loops on us.
 */
export async function saveDataFile(cwd: string, patch: Partial<DataFile>): Promise<void> {
  const current = await loadDataFile(cwd);
  const next: DataFile = { ...current, ...patch };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  await writeFile(join(cwd, DATA_FILE_NAME), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
