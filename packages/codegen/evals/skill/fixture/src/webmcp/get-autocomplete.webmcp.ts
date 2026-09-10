import { getModelContext, callApi, toolResult, asToolError } from "./runtime.webmcp";

// ─── webmcp-codegen: generated. Do not edit this region. ───
/**
 * Search places by free text. Returns an array of autocomplete.
 *
 * Source: GET /v1/places/autocomplete (openapi). Risk: safe-read.
 * Starts enabled (see executeGetAutocomplete below).
 * Regenerate with: npx @webmcp-stack/codegen generate
 */

/** The exact contract advertised to the agent. Derived from the API spec. Do not hand-edit. */
export const getAutocompleteInputSchema = {
  "type": "object",
  "properties": {
    "input": {
      "type": "string",
      "description": "The place search text, e.g. Lisbon."
    }
  },
  "required": [
    "input"
  ]
};

/** What `execute` receives. The browser validates agent input against the schema above. */
export type GetAutocompleteInput = { "input": string };

/** Safety hints computed by webmcp-codegen. Informational metadata for hosts and UIs. */
export const getAutocompleteHints = {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"untrustedContentHint":true} as const;

/** The tool definition, minus `execute` (which is yours, below the marker). */
export const getAutocompleteTool = {
  name: "get-autocomplete",
  title: "Get Autocomplete",
  description: "Search places by free text. Returns an array of autocomplete.",
  inputSchema: getAutocompleteInputSchema,
  annotations: {
    readOnlyHint: true,
    untrustedContentHint: true,
    consequentialHint: false,
  },
};

/** The bare request, without the agent-facing result wrapping. Journeys
 * and your own code compose this; executeGetAutocomplete is the agent-facing one. */
export async function fetchGetAutocomplete(input: GetAutocompleteInput, signal?: AbortSignal) {
  const data = await callApi("/v1/places/autocomplete", { method: "GET", query: { input: input.input }, signal });
  return data;
}

/**
 * Register this tool with WebMCP. Call it once on page load, or use
 * registerAllTools() from the generated index.ts. Skips quietly when the
 * browser has no WebMCP runtime.
 *
 * Pass an AbortSignal to unregister later: controller.abort().
 */
export async function registerGetAutocomplete(signal?: AbortSignal): Promise<void> {
  const modelContext = getModelContext();
  if (!modelContext) return;
  await modelContext.registerTool(
    {
      ...getAutocompleteTool,
      // The browser has already validated the agent's input against the schema.
      // A failure returns a readable result; it never throws (see asToolError).
      execute: async (input, context) => {
        try {
          return await executeGetAutocomplete(input as GetAutocompleteInput, context?.signal);
        } catch (error) {
          return asToolError(error);
        }
      },
    },
    { signal },
  );
}

// ─── webmcp-codegen: end generated. Your code below survives regeneration. ───

/**
 * What actually happens when the agent calls "get-autocomplete".
 *
 * Default implementation: calls GET /v1/places/autocomplete from this page, with the
 * signed-in user's session. Replace it with your app's own API client
 * whenever you like; the contract above never changes.
 *
 * Calls the API on this page's own origin (same-origin by default).
 */
export async function executeGetAutocomplete(input: GetAutocompleteInput, signal?: AbortSignal) {
  const data = await fetchGetAutocomplete(input, signal);
  // Make the effect visible: an agent acts while a human watches this
  // page. If this call changes what is on screen, update the UI here
  // (navigate, invalidate a query, dispatch an event).
  return toolResult(data);
}