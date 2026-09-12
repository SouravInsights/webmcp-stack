/**
 * The OpenAPI source.
 *
 * Reads an OpenAPI 3.x document (YAML or JSON) and turns every operation
 * into a CandidateTool. This is the highest-reach source: most backend
 * frameworks can already emit an OpenAPI spec, so teams get value without
 * changing any application code.
 *
 * What we read from each operation:
 *   - name        <- operationId, slugified (falls back to method + path)
 *   - description <- summary, else the first line of description, else a template
 *   - inputSchema <- path + query parameters merged with the JSON request body
 *   - outputSchema <- the first 2xx response's JSON schema, when present
 *
 * Header and cookie parameters are skipped on purpose: agents should not be
 * setting those by hand, and auth headers are the app's job, not the tool's.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { deepDeref, deref, pascalCase } from "../json-schema.js";
import { analyzeRoute, cleanOperationId } from "../naming.js";
import type { CandidateTool, JsonSchema, Source } from "../types.js";

export interface OpenApiSourceOptions {
  /** Path to the OpenAPI document, relative to the project root. */
  spec: string;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/** Create an OpenAPI source for the config's `sources` array. */
export function openapi(options: OpenApiSourceOptions): Source {
  return {
    kind: "openapi",
    async collect() {
      const specPath = resolve(process.cwd(), options.spec);
      const spec = await readSpec(specPath);
      return operationsFromSpec(spec);
    },
  };
}

async function readSpec(specPath: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(specPath, "utf8");
  } catch {
    throw new Error(
      `Could not read the OpenAPI spec at "${specPath}". Check the "spec" path in codegen.config.`,
    );
  }
  // YAML is a superset of JSON, so one parser handles both file types.
  return parseYaml(text);
}

function operationsFromSpec(spec: unknown): CandidateTool[] {
  const root = spec as Record<string, unknown>;
  const paths = (root.paths ?? {}) as Record<string, Record<string, unknown>>;
  const rootSecurity = Array.isArray(root.security) && root.security.length > 0;
  const serverUrl = pickServerUrl(root);
  const candidates: CandidateTool[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    // Parameters declared on the path item apply to every operation under it.
    const sharedParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as Record<string, unknown> | undefined;
      if (!operation) continue;

      const upperMethod = method.toUpperCase() as CandidateTool["httpMethod"];
      const ref = `${upperMethod} ${path}`;
      const hasOperationId =
        typeof operation.operationId === "string" && operation.operationId.length > 0;
      // operationIds carry author intent (cleaned of framework scaffolding);
      // without one, the route itself yields an intent-shaped base name that
      // the pipeline's naming pass deepens if it collides.
      const name = hasOperationId
        ? cleanOperationId(operation.operationId as string)
        : analyzeRoute(method, path).base;

      const opSecurity = operation.security;
      const requiresAuth = Array.isArray(opSecurity) ? opSecurity.length > 0 : rootSecurity;

      candidates.push({
        id: ref,
        name,
        source: { kind: "openapi", ref },
        inputSchema: buildInputSchema(operation, sharedParams, spec),
        outputSchema: findOutputSchema(operation, spec),
        inputTypeName: `${pascalCase(name)}Input`,
        httpMethod: upperMethod,
        pathTemplate: path,
        paramLocations: locateParams(operation, sharedParams, spec),
        serverUrl,
        // The merge pairs schema entries with operations through this; it is
        // the only cross-source join key, because names and paths would be
        // guessing.
        ...(hasOperationId ? { operationId: operation.operationId as string } : {}),
        // The safety layer refines this; the source only reports the verb.
        sideEffect: "unknown",
        requiresAuth,
        description: pickDescription(operation, upperMethod ?? method.toUpperCase(), path),
        descriptionSource:
          typeof operation.summary === "string" || typeof operation.description === "string"
            ? "openapi-summary"
            : "generated-template",
      });
    }
  }

  if (candidates.length === 0) {
    throw new Error('The OpenAPI spec has no operations under "paths". Nothing to generate.');
  }
  return candidates;
}

/**
 * The spec's preferred base URL: the first non-local entry in `servers`
 * (specs commonly list localhost first, production after). Generated code
 * calls this absolute URL so a deployed app reaches its real API host.
 */
function pickServerUrl(root: Record<string, unknown>): string | undefined {
  const servers = root.servers;
  if (!Array.isArray(servers) || servers.length === 0) return undefined;
  // Real specs list several servers, local dev first (localhost) and the
  // public API after. Picking the first blindly bakes localhost into every
  // deployed tool's fetch. Pick the first absolute, non-local URL instead;
  // fall back to the first absolute one if all are local (a genuinely
  // local-only API).
  let firstAbsolute: string | undefined;
  for (const entry of servers) {
    const url = (entry as Record<string, unknown> | undefined)?.url;
    if (typeof url !== "string" || url.length === 0) continue;
    if (!firstAbsolute) firstAbsolute = url;
    try {
      const { hostname } = new URL(url);
      if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
        return url;
      }
    } catch {
      // Not an absolute URL; skip.
    }
  }
  return firstAbsolute;
}

