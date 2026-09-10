/**
 * The schema source: tools declared from the validation schemas an app
 * already maintains (or should).
 *
 * Why this source exists: the OpenAPI source answers "what does the HTTP API
 * expose", but many apps have no OpenAPI spec, and for some actions the raw
 * endpoint is the wrong tool anyway (calling it would bypass the product's
 * own behavior: cache refreshes, navigation, follow-up requests). The one
 * contract those apps do maintain is the validation schema, and unlike a spec
 * it is not a parallel description of the truth: the app checks it at
 * runtime.
 *
 * Scope boundary, kept on purpose: the developer writes the schema, in their
 * codebase, for their own reasons. We only read it and produce tools. This
 * source never scans application code to find schemas; what you list in the
 * config is what becomes a tool.
 *
 * Conversion today: zod. v4 converts through the app's own zod (resolved
 * relative to the config file, so pnpm monorepos anchor where the schema
 * actually lives); v3 needs the app's zod-to-json-schema. Other Standard
 * Schema vendors (valibot, arktype) get a clear error naming the follow-up
 * rather than a plausible-looking wrong answer.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { TOOL_NAME_PATTERN } from "../naming.js";
import type { CandidateTool, JsonSchema, Source } from "../types.js";

export interface SchemaToolEntry {
  /** The tool name an agent will see. Used verbatim (validated, deduped). */
  name: string;
  /** A Standard Schema object: today, a zod schema. Imported by your config. */
  schema: unknown;
  /**
   * The OpenAPI operationId this entry refines. Declaring it fuses the two
   * into one tool: your contract and words, the endpoint's mechanics. Omit it
   * for an action with no single endpoint (your execute() owns the behavior).
   */
  operation?: string;
  /** What the tool does, in your words. Beats the schema's own .describe(). */
  description?: string;
  /** A Standard Schema for what the tool returns, when there is one. */
  output?: unknown;
  /**
   * Annotate this component file's literal <form> instead of generating a
   * .webmcp.ts file. Consumed by the `form` output; without that output the
   * tool generates as a file and the run says so.
   */
  form?: string;
  /** Form lane: default is autosubmit for reads, human-submits for writes. */
  autosubmit?: boolean;
}

export interface SchemaSourceOptions {
  tools: SchemaToolEntry[];
}

/** The Standard Schema marker: `~standard: { version: 1, vendor, validate }`. */
interface StandardSchemaV1 {
  "~standard": { version: number; vendor: string };
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  const marker = (value as StandardSchemaV1 | null)?.["~standard"];
  return !!marker && marker.version === 1 && typeof marker.vendor === "string";
}

/**
 * TypeBox v1 schemas are JSON Schema documents, not wrapper objects: the value
 * has `type` and `properties` and no `~standard`. This is the only check that
 * does not lie about what TypeBox is — there is no vendor marker to read.
 */
function isTypeBoxSchema(value: unknown): value is JsonSchema {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === "object" && typeof record.properties === "object";
}

/** Create the schema source for the config's `sources` array. */
export function schema(options: SchemaSourceOptions): Source {
  // Anchored by bindContext once the config loads; until then, the process
  // cwd is the best guess (right for single-package apps).
  let anchorDir = process.cwd();

  return {
    kind: "schema",
    bindContext(context) {
      anchorDir = dirname(context.configPath);
    },
    async collect() {
      return options.tools.map((entry) => candidateFromEntry(entry, anchorDir));
    },
  };
}

function candidateFromEntry(entry: SchemaToolEntry, anchorDir: string): CandidateTool {
  if (!TOOL_NAME_PATTERN.test(entry.name)) {
    throw new Error(
      `Schema tool name "${entry.name}" is not a valid WebMCP tool name ` +
        `(must match ${TOOL_NAME_PATTERN}, e.g. "create-trip"). Declared names are used verbatim, ` +
        "so fix the name in codegen.config.",
    );
  }

  const inputSchema = toJsonSchema(entry.schema, entry.name, "schema", anchorDir);
  if (inputSchema.type !== "object" || !inputSchema.properties) {
    throw new Error(
      `Schema tool "${entry.name}" must be an object schema (named fields in, ` +
        "like z.object({...})). A tool's input is always an object.",
    );
  }

  const description =
    entry.description ??
    (typeof inputSchema.description === "string" && inputSchema.description.trim()
      ? inputSchema.description.trim()
      : undefined);

  return {
    id: `schema:${entry.name}`,
    name: entry.name,
    source: { kind: "schema", ref: entry.name },
    inputSchema: stripSchemaNoise(inputSchema),
    outputSchema: entry.output
      ? toJsonSchema(entry.output, entry.name, "output", anchorDir)
      : undefined,
    // Recomputed from the final name by the pipeline's naming step.
    inputTypeName: "",
    // No verb to classify from. The safety layer falls back to name
    // heuristics, and the safe default for an unknown action is write.
    sideEffect: "unknown",
    requiresAuth: false,
    description: description ?? entry.name,
    descriptionSource: description ? "declared" : "generated-template",
    ...(entry.operation ? { operationId: entry.operation } : {}),
    ...(entry.form ? { form: { path: entry.form, autosubmit: entry.autosubmit } } : {}),
  };
}

