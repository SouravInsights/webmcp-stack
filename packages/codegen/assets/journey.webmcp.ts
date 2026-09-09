/**
 * Written by webmcp-codegen on every `generate` run. Do not edit by hand;
 * your changes will be lost. This file is fully ours — journey definitions
 * (your code) live in journeys/*.webmcp.ts and import createJourney from here.
 *
 * createJourney: multi-step agent flows with a shared draft and one submit.
 *
 * The three pieces, literally:
 *
 * 1. THE DRAFT — one plain object per page load (`let draft = {}` below).
 *    Nothing fancier: steps write their results into it, the submit reads
 *    from it. It dies with the page; a half-finished journey does not
 *    survive a reload, which is what you want.
 *
 * 2. STEP TOOLS — ordinary registered WebMCP tools, one per step, named
 *    "<journey>-<step>" (e.g. "document-trip-search-places"). A step's
 *    execute stores what it produced into the draft, then replies with what
 *    is still missing, so the agent always knows the next move.
 *
 * 3. THE SUBMIT GATE — one more registered tool, "<journey>-submit". Its
 *    execute, in order: refuses with the list of missing steps, asks the
 *    human to confirm, runs the real tool's execute with the assembled
 *    input, clears the draft. There is no way to submit around it, because
 *    the real input only exists inside build(draft).
 */

import {
  asToolError,
  getModelContext,
  requestUserConfirmation,
  toolError,
  toolResult,
  type WebMcpToolResult,
} from "../runtime.webmcp";

type Json = Record<string, unknown>;

export interface JourneyStep {
  /** What the agent reads, e.g. "Search real places and store the pick." */
  description: string;
  /** The step's input fields, as a JSON Schema object. */
  input: Json;
  /**
   * Draft fields this step leaves behind. Submit refuses until every step's
   * fields are present. A step with no `run` stores its input verbatim.
   */
  provides: string[];
  /**
   * What the step does with its input — usually calling an existing tool's
   * execute. Receives the draft so far (a later step needs what an earlier
   * one stored) and must return the draft fields to store.
   * Default: store the input verbatim.
   */
  run?: (input: Json, signal: AbortSignal | undefined, draft: Readonly<Json>) => Promise<Json>;
}

export interface JourneyDef {
  /** Journey name; step tools derive from it ("document-trip-search-places"). */
  name: string;
  /** The one sentence every step repeats to the agent, so the goal survives. */
  goal: string;
  steps: Record<string, JourneyStep>;
  submit: {
    /** What the human confirms, e.g. "Create the trip and open the editor." */
    description: string;
    /** Assemble the real tool's input from the draft. This is your code. */
    build: (draft: Readonly<Json>) => unknown;
    /** The existing tool's execute — your real endpoint runs here. */
    run: (input: never, signal?: AbortSignal) => Promise<unknown>;
  };
}

export function createJourney(def: JourneyDef) {
  const modelContext = getModelContext();

  /** The shared draft. Page-scoped on purpose: reloads start clean. */
  let draft: Json = {};

  /** Every (step, field) pair the draft still lacks, as readable text. */
  function missing(): string[] {
    return Object.entries(def.steps).flatMap(([key, step]) =>
      step.provides
        .filter((field) => draft[field] === undefined)
        .map((field) => `${def.name}-${key} (stores "${field}")`),
    );
  }

  async function registerSteps(signal?: AbortSignal): Promise<void> {
    if (!modelContext) return;
    for (const [key, step] of Object.entries(def.steps)) {
      await modelContext.registerTool(
        {
          name: `${def.name}-${key}`,
          description: `${step.description} Part of "${def.name}": ${def.goal}`,
          inputSchema: step.input,
          annotations: { readOnlyHint: true },
          execute: async (input, context) => {
            try {
              const stored = step.run
                ? await step.run(input as Json, context?.signal, { ...draft })
                : (input as Json);
              Object.assign(draft, stored);
              const left = missing();
              return toolResult(
                left.length === 0
                  ? `Stored. The journey is ready — call ${def.name}-submit.`
                  : `Stored. Still needed: ${left.join(", ")}.`,
              );
            } catch (error) {
              return asToolError(error);
            }
          },
        },
        { signal },
      );
    }
  }

  async function registerSubmit(signal?: AbortSignal): Promise<void> {
    if (!modelContext) return;
    await modelContext.registerTool(
      {
        name: `${def.name}-submit`,
        description: def.submit.description,
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: false },
        execute: async (_input, context) => {
          context?.signal?.throwIfAborted();
          const left = missing();
          if (left.length > 0) {
            return toolError(`Not ready to submit. Call these first: ${left.join(", ")}.`);
          }
          const confirmed = await requestUserConfirmation(
            `Allow the agent to: ${def.submit.description}`,
          );
          if (!confirmed) return toolError("The user declined this action.");
          try {
            const result = await def.submit.run(def.submit.build(draft) as never, context?.signal);
            draft = {}; // a submitted journey starts clean
            return result as WebMcpToolResult;
          } catch (error) {
            return asToolError(error);
          }
        },
      },
      { signal },
    );
  }

  return {
    /** Call once on page load, next to registerAllTools(). */
    async register(signal?: AbortSignal): Promise<void> {
      await registerSteps(signal);
      await registerSubmit(signal);
    },
    /** What's in the draft right now — for the dashboard and for tests. */
    inspectDraft: (): Json => ({ ...draft }),
  };
}
