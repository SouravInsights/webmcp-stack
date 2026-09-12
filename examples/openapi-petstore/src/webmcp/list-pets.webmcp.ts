import { getModelContext, callApi, toolResult, asToolError } from "./runtime.webmcp";

// --- webmcp-codegen: generated. Do not edit this region. ---
/**
 * List all pets in the store. Returns an array of pets.
 *
 * Source: GET /pets (openapi). Risk: safe-read.
 * Starts enabled (see executeListPets below).
 * Regenerate with: npx @webmcp-stack/codegen generate
 */

/** The exact contract advertised to the agent. Derived from the API spec. Do not hand-edit. */
export const listPetsInputSchema = {
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "available",
        "adopted"
      ],
      "description": "Only show pets in this status One of: \"available\", \"adopted\"."
    }
  },
  "required": []
};

/** What `execute` receives. The browser validates agent input against the schema above. */
export type ListPetsInput = { "status"?: "available" | "adopted" };

/** Safety hints computed by webmcp-codegen. Informational metadata for hosts and UIs. */
export const listPetsHints = {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"untrustedContentHint":true} as const;

/** The tool definition, minus `execute` (which is yours, below the marker). */
export const listPetsTool = {
  name: "list-pets",
  title: "List Pets",
  description: "List all pets in the store. Returns an array of pets.",
  inputSchema: listPetsInputSchema,
  annotations: {
    readOnlyHint: true,
    untrustedContentHint: true,
    consequentialHint: false,
  },
};

/** The bare request, without the agent-facing result wrapping. Journeys
 * and your own code compose this; executeListPets is the agent-facing one. */
export async function fetchListPets(input: ListPetsInput, signal?: AbortSignal) {
  const data = await callApi("/pets", { method: "GET", query: { status: input.status }, signal });
  return data;
}

/**
 * Register this tool with WebMCP. Call it once on page load, or use
 * registerAllTools() from the generated index.ts. Skips quietly when the
 * browser has no WebMCP runtime.
 *
 * Pass an AbortSignal to unregister later: controller.abort().
 */
export async function registerListPets(signal?: AbortSignal): Promise<void> {
  const modelContext = getModelContext();
  if (!modelContext) return;
  await modelContext.registerTool(
    {
      ...listPetsTool,
      // The browser has already validated the agent's input against the schema.
      // A failure returns a readable result; it never throws (see asToolError).
      execute: async (input, context) => {
        try {
          return await executeListPets(input as ListPetsInput, context?.signal);
        } catch (error) {
          return asToolError(error);
        }
      },
    },
    { signal },
  );
}

// --- webmcp-codegen: end generated. Your code below survives regeneration. ---

/**
 * What actually happens when the agent calls "list-pets".
 *
 * Default implementation: calls GET /pets from this page, with the
 * signed-in user's session. Replace it with your app's own API client
 * whenever you like; the contract above never changes.
 */
export async function executeListPets(input: ListPetsInput) {
  const data = await callApi("/pets", { method: "GET", query: { status: input.status } });
  return toolResult(data);
}