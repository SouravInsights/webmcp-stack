#!/usr/bin/env node
/**
 * webmcp-codegen's command line.
 *
 * Design goals, in order:
 *   1. The default output is the summary you need, not a log dump.
 *   2. Every line earns its place; if it doesn't help you decide, it's gone.
 *   3. The next step is always visible, never assumed.
 *   4. Beautiful enough that developers screenshot it.
 *
 * Commands:
 *   webmcp-codegen            the interactive dashboard (same as `dev`)
 *   webmcp-codegen generate   write tool files from your spec
 *   webmcp-codegen init       write a codegen.config.mjs for full control
 *   webmcp-codegen --help     detailed help with examples
 *
 * Zero dependencies: argument parsing is Node's util.parseArgs, output is
 * ANSI escapes we control character by character.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as clack from "@clack/prompts";
import { dim, printBanner, renderSummary } from "./cli-output.js";
import { CONFIG_FILE_NAMES } from "./config.js";
import { loadDataFile, saveDataFile } from "./data-file.js";
import { findSpecs } from "./detect.js";
import { findSchemaLibraries, findWebApps } from "./detect-app.js";

// Node prints an ExperimentalWarning the first time it type-strips a .ts
// module (loading a user's codegen.config.ts or schema modules). That warning is Node
// talking about its own internals, not something the developer can act on,
// so it never belongs in our output.
const realEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string })?.type;
  const text = typeof warning === "string" ? warning : ((warning as Error)?.message ?? "");
  if (type === "ExperimentalWarning" && /type stripping/i.test(text)) return;
  return (realEmitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

import { startDevServer } from "./dev/server.js";
import { debug, enableVerbose, error, info, success, warn } from "./logger.js";
import { runGenerate } from "./pipeline.js";
import { resolveSetup } from "./setup.js";
import {
  countJourneyTools,
  type JourneyFileInput,
  verifyJourneyFiles,
  verifyTools,
  verifyUrl,
} from "./verify.js";
import { applyWiring, planWiring, type WirePlan } from "./wire.js";

const HELP = `
webmcp-codegen — generate WebMCP tools from your OpenAPI spec

Usage
  npx @webmcp-stack/codegen [command] [flags]

Commands
  generate    Generate tool files from your spec (default when no command given)
  verify      Measure your tools against the standard, before you ship
  dev         Open the tools dashboard (list, describe, toggle, test)
  init        Write a codegen.config.mjs for full control

Flags
  --spec PATH    Which OpenAPI spec to use (auto-detected when omitted)
  --out DIR      Where tool files go (default: your web app's src/webmcp)
  --dry-run      Preview what would be written, write nothing
  --verbose      Show every tool, not just the summary
  --force        Write files even when the audit reports errors
  --skip-audit   Skip the safety report
  --url URL      With verify: also check the deployed page is live for visitors
  --config PATH  Use a config file at PATH
  --port N       Dashboard port (default: 4700)
  --help         Show this help

Examples
  npx @webmcp-stack/codegen generate              # detect spec, generate tools
  npx @webmcp-stack/codegen generate --dry-run    # preview without writing
  npx @webmcp-stack/codegen dev                   # open the dashboard
  npx @webmcp-stack/codegen generate --verbose    # see all 72 tools listed

Docs
  https://webmcp-stack.vercel.app/docs
`;

export interface CliFlags {
  dryRun: boolean;
  skipAudit: boolean;
  force: boolean;
  verbose: boolean;
  watch: boolean;
  config?: string;
  spec?: string;
  out?: string;
  port?: number;
  /** `verify --url <deployed-url>`: also check the page is live for visitors. */
  url?: string;
  help: boolean;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      "skip-audit": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      watch: { type: "boolean", default: false },
      config: { type: "string" },
      spec: { type: "string" },
      out: { type: "string" },
      port: { type: "string" },
      url: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  const flags: CliFlags = {
    dryRun: values["dry-run"] ?? false,
    skipAudit: values["skip-audit"] ?? false,
    force: values.force ?? false,
    verbose: values.verbose ?? false,
    watch: values.watch ?? false,
    config: values.config,
    spec: values.spec,
    out: values.out,
    port: values.port ? Number.parseInt(values.port, 10) : undefined,
    url: values.url,
    help: values.help,
  };

  if (flags.verbose) enableVerbose();

  if (flags.help) {
    info(HELP);
    return 0;
  }

  const command = positionals[0] ?? "generate";

  switch (command) {
    case "init":
      return init();
    case "dev":
      return dev(flags.port ?? 4700);
    case "verify":
      return verify(flags);
    case "generate":
      return generate(flags);
    default:
      error(`Unknown command: ${command}`);
      info(HELP);
      return 1;
  }
}

