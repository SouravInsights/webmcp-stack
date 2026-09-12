/**
 * Registration wiring: making the app actually register its tools.
 *
 * Generated files do nothing until something calls registerAllTools() once at
 * startup. Rather than telling the developer to go do that, we do it for
 * them - under strict rules, because this is the one place we edit *their*
 * files instead of ours:
 *
 *   1. Edits are additive only. We insert lines; we never change or remove
 *      existing ones.
 *   2. Idempotent. If the wiring is already there, we do nothing.
 *   3. Honest. Every edit is reported with exact paths and how to undo it.
 *   4. When we cannot find the entry point with confidence, we do not guess:
 *      we print the two lines and where they go, and leave it to the human.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { WebApp } from "./detect-app.js";

export interface WireEdit {
  /** Absolute path of the file to create or modify. */
  path: string;
  action: "create" | "modify";
  /** The full new contents (for modify: the existing contents plus our lines). */
  contents: string;
  /** One human sentence per edit, for the report. */
  summary: string;
}

export interface WirePlan {
  edits: WireEdit[];
  /** Set when we already found the wiring in place. */
  alreadyWired?: boolean;
}

/**
 * Compute the wiring edits for the detected app, or null when we cannot
 * locate the entry point with confidence (the CLI then prints manual
 * instructions instead).
 */
export async function planWiring(
  cwd: string,
  app: WebApp,
  outDir: string,
): Promise<WirePlan | null> {
  switch (app.framework) {
    case "next":
      return planNextWiring(cwd, app, outDir);
    case "vite-react":
      return planViteWiring(cwd, app, outDir);
    default:
      // Nuxt/SvelteKit/unknown: we know where the tools go but not where the
      // app boots. Print instructions rather than guess-edit an entry file.
      return null;
  }
}

/** Apply a plan. Kept trivial on purpose: the plan already did the thinking. */
export async function applyWiring(plan: WirePlan): Promise<void> {
  for (const edit of plan.edits) {
    // The outDir may not exist yet when wiring runs on its own (tests, a
    // layout wired before the first generate). writeFile does not create
    // parents, so we do.
    await mkdir(dirname(edit.path), { recursive: true });
    await writeFile(edit.path, edit.contents, "utf8");
  }
}

/* -- Next.js (app router) ------------------------------------------------ */

/**
 * Next needs the registration to run on the client, so we generate a tiny
 * "use client" component next to the tools and mount it in the root layout:
 *
 *   import { WebMCPRegister } from "../webmcp/register";   <- added
 *   ...
 *   <body>
 *     <WebMCPRegister />                                    <- added
 *     {children}
 */
async function planNextWiring(cwd: string, app: WebApp, outDir: string): Promise<WirePlan | null> {
  const layoutCandidates = [
    join(cwd, app.dir, "src/app/layout.tsx"),
    join(cwd, app.dir, "src/app/layout.jsx"),
    join(cwd, app.dir, "app/layout.tsx"),
    join(cwd, app.dir, "app/layout.jsx"),
  ];
  const layoutPath = await firstExisting(layoutCandidates);
  if (!layoutPath) return null;

  const registerPath = join(cwd, outDir, "register.tsx");
  const layout = await readFile(layoutPath, "utf8");
  if (layout.includes("WebMCPRegister")) {
    // The layout mounts the component - but "wired" also means the file it
    // points at exists. A deleted register.tsx (or a fresh clone where it
    // was never committed) must not leave the app broken.
    try {
      await readFile(registerPath, "utf8");
      return { edits: [], alreadyWired: true };
    } catch {
      return {
        edits: [
          {
            path: registerPath,
            action: "create",
            contents: nextRegisterComponent(),
            summary: `recreated ${relative(cwd, registerPath)} (the layout already mounts it, but the file was missing)`,
          },
        ],
        alreadyWired: false,
      };
    }
  }

  // Import path from the layout's directory to the register component.
  const importPath = withoutExtension(relative(dirname(layoutPath), registerPath));

  const edits: WireEdit[] = [
    {
      path: registerPath,
      action: "create",
      contents: nextRegisterComponent(),
      summary: `created ${relative(cwd, registerPath)} (a client component that registers your tools on page load)`,
    },
  ];

  const withImport = insertAfterLastImport(
    layout,
    `import { WebMCPRegister } from "${importPath}";`,
  );
  if (!withImport) return null;
  // Mount right after <body ...>, each element on its own line.
  const withComponent = withImport.replace(
    /<body([^>]*)>\s*/,
    "<body$1>\n        <WebMCPRegister />\n        ",
  );
  if (withComponent === withImport) return null; // No <body> tag found; do not guess.

  edits.push({
    path: layoutPath,
    action: "modify",
    contents: withComponent,
    summary: `added 2 lines to ${relative(cwd, layoutPath)} (an import and <WebMCPRegister /> inside <body>)`,
  });
  return { edits };
}

function nextRegisterComponent(): string {
  return `"use client";

import { useEffect } from "react";
import { registerAllTools } from "./index";

/**
 * Registers the generated WebMCP tools once, on page load.
 * Generated by webmcp-codegen. Safe to move; keep it mounted near the root.
 */
export function WebMCPRegister() {
  useEffect(() => {
    void registerAllTools();
  }, []);
  return null;
}
`;
}

/* -- Vite + React (SPAs) ------------------------------------------------- */

/**
 * A Vite app boots in main.tsx, so wiring is two added lines there:
 *
 *   import { registerAllTools } from "./webmcp";   <- added
 *   void registerAllTools();                        <- added
 */
async function planViteWiring(cwd: string, app: WebApp, outDir: string): Promise<WirePlan | null> {
  const entryCandidates = [
    join(cwd, app.dir, "src/main.tsx"),
    join(cwd, app.dir, "src/main.jsx"),
    join(cwd, app.dir, "src/index.tsx"),
    join(cwd, app.dir, "src/index.jsx"),
  ];
  const entryPath = await firstExisting(entryCandidates);
  if (!entryPath) return null;

  const entry = await readFile(entryPath, "utf8");
  if (entry.includes("registerAllTools")) return { edits: [], alreadyWired: true };

  const importPath = withoutExtension(relative(dirname(entryPath), join(cwd, outDir, "index")));
  const withWiring = insertAfterLastImport(
    entry,
    `import { registerAllTools } from "${importPath}";\n\nvoid registerAllTools();`,
  );
  if (!withWiring) return null;

  return {
    edits: [
      {
        path: entryPath,
        action: "modify",
        contents: withWiring,
        summary: `added 2 lines to ${relative(cwd, entryPath)} (an import and a registerAllTools() call)`,
      },
    ],
  };
}

/* -- Shared helpers ------------------------------------------------------ */

/** Insert a line after the file's last top-level import statement. */
function insertAfterLastImport(source: string, line: string): string | null {
  const lines = source.split("\n");
  let lastImport = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^import\s/.test(lines[index] as string)) lastImport = index;
  }
  if (lastImport === -1) return null;
  lines.splice(lastImport + 1, 0, line);
  return lines.join("\n");
}

/**
 * Turn a filesystem path into a JS import specifier: no extension, and an
 * explicit "./" when the target is in the same directory or deeper -
 * `relative()` alone yields "webmcp/index", which JS would read as a
 * package name, not a file.
 */
function withoutExtension(path: string): string {
  const bare = path.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
  return bare.startsWith(".") ? bare : `./${bare}`;
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await readFile(path, "utf8");
      return path;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}