/** The object's own .describe() became the tool description; repeating it on
 *  the input schema would make the agent read the same sentence twice. The
 *  `$schema` keyword zod adds is spec-metadata noise in a tool contract. */
function stripSchemaNoise(schema: JsonSchema): JsonSchema {
  const { description: _self, $schema: _schemaKeyword, ...rest } = schema;
  return rest;
}

/**
 * Convert a Standard Schema to JSON Schema using the app's own library,
 * resolved from the config file's directory. Resolving through the app (not
 * this CLI's node_modules) is what makes pnpm monorepos work: the library is
 * the app's dependency, installed next to the config that imports the schema.
 */
function toJsonSchema(
  value: unknown,
  toolName: string,
  which: "schema" | "output",
  anchorDir: string,
): JsonSchema {
  // TypeBox schemas are JSON Schema already: `Type.Object({...})` returns the
  // draft-2020-12 shape with no wrapper. Detected by shape, not a marker —
  // TypeBox v1 has no `~standard` and no `_def`; the object is the contract.
  if (isTypeBoxSchema(value)) {
    return value;
  }

  if (!isStandardSchema(value)) {
    throw new Error(
      `Schema tool "${toolName}": the ${which} is not a Standard Schema ` +
        '(no "~standard" marker) and not a TypeBox schema (no "type"/"properties"). ' +
        "Pass the schema object itself (e.g. the zod or TypeBox schema), not JSON Schema or a type.",
    );
  }

  const vendor = value["~standard"].vendor;
  if (vendor !== "zod") {
    throw new Error(
      `Schema tool "${toolName}": Standard Schema vendor "${vendor}" is not converted yet ` +
        "(zod and TypeBox only today). Ask for it: https://github.com/SouravInsights/webmcp-stack/issues",
    );
  }

  // zod v4 schemas carry `_zod`; v3 (3.24+) has `~standard` and `_def` but no
  // `_zod`. The vendor string is "zod" in both majors, so the shape check is
  // the version check.
  const isZodV4 = "_zod" in (value as unknown as Record<string, unknown>);

  if (isZodV4) {
    const zod = requireFromApp<{ toJSONSchema?: (s: unknown) => JsonSchema }>(
      "zod",
      anchorDir,
      toolName,
    );
    if (typeof zod.toJSONSchema !== "function") {
      throw new Error(
        `Schema tool "${toolName}": the schema looks like zod v4, but the "zod" resolved near ` +
          `your config is v3 (no toJSONSchema). Monorepos can mix majors; anchor the config in ` +
          "the package that owns the schema, or upgrade that zod to v4.",
      );
    }
    return zod.toJSONSchema(value);
  }

  // zod v3: convert through the app's zod-to-json-schema, when it has one.
  let converter: { zodToJsonSchema?: (s: unknown) => JsonSchema };
  try {
    converter = requireFromApp("zod-to-json-schema", anchorDir, toolName);
  } catch {
    converter = {};
  }
  if (typeof converter.zodToJsonSchema !== "function") {
    throw new Error(
      `Schema tool "${toolName}": the schema looks like zod v3. Upgrade the app to zod v4, ` +
        `or add "zod-to-json-schema" to the package that owns the schema (looked near ${anchorDir}).`,
    );
  }
  return converter.zodToJsonSchema(value);
}

/** Resolve a package from the app's own node_modules, with an actionable miss. */ function requireFromApp<
  T,
>(packageName: string, anchorDir: string, toolName: string): T {
  try {
    return createRequire(join(anchorDir, "codegen.config.mjs"))(packageName) as T;
  } catch {
    throw new Error(
      `Schema tool "${toolName}": could not resolve "${packageName}" from ${anchorDir}. ` +
        "Install it in the package that owns your schemas (the one your codegen.config.mjs sits in).",
    );
  }
}
