import { callApi, toolDisabled } from "./runtime.webmcp";

// ─── webmcp-codegen: generated. Do not edit this region. ───
/**
 * Create a new trip. Returns the trip.
 *
 * Source: POST /v1/trips/ (openapi). Risk: write-confirm.
 * Starts withheld: not registered until you enable it (see registerCreateTrip below).
 * Regenerate with: npx @webmcp-stack/codegen generate
 */

/** The exact contract advertised to the agent. Derived from the API spec. Do not hand-edit. */
export const createTripInputSchema = {
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "The trip's display title."
    },
    "startDate": {
      "type": "string",
      "format": "date",
      "description": "Start date. A date (YYYY-MM-DD)."
    },
    "locationObject": {
      "type": "object",
      "description": "The resolved place from the autocomplete endpoint.",
      "properties": {
        "placeId": {
          "type": "string",
          "description": "The unique identifier of the place."
        },
        "fullAddress": {
          "type": "string",
          "description": "Full address."
        },
        "types": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Types."
        },
        "country": {
          "type": "string",
          "description": "Country."
        },
        "lat": {
          "type": "number",
          "description": "Lat."
        },
        "lng": {
          "type": "number",
          "description": "Lng."
        },
        "name": {
          "type": "string",
          "description": "Name."
        }
      },
      "required": [
        "placeId",
        "fullAddress",
        "types",
        "country",
        "lat",
        "lng",
        "name"
      ]
    }
  },
  "required": [
    "title",
    "locationObject"
  ]
};

/** What `execute` receives. The browser validates agent input against the schema above. */
export type CreateTripInput = { "title": string; "startDate"?: string; "locationObject": { "placeId": string; "fullAddress": string; "types": string[]; "country": string; "lat": number; "lng": number; "name": string } };

/** Safety hints computed by webmcp-codegen. Informational metadata for hosts and UIs. */
export const createTripHints = {"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"untrustedContentHint":true} as const;

/** The tool definition, minus `execute` (which is yours, below the marker). */
export const createTripTool = {
  name: "create-trip",
  title: "Create Trip",
  description: "Create a new trip. Returns the trip.",
  inputSchema: createTripInputSchema,
  annotations: {
    readOnlyHint: false,
    untrustedContentHint: true,
    consequentialHint: false,
  },
};

/** The bare request, without the agent-facing result wrapping. Journeys
 * and your own code compose this; executeCreateTrip is the agent-facing one. */
export async function fetchCreateTrip(input: CreateTripInput, signal?: AbortSignal) {
  const data = await callApi("/v1/trips/", { method: "POST", body: { title: input.title, startDate: input.startDate, locationObject: input.locationObject }, signal });
  return data;
}

/**
 * Withheld: this tool is not registered, so agents cannot see or pick
 * it. The registration below stays commented until you enable the tool
 * (uncomment it and the body of executeCreateTrip, or flip it in the
 * dashboard and regenerate).
 */
export async function registerCreateTrip(signal?: AbortSignal): Promise<void> {
  void signal;
  // const modelContext = getModelContext();
  // if (!modelContext) return;
  //   await modelContext.registerTool(
  //     {
  //       ...createTripTool,
  //       execute: async (input, context) => {
  //         // Cancellation wins over everything, including the confirmation.
  //         context?.signal?.throwIfAborted();
  //         // This tool changes things, so the user is always asked first. The
  //         // confirmation lives in the generated region: it cannot be edited away.
  //         const confirmed = await requestUserConfirmation(
  //           "Allow the agent to: Create a new trip. Returns the trip.",
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
  //           return await executeCreateTrip(input as CreateTripInput, context?.signal);
  //         } catch (error) {
  //           return asToolError(error);
  //         }
  //       },
  //     },
  //     { signal },
  //   );
}

// ─── webmcp-codegen: end generated. Your code below survives regeneration. ───

/**
 * What actually happens when the agent calls "create-trip".
 *
 * Default implementation: calls POST /v1/trips/ from this page, with the
 * signed-in user's session. Replace it with your app's own API client
 * whenever you like; the contract above never changes.
 *
 * Calls the API on this page's own origin (same-origin by default).
 *
 * This tool is write-confirm: it changes things.
 * The user is asked to confirm every call (built into the generated region).
 */
export async function executeCreateTrip(input: CreateTripInput, signal?: AbortSignal) {
  // This tool is withheld: nothing registers it, so agents cannot see
  // or call it. To enable it, uncomment the request below and the
  // registration above, and add toolResult to the import.
  void signal; // passed to fetch once you enable the call below
  return toolDisabled("create-trip.webmcp.ts");

  // const data = await fetchCreateTrip(input, signal);
  // return toolResult(data);
}