async function init(): Promise<number> {
  printBanner();
  const cwd = process.cwd();
  const configFile = CONFIG_FILE_NAMES[0] ?? "codegen.config.mjs";
  const configPath = join(cwd, configFile);

  if (existsSync(configPath)) {
    error(`${configFile} already exists. Nothing to do.`);
    return 1;
  }

  const specs = await findSpecs(cwd);
  const schemaLibs = await findSchemaLibraries(cwd);
  const apps = await findWebApps(cwd);

  // Tools are browser code, so they live in the web app's package, not
  // wherever the command ran. In a monorepo that is apps/web, not root.
  // One app: use it. Several: the ranked first candidate wins and we say so.
  const app = apps[0];
  const outDir = app ? `./${app.dir}/src/webmcp` : "./src/webmcp";

  // Multiple specs: let the person pick, don't guess. The choice is saved
  // in the config, so this only asks once.
  let spec: string | undefined;
  if (specs.length > 1) {
    const picked = await clack.select({
      message: "Found multiple OpenAPI specs. Which one should the codegen use?",
      options: specs.map((s) => ({ value: `./${s}`, label: s })),
    });
    if (clack.isCancel(picked)) {
      info(dim("\n  Cancelled. Run init again when you're ready.\n"));
      return 0;
    }
    spec = picked as string;
  } else if (specs.length === 1) {
    spec = `./${specs[0]}`;
  }

  await writeFile(configPath, initTemplate(spec, schemaLibs, outDir, app?.dir));

  success(`Wrote ${configFile}`);
  if (app) {
    info(`Tools will be generated into ${app.dir} (${app.framework}).`);
  }
  if (!spec) {
    // The schema path is the answer to "no OpenAPI spec": yesterday this run
    // had nothing to say, today it scaffolds the contract the app does have.
    info("No OpenAPI spec found, so this config starts from your validation schemas instead.");
    info('Add a spec later with: sources: [openapi({ spec: "./openapi.yaml" }), ...]');
  }
  if (schemaLibs.length > 0) {
    info(`Detected ${schemaLibs.join(", ")}. Declare agent-facing actions from your`);
    info("schemas; see the commented block in the config.");
  }
  info("\nEdit it to add sources, change the output directory, or set safety options.");
  info("Docs: https://webmcp-stack.vercel.app/docs/configuration\n");
  return 0;
}

/**
 * The init config. With a spec: OpenAPI-first, as always. Without one: the
 * schema path, so a specless app is no longer a dead end. Either way the
 * schema source appears as a commented block when the project already has a
 * validation library: a suggestion for a library nobody installed is noise.
 */
function initTemplate(
  spec: string | undefined,
  schemaLibs: string[],
  outDir = "./src/webmcp",
  appDir?: string,
): string {
  const safetyBlock = `  safety: {
    // Extra field names to treat as PII, on top of the built-in list:
    // piiFields: ["internalId"],
    // Tools to skip entirely (matched against name and route):
    // exclude: ["internal"],
  },`;

  // Point the example import at the detected app, so a monorepo user is not
  // handed a root-relative path that does not exist.
  const schemaImportPath = appDir ? `./${appDir}/src/schemas` : "./src/schemas";

  if (!spec) {
    return `import { defineConfig } from "@webmcp-stack/codegen";
import { schema } from "@webmcp-stack/codegen/sources";
import { tools } from "@webmcp-stack/codegen/outputs";

// Import the schemas your app validates with, e.g.:
// import { CreateTripInput } from "${schemaImportPath}";

export default defineConfig({
  sources: [
    schema({
      tools: [
        // One entry per agent-facing action:
        // { name: "create-trip", schema: CreateTripInput },
      ],
    }),
  ],
  outputs: [tools({ outDir: "${outDir}" })],
${safetyBlock}
});
`;
  }

  const schemaHint =
    schemaLibs.length > 0
      ? `
// This project uses ${schemaLibs.join(", ")}. You can also declare agent-facing actions
// straight from your validation schemas:
//
//   import { schema } from "@webmcp-stack/codegen/sources";
//   import { CreateTripInput } from "${schemaImportPath}";
//
//   sources: [
//     openapi({ spec: "${spec}" }),
//     schema({ tools: [{ name: "create-trip", schema: CreateTripInput, operation: "createTrip" }] }),
//   ],
`
      : "";

  return `import { defineConfig } from "@webmcp-stack/codegen";
import { openapi } from "@webmcp-stack/codegen/sources";
import { tools } from "@webmcp-stack/codegen/outputs";

export default defineConfig({
  sources: [openapi({ spec: "${spec}" })],
  outputs: [tools({ outDir: "${outDir}" })],
${safetyBlock}
});
${schemaHint}`;
}