/**
 * Record which input fields belong to the path, the query string, or the
 * JSON body. The generated execute() needs this split to build a real request
 * from the same flat input object the agent fills in.
 */
function locateParams(
  operation: Record<string, unknown>,
  sharedParams: unknown[],
  spec: unknown,
): CandidateTool["paramLocations"] {
  const locations = { path: [] as string[], query: [] as string[], body: [] as string[] };

  const parameters = [
    ...sharedParams,
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ];
  for (const rawParam of parameters) {
    const param = deref(rawParam as JsonSchema, spec) as Record<string, unknown>;
    if (typeof param.name !== "string") continue;
    if (param.in === "path") locations.path.push(param.name);
    if (param.in === "query") locations.query.push(param.name);
  }

  const body = extractJsonBody(operation.requestBody, spec);
  if (body) {
    if (body.schema.type === "object" || body.schema.properties) {
      locations.body.push(...Object.keys(body.schema.properties ?? {}));
    } else {
      locations.body.push("body");
    }
  }
  return locations;
}

/**
 * Merge path + query parameters and the JSON request body into one object
 * schema. That single object is what the agent fills in when calling the tool.
 */
function buildInputSchema(
  operation: Record<string, unknown>,
  sharedParams: unknown[],
  spec: unknown,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required = new Set<string>();

  const parameters = [
    ...sharedParams,
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ];

  for (const rawParam of parameters) {
    const param = deref(rawParam as JsonSchema, spec) as Record<string, unknown>;
    // Headers and cookies are transport concerns, not tool inputs.
    if (param.in !== "path" && param.in !== "query") continue;
    if (typeof param.name !== "string") continue;

    const fieldSchema = param.schema
      ? deepDeref(param.schema as JsonSchema, spec)
      : { type: "string" };
    properties[param.name] =
      typeof param.description === "string"
        ? { ...fieldSchema, description: param.description }
        : fieldSchema;
    // Path params are always required by definition; query params say so.
    if (param.in === "path" || param.required === true) required.add(param.name);
  }

  const body = extractJsonBody(operation.requestBody, spec);
  if (body) {
    if (body.schema.type === "object" || body.schema.properties) {
      // The common case: an object body flattens into the tool input.
      for (const [key, value] of Object.entries(body.schema.properties ?? {})) {
        properties[key] = value;
      }
      if (body.required) {
        for (const key of body.schema.required ?? []) required.add(key);
      }
    } else {
      // A non-object body (array, raw string, ...) goes under a "body" field.
      properties.body = body.schema;
      if (body.required) required.add("body");
    }
  }

  return { type: "object", properties, required: [...required] };
}

/** Find the operation's JSON request body schema, if it declares one. */
function extractJsonBody(
  requestBody: unknown,
  spec: unknown,
): { schema: JsonSchema; required: boolean } | undefined {
  if (!requestBody || typeof requestBody !== "object") return undefined;
  const body = deref(requestBody as JsonSchema, spec) as Record<string, unknown>;
  const content = body.content as Record<string, { schema?: JsonSchema }> | undefined;
  // Prefer application/json; accept any "+json" media type as a fallback.
  const jsonEntry =
    content?.["application/json"] ??
    Object.entries(content ?? {}).find(([mediaType]) => mediaType.endsWith("+json"))?.[1];
  if (!jsonEntry?.schema) return undefined;
  return {
    schema: deepDeref(jsonEntry.schema, spec),
    required: body.required === true,
  };
}

/** The response contract, used by the safety layer's PII scan (and later, docs). */
function findOutputSchema(
  operation: Record<string, unknown>,
  spec: unknown,
): JsonSchema | undefined {
  const responses = operation.responses as Record<string, unknown> | undefined;
  if (!responses) return undefined;
  // The first 2xx response with a JSON schema wins.
  for (const [status, rawResponse] of Object.entries(responses)) {
    if (!status.startsWith("2")) continue;
    const response = deref(rawResponse as JsonSchema, spec) as Record<string, unknown>;
    const content = response.content as Record<string, { schema?: JsonSchema }> | undefined;
    const jsonEntry =
      content?.["application/json"] ??
      Object.entries(content ?? {}).find(([mediaType]) => mediaType.endsWith("+json"))?.[1];
    if (jsonEntry?.schema) return deepDeref(jsonEntry.schema, spec);
  }
  return undefined;
}

/**
 * The description is part of the agent's prompt, so we take the spec's own
 * words when they exist and only fall back to a plain template. Both paths
 * are marked so the audit report shows which descriptions need human love.
 */
function pickDescription(operation: Record<string, unknown>, method: string, path: string): string {
  if (typeof operation.summary === "string" && operation.summary.trim().length > 0) {
    return operation.summary.trim();
  }
  if (typeof operation.description === "string" && operation.description.trim().length > 0) {
    // Use the first line only; long prose belongs in docs, not in a prompt.
    return operation.description.trim().split("\n")[0] as string;
  }
  return `${method} ${path}`;
}
