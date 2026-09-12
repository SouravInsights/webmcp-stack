import { getModelContext, callApi, toolResult, asToolError } from "./runtime.webmcp";

// --- webmcp-codegen: generated. Do not edit this region. ---
/**
 * Get one pet, including its owner's contact details. Returns the pet.
 *
 * Source: GET /pets/{id} (openapi). Risk: safe-read.
 * Starts enabled (see executeGetPet below).
 * Regenerate with: npx @webmcp-stack/codegen generate
 */

/** The exact contract advertised to the agent. Derived from the API spec. Do not hand-edit. */
export const getPetInputSchema = {
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "The unique identifier of the pet."
    }
  },
  "required": [
    "id"
  ]
};

/** What `execute` receives. The browser validates agent input against the schema above. */
export type GetPetInput = { "id": string };

/** Safety hints computed by webmcp-codegen. Informational metadata for hosts and UIs. */
export const getPetHints = {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"untrustedContentHint":true} as const;

/** The tool definition, minus `execute` (which is yours, below the marker). */
export const getPetTool = {
  name: "get-pet",
  title: "Get Pet",
  description: "Get one pet, including its owner's contact details. Returns the pet.",
  inputSchema: getPetInputSchema,
  annotations: {
    readOnlyHint: true,
    untrustedContentHint: true,
    consequentialHint: false,
  },
};

/** The bare request, without the agent-facing result wrapping. Journeys
 * and your own code compose this; executeGetPet is the agent-facing one. */
export async function fetchGetPet(input: GetPetInput, signal?: AbortSignal) {
  const data = await callApi(`/pets/${input.id}`, { method: "GET", signal });
  return data;
}

/**
 * Register this tool with WebMCP. Call it once on page load, or use
 * registerAllTools() from the generated index.ts. Skips quietly when the
 * browser has no WebMCP runtime.
 *
 * Pass an AbortSignal to unregister later: controller.abort().
 */
export async function registerGetPet(signal?: AbortSignal): Promise<void> {
  const modelContext = getModelContext();
  if (!modelContext) return;
  await modelContext.registerTool(
    {
      ...getPetTool,
      // The browser has already validated the agent's input against the schema.
      // A failure returns a readable result; it never throws (see asToolError).
      execute: async (input, context) => {
        try {
          return await executeGetPet(input as GetPetInput, context?.signal);
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
 * What actually happens when the agent calls "get-pet".
 *
 * Default implementation: calls GET /pets/{id} from this page, with the
 * signed-in user's session. Replace it with your app's own API client
 * whenever you like; the contract above never changes.
 */
//
// ! webmcp-codegen flagged these response fields as likely PII: owner.email.
// Everything you return reaches the agent. Leave those fields out of what you
// return unless the agent genuinely needs them, and say so in a comment if you keep them.
export async function executeGetPet(input: GetPetInput) {
  const data = await callApi(`/pets/${input.id}`, { method: "GET" });
  return toolResult(data);
}