async function dev(port: number): Promise<number> {
  printBanner();
  const cwd = process.cwd();
  const server = await startDevServer({ cwd, port, open: true });
  success(`Dashboard: http://localhost:${port}`);
  info("List, describe, enable, and test your tools. Ctrl+C to stop.\n");

  await new Promise<void>((resolveExit) => {
    process.on("SIGINT", () => {
      server.close();
      resolveExit();
    });
  });
  return 0;
}

/**
 * The tool standard, measured locally: runs the pipeline exactly as generate
 * would (nothing written), then reports how the registered surface holds up
 * — names, descriptions, field text, annotations, surface size. Exits 1 on
 * error-level findings so CI can gate on it.
 */
async function verify(flags: CliFlags): Promise<number> {
  printBanner();
  const cwd = process.cwd();
  const setup = await resolveSetup(cwd, {
    dryRun: true,
    skipAudit: true,
    force: false,
    watch: false,
    spec: flags.spec,
    out: flags.out,
    configPath: flags.config,
  });
  const data = await loadDataFile(cwd);
  const result = await runGenerate(setup.config, {
    cwd,
    dryRun: true,
    skipAudit: true,
    overrides: data.overrides,
    previousNames: data.names,
    progress: flags.verbose ? (msg) => debug(msg) : undefined,
  });

  const registered = result.tools.filter((tool) => !tool.withheld);

  // Journey files are the user's code, so verify can't get them from the
  // pipeline's tool list — it reads the journeys/ folder of each tools
  // output itself and lints what it finds there. Read them first: the surface
  // count needs to include the tools they register at runtime.
  const journeyInputs: JourneyFileInput[] = [];
  for (const output of setup.config.outputs) {
    if (output.kind !== "tools") continue;
    const journeysDir = resolve(cwd, (output as { outDir?: string }).outDir ?? "", "journeys");
    let entries: string[] = [];
    try {
      entries = (await readdir(journeysDir)).filter((entry) => entry.endsWith(".webmcp.ts"));
    } catch {
      continue;
    }
    for (const entry of entries) {
      journeyInputs.push({
        path: join("journeys", entry),
        contents: await readFile(join(journeysDir, entry), "utf8"),
      });
    }
  }

  const journeyToolCount = countJourneyTools(journeyInputs);
  const checks = verifyTools(result.tools, { journeyToolCount });
  checks.push(...verifyJourneyFiles(journeyInputs));

  info("");
  info(`  ${setup.label}: ${result.tools.length} tools, ${registered.length} registered`);
  info("");
  for (const check of checks) {
    const mark = check.level === "ok" ? "✓" : check.level === "error" ? "✖" : "!";
    info(`  ${mark} ${check.area}: ${check.summary}`);
    for (const finding of check.findings.slice(0, 8)) {
      info(`      ${finding}`);
    }
    if (check.findings.length > 8) {
      info(dim(`      …and ${check.findings.length - 8} more`));
    }
  }

  if (flags.url) {
    info("");
    info(`  Checking ${flags.url}`);
    const pageFindings = await verifyUrl(flags.url);
    for (const finding of pageFindings) {
      info(`  ! ${finding.message}`);
    }
    if (pageFindings.length === 0) {
      info("  ✓ Page checks passed");
    }
  }

  const errors = checks.filter((check) => check.level === "error").length;
  const warnings = checks.filter((check) => check.level === "warning").length;
  info("");
  info(
    errors > 0
      ? `  ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}. Fix the errors to pass.`
      : warnings > 0
        ? `  Passed with ${warnings} warning${warnings === 1 ? "" : "s"}.`
        : "  Passed. The surface meets the standard.",
  );
  info("");
  return errors > 0 ? 1 : 0;
}

