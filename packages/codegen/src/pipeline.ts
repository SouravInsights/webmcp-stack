/**
 * The pipeline: sources → normalize → safety review → audit → write.
 *
 * This module is the only place the stages meet. It owns no opinions of its
 * own; naming, safety, and file formats all live in their own modules. It
 * just runs them in order and produces one honest report of what happened
 * (or what *would* happen, when called with `write: false`).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describeCandidateInputs, describeCandidateTool } from "./describe.js";
import { groupHandshakes } from "./group.js";
import { pascalCase } from "./json-schema.js";
import { mergeSchemaWithOperations } from "./merge.js";
import { resolveNames } from "./naming.js";
import { auditTools, reviewTools } from "./safety.js";
import type {
  AuditFinding,
  CodegenConfig,
  GeneratedFile,
  ReviewedTool,
  SkippedEndpoint,
  ToolOverrides,
} from "./types.js";

export interface GenerateOptions {
  /** Project root. Everything (config, spec paths, outDir) resolves from here. */
  cwd: string;
  /** Preview mode: compute everything, write nothing. */
  dryRun?: boolean;
  /** Skip the audit pass entirely (classification still runs; output needs it). */
  skipAudit?: boolean;
  /** Write even when the audit found errors. The report still shows them. */
  force?: boolean;
  /**
   * Hand-authored tweaks from .webmcp-codegen.json (usually written by the
   * dev dashboard). Applied after the safety review so they survive
   * regeneration.
   */
  overrides?: ToolOverrides;
  /**
   * The names the last run produced (name → route ref), from the same file.
   * When a route's name changes between runs, the rename is reported and the
   * tool's overrides move with it: a rename is a report line, never a silent
   * break.
   */
  previousNames?: Record<string, string>;
  /** Progress narration: each pipeline step reports what it's doing. */
  progress?: (message: string) => void;
}

export interface GenerateResult {
  tools: ReviewedTool[];
  /** Endpoints deliberately not generated (webhooks, config exclusions). */
  skipped: SkippedEndpoint[];
  findings: AuditFinding[];
  files: GeneratedFile[];
  /** Human-facing pipeline notes, e.g. "stripped the shared v1 prefix". */
  notes: string[];
  /** Names that changed since the last run (old → new), overrides re-keyed. */
  crossRenames: { from: string; to: string }[];
  /** The names this run produced (name → route ref), for the caller to save. */
  namesLedger: Record<string, string>;
  /** Overrides with renamed tools re-keyed, when a rename moved any. */
  migratedOverrides?: ToolOverrides;
  /** True when audit errors stopped any file from being written. */
  blocked: boolean;
  /** True when this run actually wrote files (false for dry runs and blocks). */
  wrote: boolean;
}

