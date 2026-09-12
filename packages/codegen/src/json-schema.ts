/**
 * JSON Schema helpers: resolving `$ref` pointers and turning a schema into
 * TypeScript source text for the generated input types.
 *
 * Scope, deliberately small:
 * - Only *local* refs (`#/components/schemas/...`) are resolved. External
 *   refs (other files or URLs) produce a clear error instead of a silent
 *   wrong answer. This covers the overwhelming majority of hand-written and
 *   framework-emitted OpenAPI specs.
 * - The TypeScript printer covers the shapes REST APIs actually use:
 *   objects with required/optional fields, arrays, enums, primitives, and
 *   `anyOf`/`oneOf` unions. Anything more exotic becomes `unknown` with a
 *   TODO comment rather than a plausible-looking lie.
 */

import type { JsonSchema } from "./types.js";

/**
 * Resolve a local `$ref` like "#/components/schemas/Order" against the
 * parsed spec document. Throws a clear error for external refs.
 */
export function resolveLocalRef(spec: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    throw new Error(
      `Cannot resolve external $ref "${ref}". ` +
        `Only local refs (starting with "#/") are supported. Bundle the spec first if it is split across files.`,
    );
  }
  let node: unknown = spec;
  for (const segment of ref.slice(2).split("/")) {
    // JSON Pointer escapes: "~1" is "/", "~0" is "~"
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object" || !(key in node)) {
      throw new Error(`$ref "${ref}" does not point at anything in this spec (missing "${key}").`);
    }
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/**
 * If `schema` is a `$ref`, resolve it (one level; recursion happens as the
 * caller walks the tree). Sibling keywords next to `$ref` are merged over
 * the resolved schema, which is what OpenAPI 3.1 semantics require.
 */
export function deref(schema: JsonSchema, spec: unknown): JsonSchema {
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  const target = resolveLocalRef(spec, ref) as JsonSchema;
  const { $ref: _ignored, ...siblings } = schema;
  return { ...target, ...siblings };
}

/**
 * Resolve `$ref`s at every depth, so the generated `inputSchema` is a
 * self-contained JSON Schema. The browser has no idea what
 * "#/components/schemas/Order" means, so refs must not survive codegen.
 *
 * Recursive models (Order -> LineItem -> Order) would loop forever, so a ref
 * that points back to one of its own ancestors resolves to a plain object
 * with a note instead. The tool schema stays finite and honest.
 */
export function deepDeref(
  schema: JsonSchema,
  spec: unknown,
  ancestorRefs: Set<string> = new Set(),
): JsonSchema {
  const ref = schema.$ref;
  if (typeof ref === "string") {
    if (ancestorRefs.has(ref)) {
      return {
        type: "object",
        description: `Recursive reference to ${ref} (resolved once to keep the schema finite).`,
      };
    }
    const target = resolveLocalRef(spec, ref) as JsonSchema;
    return deepDeref(target, spec, new Set(ancestorRefs).add(ref));
  }

  const out: JsonSchema = { ...schema };
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([key, value]) => [
        key,
        deepDeref(value, spec, ancestorRefs),
      ]),
    );
  }
  if (out.items) out.items = deepDeref(out.items, spec, ancestorRefs);
  for (const unionKeyword of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = out[unionKeyword];
    if (variants) {
      out[unionKeyword] = variants.map((variant) => deepDeref(variant, spec, ancestorRefs));
    }
  }
  return out;
}

/**
 * Print a JSON Schema as TypeScript type source, e.g. for the generated
 * `GetOrderStatusInput` interface. `spec` is the root document, needed to
 * resolve any `$ref`s encountered along the way.
 */
export function jsonSchemaToTs(schema: JsonSchema, spec: unknown): string {
  const node = deref(schema, spec);

  if (node.enum && Array.isArray(node.enum)) {
    return node.enum.map((value) => JSON.stringify(value)).join(" | ");
  }

  if (node.anyOf || node.oneOf) {
    const variants = (node.anyOf ?? node.oneOf) as JsonSchema[];
    return variants.map((variant) => jsonSchemaToTs(variant, spec)).join(" | ");
  }

  if (node.allOf) {
    return node.allOf.map((part) => jsonSchemaToTs(part, spec)).join(" & ");
  }

  switch (node.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const items = node.items ? jsonSchemaToTs(node.items, spec) : "unknown";
      // Wrap unions so `string | number[]` doesn't silently change meaning.
      return items.includes("|") ? `Array<${items}>` : `${items}[]`;
    }
    case "object":
    case undefined: {
      // Schemas without an explicit "type" but with "properties" are objects.
      const properties = node.properties;
      if (!properties || Object.keys(properties).length === 0) {
        return "Record<string, unknown>";
      }
      const required = new Set(node.required ?? []);
      const fields = Object.entries(properties).map(([key, fieldSchema]) => {
        const optional = required.has(key) ? "" : "?";
        const nullable = fieldSchema.nullable ? " | null" : "";
        return `${JSON.stringify(key)}${optional}: ${jsonSchemaToTs(fieldSchema, spec)}${nullable}`;
      });
      return `{ ${fields.join("; ")} }`;
    }
    default:
      return "unknown /* TODO: webmcp-codegen could not express this schema; tighten it by hand */";
  }
}

/** "get-order-status" -> "GetOrderStatus" (for generated type names). */
export function pascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