async function generate(flags: CliFlags): Promise<number> {
  printBanner();
  const cwd = process.cwd();
  const setup = await resolveSetup(cwd, {
    dryRun: flags.dryRun,
    skipAudit: flags.skipAudit,
    force: flags.force,
    watch: flags.watch,
    spec: flags.spec,
    out: flags.out,
    configPath: flags.config,
  });

  // Narrate what the pipeline is doing so the run doesn't feel magical.
  // Verbose gets every step; the default gets just the source count so you
  // know what the CLI consumed.
  const progress = flags.verbose ? (msg: string) => debug(msg) : undefined;

  // The data file carries the developer's dashboard edits and the last run's
  // names. Both must reach the pipeline here — the dashboard is where edits
  // are made, but this command is where files are written, and an edit that
  // only one of them reads does not survive.
  const data = await loadDataFile(cwd);

  const result = await runGenerate(setup.config, {
    cwd,
    dryRun: flags.dryRun,
    force: flags.force,
    skipAudit: flags.skipAudit,
    overrides: data.overrides,
    previousNames: data.names,
    progress,
  });

  if (!flags.verbose && result.tools.length > 0) {
    info(`  → Read ${result.tools.length + result.skipped.length} operations`);
  }

  // Audit errors block the write. Instead of requiring --force on a re-run,
  // ask once: fix the errors, or write anyway.
  if (result.blocked && !flags.dryRun) {
    const proceed = await clack.confirm({
      message: `${result.findings.filter((f) => f.level === "error").length} audit errors found. Write files anyway?`,
      initialValue: false,
    });
    if (clack.isCancel(proceed) || !proceed) {
      info("\n  Fix the errors and run generate again, or use --force to skip this check.\n");
      return 1;
    }
    // Re-run with force to actually write.
    const forced = await runGenerate(setup.config, {
      cwd,
      dryRun: false,
      force: true,
      overrides: data.overrides,
      previousNames: data.names,
    });
    result.tools = forced.tools;
    result.files = forced.files;
    result.wrote = forced.wrote;
    result.blocked = false;
  }

  // Registration wiring: additive, idempotent, and only for real runs.
  let wiring: WirePlan | null = null;
  if (!result.blocked && setup.app) {
    const outDir = setup.config.outputs[0]?.outDir;
    if (outDir) {
      wiring = await planWiring(cwd, setup.app, outDir);
      if (wiring && wiring.edits.length > 0 && !flags.dryRun && result.wrote) {
        await applyWiring(wiring);
      }
    }
  }

  // Remember the choices detection made, so the next run never re-asks.
  if (!setup.fromConfigFile && !flags.dryRun && result.wrote) {
    await saveDataFile(cwd, setup.remember);
  }

  // Record the names this run produced (and any overrides that followed a
  // rename), so the next run can report renames instead of breaking silently.
  if (!flags.dryRun && result.wrote) {
    await saveDataFile(cwd, {
      names: result.namesLedger,
      ...(result.migratedOverrides ? { overrides: result.migratedOverrides } : {}),
    });
  }

  if (!flags.verbose) {
    renderSummary(result, setup, cwd, wiring);
  }

  if (flags.watch && !flags.dryRun) {
    warn("--watch is not implemented yet. Run generate again after changes.\n");
  }

  return result.blocked ? 1 : 0;
}

// exitCode, not exit(): the logger writes through a worker transport, and a
// hard exit can drop its buffered lines. Every async handle has been awaited
// by this point, so the process ends naturally.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    const message = err instanceof Error ? err.message : String(err);
    // Multi-line messages are composed, actionable guidance written for the
    // person running the command; print them as-is. Single-line failures are
    // genuinely unexpected, so those get the report link.
    if (message.includes("\n")) {
      error(`\n${message}\n`);
    } else {
      error(`Unexpected error: ${message}`);
      error("\nPlease report this: https://github.com/SouravInsights/webmcp-stack/issues\n");
    }
    process.exitCode = 1;
  },
);