export async function runGenerate(
  config: CodegenConfig,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const notes: string[] = [];
  const progress = options.progress ?? (() => {});

  // 1. Collect candidate tools from every configured source.
  progress("Reading sources");
  const candidates = (await Promise.all(config.sources.map((source) => source.collect()))).flat();
  progress(`Found ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`);

  // 2. Merge: a schema entry that names an OpenAPI operation fuses with it
  //    into one candidate (the schema's contract and words, the endpoint's
  //    mechanics). A merge target that does not exist is an error, not a
  //    silent standalone fallback.
  const merge = mergeSchemaWithOperations(candidates);
  if (merge.findings.length > 0) {
    progress(
      `Merged ${candidates.length - merge.tools.length} schema ${candidates.length - merge.tools.length === 1 ? "entry" : "entries"} into endpoints`,
    );
  }

  // 3. Describe: fill field text in layer order. Author text stays verbatim
  //    (constraints appended when missing); silent fields get a marked draft.
  //    Developer overrides (layer 5) run later, in step 6, so they always win.
  progress("Assembling field descriptions");
  for (const candidate of merge.tools) {
    describeCandidateTool(candidate);
    describeCandidateInputs(candidate);
  }

  // 4. Names. Declared names (schema entries, cleaned operationIds) are
  //    fixed. Route-derived names start minimal ("generate-story") and
  //    absorb parent context on collision ("generate-trip-story"); every
  //    rename is reported, because a name is a tool's public identity.
  progress("Normalizing tool names");
  const resolved = resolveNames(
    merge.tools.map((tool) => ({
      name: tool.name,
      declared: tool.source.kind !== "openapi" || Boolean(tool.operationId),
      httpMethod: tool.httpMethod,
      pathTemplate: tool.pathTemplate,
    })),
  );
  notes.push(...resolved.notes);
  const { renames } = resolved;
  const named = merge.tools.map((candidate, index) => {
    const name = resolved.names[index] ?? candidate.name;
    return { ...candidate, name, inputTypeName: `${pascalCase(name)}Input` };
  });
  if (renames.length > 0) {
    progress(`Renamed ${renames.length} tool${renames.length === 1 ? "" : "s"} for uniqueness`);
  }

  // 4.5 Grouping: handshake endpoints (request-upload + complete-upload) are
  //     one action the API split into two calls. The merged tool is a
  //     withheld draft exactly like its members; the report names the
  //     proposal, and adopting it is enabling it. Members stay untouched.
  const grouped = groupHandshakes(named);
  notes.push(...grouped.notes);
  const groupedTools = grouped.tools;

  // Cross-run renames. The route ref is the durable identity; the name is
  // derived. When they drift apart (a better algorithm, a spec edit), the
  // tool's dashboard overrides are keyed by the old name and would silently
  // stop applying — so they are re-keyed here, before step 6 reads them.
  const refOf = (tool: (typeof named)[number]): string => tool.endpointRef ?? tool.source.ref;
  const crossRenames: { from: string; to: string }[] = [];
  if (options.previousNames) {
    const nameByRef = new Map(Object.entries(options.previousNames).map(([n, r]) => [r, n]));
    for (const tool of groupedTools) {
      const before = nameByRef.get(refOf(tool));
      if (before && before !== tool.name) crossRenames.push({ from: before, to: tool.name });
    }
  }
  let overrides = options.overrides;
  let migratedOverrides: ToolOverrides | undefined;
  if (overrides && crossRenames.length > 0) {
    overrides = { ...overrides };
    for (const { from, to } of crossRenames) {
      if (overrides[from] && !overrides[to]) {
        overrides[to] = overrides[from];
        delete overrides[from];
      }
    }
    migratedOverrides = overrides;
    progress(
      `${crossRenames.length} tool${crossRenames.length === 1 ? "" : "s"} renamed since the last run; their dashboard edits moved with them`,
    );
  }
  const namesLedger = Object.fromEntries(groupedTools.map((tool) => [tool.name, refOf(tool)]));

  // 5. Safety review: classify side effects, compute hints, scan for PII,
  //    apply endpoint roles and config exclusions. Webhooks never come back.
  progress("Reviewing safety (classification, PII, auth)");
  const { tools, skipped } = reviewTools(groupedTools, config.safety);
  const authCount = tools.filter((t) => t.endpointRole === "auth").length;
  const adminCount = tools.filter((t) => t.endpointRole === "admin").length;
  if (authCount > 0) progress(`Disabled ${authCount} auth endpoint${authCount === 1 ? "" : "s"}`);
  if (adminCount > 0)
    progress(`Disabled ${adminCount} admin endpoint${adminCount === 1 ? "" : "s"}`);

  // 6. Hand-authored overrides (dashboard edits) win over every derived
  //    layer, field text included: an override is the developer's final word,
  //    so nothing appends to it afterwards.
  const fieldOverrideTypos: { tool: string; field: string }[] = [];
  if (overrides) {
    for (const tool of tools) {
      const override = overrides[tool.name];
      if (!override) continue;
      if (typeof override.description === "string" && override.description.trim()) {
        tool.description = override.description.trim();
        // A hand-written description is no longer a template; stop warning about it.
        tool.descriptionSource = "declared";
      }
      if (typeof override.enabled === "boolean") {
        tool.enabledByDefault = override.enabled;
      }
      if (override.fields) {
        const properties = tool.inputSchema.properties ?? {};
        for (const [field, text] of Object.entries(override.fields)) {
          if (!properties[field]) {
            // An override that matches nothing is a typo, and a silent typo
            // means a field the developer meant to document stays bare.
            fieldOverrideTypos.push({ tool: tool.name, field });
            continue;
          }
          properties[field] = { ...properties[field], description: text };
        }
        // Overridden fields carry author text now; they are not synthesized.
        tool.synthesizedFields = (tool.synthesizedFields ?? []).filter(
          (field) => !(field in (override.fields ?? {})),
        );
      }
    }
  }

  // 7. Audit. Errors block the write unless --force (or --skip-audit) was passed.
  //    Declared form pointers are validated here, not in the form output:
  //    "no <form> at the declared pointer" must be a blocking audit error,
  //    and blocking semantics belong to the audit, never to file writers.
  //    Pointers are only validated when the form output is actually configured;
  //    without it the pointer is inert, and the inertness warning (step 8) is
  //    the whole story.
  const formOutput = config.outputs.find((output) => output.kind === "form");
  const formFindings =
    options.skipAudit || !formOutput ? [] : await validateFormPointers(tools, options.cwd);
  const findings = options.skipAudit
    ? []
    : [
        ...merge.findings,
        ...auditTools(tools, renames),
        ...resolved.collisions.map((name) => ({
          level: "error" as const,
          tool: name,
          message:
            `"${name}" collided with an identical route and could only be numbered. ` +
            "A numbered name is the algorithm giving up: rename one of them in the " +
            "dashboard or .webmcp-codegen.json so an agent can tell them apart.",
        })),
        ...crossRenames.map((rename) => ({
          level: "warning" as const,
          tool: rename.to,
          message:
            `Renamed "${rename.from}" → "${rename.to}" since the last run. ` +
            "Dashboard edits moved with it; update any code that imported the old name.",
        })),
        ...formFindings,
        ...fieldOverrideTypos.map((typo) => ({
          level: "warning" as const,
          tool: typo.tool,
          message:
            `Override for field "${typo.field}" matches no input field on this tool. ` +
            "Check the spelling in .webmcp-codegen.json.",
        })),
      ];
  const errors = findings.filter((finding) => finding.level === "error");
  const blocked = errors.length > 0 && !options.force && !options.skipAudit;

  if (blocked) {
    return {
      tools,
      skipped,
      findings,
      files: [],
      notes,
      crossRenames,
      namesLedger,
      migratedOverrides,
      blocked,
      wrote: false,
    };
  }

  // 8. Run the outputs, then write the files (unless this is a dry run).
  //    Tools with a form pointer belong to the form output; without one
  //    configured they generate as ordinary tool files, loudly.
  const fileOutputs = config.outputs.filter((output) => output.kind !== "form");
  const formTools = tools.filter((tool) => tool.form);

  let toolsForFiles = tools;
  if (formOutput) {
    toolsForFiles = tools.filter((tool) => !tool.form);
  } else if (formTools.length > 0) {
    findings.push({
      level: "warning",
      message:
        `${formTools.map((tool) => tool.name).join(", ")} declare a form path, but no form ` +
        "output is configured, so they generated as tool files. " +
        'Add form({...}) to outputs, or remove the "form" pointer.',
    });
  }

  const files: GeneratedFile[] = [];
  for (const output of fileOutputs) {
    files.push(...(await output.generate(toolsForFiles, options.cwd)));
  }
  if (formOutput) {
    files.push(...(await formOutput.generate(formTools, options.cwd)));
  }

  let wrote = false;
  if (!options.dryRun) {
    for (const file of files) {
      if (file.action === "unchanged" && !file.conflict) continue;
      // A conflict means a human edited the generated region by hand:
      // leave their file alone and put our version in a `.new` sibling.
      const target = file.conflict ?? file.path;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.conflict ? conflictContents(file) : file.contents);
    }
    wrote = true;
  }

  return {
    tools,
    skipped,
    findings,
    files,
    notes,
    crossRenames,
    namesLedger,
    migratedOverrides,
    blocked,
    wrote,
  };
}

