import { callApi, toolDisabled } from "./runtime.webmcp";

// --- webmcp-codegen: generated. Do not edit this region. ---
/**
 * Add a new pet to the store. Returns the pet.
 *
 * Source: POST /pets (openapi). Risk: write-confirm.
 * Starts withheld: not registered until you enable it (see registerCreatePet below).
 * Regenerate with: npx @webmcp-stack/codegen generate
 */

/** The exact contract advertised to the agent. Derived from the API spec. Do not hand-edit. */
export const createPetInputSchema = {
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Name."
    },
    "tag": {
      "type": "string",
      "description": "Tag."
    }
  },
  "required": [
    "name"
  ]
};

/** What `execute` receives. The browser validates agent input against the schema above. */
export type CreatePetInput = { "name": string; "tag"?: string };

/** Safety hints computed by webmcp-codegen. Informational metadata for hosts and UIs. */
export const createPetHints = {"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"untrustedContentHint":true} as const;

/** The tool definition, minus `execute` (which is yours, below the marker). */
export const createPetTool = {
  name: "create-pet",
  title: "Create Pet",
  description: "Add a new pet to the store. Returns the pet.",
  inputSchema: createPetInputSchema,
  annotations: {
    readOnlyHint: false,
    untrustedContentHint: true,
    consequentialHint: false,
  },
};

/** The bare request, without the agent-facing result wrapping. Journeys
 * and your own code compose this; executeCreatePet is the agent-facing one. */
export async function fetchCreatePet(input: CreatePetInput, signal?: AbortSignal) {
  const data = await callApi("/pets", { method: "POST", body: { name: input.name, tag: input.tag }, signal });
  return data;
}

/**
 * Withheld: this tool is not registered, so agents cannot see or pick
 * it. The registration below stays commented until you enable the tool
 * (uncomment it and the body of executeCreatePet, or flip it in the
 * dashboard and regenerate).
 */
export async function registerCreatePet(signal?: AbortSignal): Promise<void> {
  void signal;
  // const modelContext = getModelContext();
  // if (!modelContext) return;
  //   await modelContext.registerTool(
  //     {
  //       ...createPetTool,
  //       execute: async (input, context) => {
  //         // Cancellation wins over everything, including the confirmation.
  //         context?.signal?.throwIfAborted();
  //         // This tool changes things, so the user is always asked first. The
  //         // confirmation lives in the generated region: it cannot be edited away.
  //         const confirmed = await requestUserConfirmation(
  //           "Allow the agent to: Add a new pet to the store. Returns the pet.",
  //         );
  //         if (!confirmed) {
  //           return {
  //             content: [{ type: "text", text: "The user declined this action." }],
  //             isError: true,
  //           };
  //         }
  //         // The browser has already validated the agent's input against the schema.
  //         // A failure returns a readable result; it never throws (see asToolError).
  //         try {
  //           return await executeCreatePet(input as CreatePetInput, context?.signal);
  //         } catch (error) {
  //           return asToolError(error);
  //         }
  //       },
  //     },
  //     { signal },
  //   );
}

// --- webmcp-codegen: end generated. Your code below survives regeneration. ---

/**
 * What actually happens when the agent calls "create-pet".
 *
 * Default implementation: calls POST /pets from this page, with the
 * signed-in user's session. Replace it with your app's own API client
 * whenever you like; the contract above never changes.
 *
 * This tool is write-confirm: it changes things.
 * The user is asked to confirm every call (built into the generated region).
 */
//
// ! webmcp-codegen flagged these response fields as likely PII: owner.email.
// Everything you return reaches the agent. Leave those fields out of what you
// return unless the agent genuinely needs them, and say so in a comment if you keep them.
export async function executeCreatePet(input: CreatePetInput) {
  // This tool starts disabled: it changes things. Agents can see it, and calling it tells
  // them it is disabled. To enable it, delete the line below and uncomment the code.
  return toolDisabled("create-pet.webmcp.ts");

  // const data = await callApi("/pets", { method: "POST", body: { name: input.name, tag: input.tag } });
  // return toolResult(data);
}