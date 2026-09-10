/**
 * The `tools` output, named after what lands in your repo: one file per
 * tool, calling the spec's imperative API
 * (`document.modelContext.registerTool`).
 *
 * Output layout for `tools({ outDir: "./src/webmcp" })`:
 *
 *   src/webmcp/
 *   ├── runtime.webmcp.ts          ← fully generated, never edit
 *   ├── index.ts                   ← fully generated, registers everything
 *   ├── get-order-status.webmcp.ts ← generated contract + YOUR execute()
 *   └── ...
 *
 * Each per-tool file has two regions, divided by marker comments:
 *
 *   generated region   schema, input type, tool definition, register()
 *   ── end generated ── everything below survives regeneration
 *   your region        execute(), scaffolded once, then owned by you
 *
 * A tool's identity is its source ref (the endpoint, or the declared schema
 * entry), not its filename. Every file's generated header records that ref,
 * and we read it back before splicing: a rename between runs carries the
 * owned execute() to the new filename, and a tool that lands on a renamed
 * endpoint's old file never inherits a stranger's body.
 *
 * This file contains only the *file mechanics*: which files exist, and how to
 * update them without destroying hand-written code. The text of the generated
 * code itself lives in tools-templates.ts, keeping "what the output looks like"
 * separate from "how files get written" is what keeps both readable.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { GeneratedFile, Output, ReviewedTool } from "../types.js";
import { assetText } from "./assets.js";
import {
  barrelSource,
  generatedRegion,
  ownedRegionScaffold,
  runtimeSource,
} from "./tools-templates.js";

export interface ToolsOutputOptions {
  /** Where the tool files go, relative to the project root. */
  outDir: string;
  /**
   * The spec's `exposedTo`: secure origins (embedded documents at these
   * origins) the registered tools are shared with. Absent means the default —
   * tools are visible to the page itself, same-origin documents, and the
   * browser's built-in agent. Only list origins you trust to act for your user.
   */
  exposedTo?: string[];
}

/**
 * The marker lines that split a per-tool file in two. They are the merge
 * contract: we may rewrite everything up to and including GENERATED_END,
 * and we must never touch anything after it. tools-templates.ts imports
 * these so the marker text is defined in exactly one place.
 */
export const GENERATED_START = "// ─── webmcp-codegen: generated. Do not edit this region. ───";
export const GENERATED_END =
  "// ─── webmcp-codegen: end generated. Your code below survives regeneration. ───";