/**
 * Every declared form pointer must resolve to a file containing a literal
 * <form> element. A pointer that does not is a clear error, not a guess:
 * annotating nothing would be silent, and annotating the wrong tag would be
 * worse.
 */
async function validateFormPointers(tools: ReviewedTool[], cwd: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  for (const tool of tools) {
    if (!tool.form) continue;
    const path = resolve(cwd, tool.form.path);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      findings.push({
        level: "error",
        tool: tool.name,
        message:
          `Declares form "${tool.form.path}", but no file exists there. ` +
          "Point at the component that renders the form, or remove the pointer.",
      });
      continue;
    }
    if (!/<form(?=[\s>])/.test(text)) {
      findings.push({
        level: "error",
        tool: tool.name,
        message:
          `Declares form "${tool.form.path}", but there is no <form> element in it. ` +
          "Point at the component that renders the form (or wrap the controls in one).",
      });
    }
  }
  return findings;
}

/**
 * When a hand-edited file blocks regeneration, the `.new` file explains
 * itself at the top so nobody mistakes it for something to import.
 */
function conflictContents(file: GeneratedFile): string {
  return (
    `// webmcp-codegen could not regenerate ${file.path} because its generated\n` +
    `// region was edited by hand. Review this version, then merge it manually.\n\n` +
    file.contents
  );
}