/** Create the `tools` output for the config's `outputs` array. */
export function tools(options: ToolsOutputOptions): Output {
  return {
    kind: "tools",
    outDir: options.outDir,
    async generate(tools, cwd) {
      // resolve, not join: an absolute outDir must win over cwd, not nest
      // under it.
      const outDir = resolve(cwd, options.outDir);

      // Read every existing tool file up front. All reads happen before any
      // write, so two tools swapping filenames each still read the other's
      // original contents.
      const existing = new Map<string, string>();
      try {
        for (const entry of await readdir(outDir)) {
          if (!entry.endsWith(".webmcp.ts") || entry === "runtime.webmcp.ts") continue;
          // The journey factory is generator-owned (regenerated wholesale
          // below), never an orphan candidate.
          if (entry === "journey.webmcp.ts") continue;
          const path = join(outDir, entry);
          existing.set(path, await readFile(path, "utf8"));
        }
      } catch {
        // First run: the directory does not exist yet.
      }

      // Journey definitions the user (or their agent) wrote since the last
      // run. The barrel imports and registers them; dropping a new file in
      // here and re-running generate is the whole wiring story.
      let journeyFiles: string[] = [];
      try {
        journeyFiles = (await readdir(join(outDir, "journeys")))
          .filter((entry) => entry.endsWith(".webmcp.ts"))
          .sort();
      } catch {
        // No journeys directory yet — most repos, most of the time.
      }

      // Endpoint ref → the file currently holding it.
      const pathByRef = new Map<string, string>();
      for (const [path, contents] of existing) {
        const ref = sourceRefOf(contents);
        if (ref !== undefined) pathByRef.set(ref, path);
      }

      const files: GeneratedFile[] = [];
      const consumedPaths = new Set<string>();

      for (const tool of tools) {
        const ownPath = join(outDir, `${tool.name}.webmcp.ts`);
        const atOwnPath = existing.get(ownPath);
        const notes: string[] = [];

        // Find the file that belongs to this tool. In order: the file at
        // its own filename when the ref matches (or a legacy file with no
        // Source header to check), then any file holding its ref (a rename).
        let sourcePath: string | undefined;
        if (atOwnPath !== undefined && sourceRefOf(atOwnPath) === undefined) {
          sourcePath = ownPath;
        } else if (atOwnPath !== undefined && sourceRefOf(atOwnPath) === tool.source.ref) {
          sourcePath = ownPath;
        } else if (pathByRef.get(tool.source.ref) !== undefined) {
          sourcePath = pathByRef.get(tool.source.ref);
          if (sourcePath !== undefined && sourcePath !== ownPath) {
            notes.push(
              `Followed the rename from ${basename(sourcePath)}; your execute() came with it.`,
            );
          }
        }

        if (sourcePath !== undefined) {
          consumedPaths.add(sourcePath);
          files.push(
            toolFile(
              tool,
              ownPath,
              existing.get(sourcePath),
              atOwnPath !== undefined && sourcePath !== ownPath,
              notes,
              options.exposedTo,
            ),
          );
        } else if (atOwnPath !== undefined) {
          // A stranger sits at our path: its ref belongs to no live tool, so
          // nothing else will carry its contents away. Set it aside rather
          // than destroy a possibly hand-edited execute().
          const strangerRef = sourceRefOf(atOwnPath);
          const aside = await plainFile(`${ownPath}.orphaned`, atOwnPath);
          aside.notes = [
            `${basename(ownPath)} held a different endpoint's code` +
              (strangerRef ? ` (${strangerRef})` : "") +
              `. Set aside at ${basename(ownPath)}.orphaned; review it, then delete both.`,
          ];
          files.push(aside);
          consumedPaths.add(ownPath);
          files.push(toolFile(tool, ownPath, undefined, true, notes, options.exposedTo));
        } else {
          // Brand new tool: lay down the execute() scaffold with it.
          files.push(toolFile(tool, ownPath, undefined, false, notes, options.exposedTo));
        }
      }

      // Orphans: files sitting at a path no live tool owns. We never delete;
      // we report, and the developer deletes when ready.
      const orphanNotes: string[] = [];
      for (const path of existing.keys()) {
        if (consumedPaths.has(path)) continue;
        if (tools.some((tool) => join(outDir, `${tool.name}.webmcp.ts`) === path)) continue;
        orphanNotes.push(
          `${basename(path)} is no longer generated. Delete it once you have moved out anything you wrote.`,
        );
      }

      // The runtime and the barrel are regenerated wholesale every run;
      // their headers say "do not edit", and we mean it. Orphan reports ride
      // on the barrel so they surface even when nothing else changed.
      const barrel = await plainFile(join(outDir, "index.ts"), barrelSource(tools, journeyFiles));
      barrel.notes = [...orphanNotes, ...(barrel.notes ?? [])];
      files.unshift(await plainFile(join(outDir, "runtime.webmcp.ts"), runtimeSource()), barrel);

      // The journey factory: fully ours, regenerated wholesale like the
      // runtime. Journey definitions (the user's code) import createJourney
      // from it.
      files.push(
        await plainFile(join(outDir, "journey.webmcp.ts"), await assetText("journey.webmcp.ts")),
      );

      // The skill file: the rules harness for the user's own coding agents,
      // at the cross-client skills location. Regenerated wholesale like the
      // runtime — its header comment says why (project rules belong in the
      // user's own skill directory, which stacks on top).
      const skillFile = await plainFile(
        resolve(cwd, ".agents/skills/webmcp-tools/SKILL.md"),
        await assetText("skill/SKILL.md"),
      );
      if (skillFile.action !== "unchanged") {
        skillFile.notes = [
          "The WebMCP skill for coding agents lives at .agents/skills/webmcp-tools/SKILL.md.",
          ...(skillFile.notes ?? []),
        ];
      }
      files.push(skillFile);
      return files;
    },
  };
}

/** A fully-generated file: create if missing, overwrite if changed, skip if same. */
async function plainFile(path: string, contents: string): Promise<GeneratedFile> {
  try {
    const existing = await readFile(path, "utf8");
    return { path, contents, action: existing === contents ? "unchanged" : "update" };
  } catch {
    return { path, contents, action: "create" };
  }
}

/**
 * The source ref a generated file belongs to, read back from its header
 * ("Source: <ref> (<kind>)."). Files from before the header carried a Source
 * line return undefined; their filename is trusted instead.
 */
function sourceRefOf(contents: string): string | undefined {
  return /^\s*\* Source: (.+) \((\w+)\)\./m.exec(contents)?.[1];
}

/**
 * Build (or merge) one per-tool file from already-read contents.
 * `existing` is the file that belongs to this tool (by ref, wherever it
 * sits); `targetOccupied` only decides between "create" and "update" in the
 * report, so a rename reads as "create the new name", not "overwrite".
 */
function toolFile(
  tool: ReviewedTool,
  path: string,
  existing: string | undefined,
  targetOccupied: boolean,
  notes: string[],
  exposedTo?: string[],
): GeneratedFile {
  const head = generatedRegion(tool, { exposedTo });

  if (existing === undefined) {
    return {
      path,
      contents: `${head}\n${ownedRegionScaffold(tool)}`,
      action: targetOccupied ? "update" : "create",
      notes,
    };
  }

  const markerIndex = existing.indexOf(GENERATED_END);
  if (markerIndex === -1) {
    // Someone removed the markers or hand-wrote this path from scratch.
    // Never clobber their work: report a conflict and let the pipeline put
    // our version in a `.new` sibling for a human to merge.
    return { path, contents: existing, action: "unchanged", conflict: `${path}.new`, notes };
  }

  // Keep everything the developer wrote below the marker, word for word.
  const preservedTail = existing.slice(markerIndex + GENERATED_END.length);
  const contents = head + preservedTail;
  return {
    path,
    contents,
    action: contents === existing && !targetOccupied ? "unchanged" : "update",
    notes,
  };
}
