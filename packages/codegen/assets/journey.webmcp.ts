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

/**
 * A step backed by an existing generated tool. The step inherits the tool's
 * description and input schema — the definition lives in one place — and
 * calls the raw caller the generated file exports (fetchGetAutocomplete,
 * not the agent-facing execute wrapper). You write only what's new: which
 * slice of the result lands in the draft.
 */
export interface ToolStep {
  /** The generated tool object, e.g. getAutocompleteTool. */
  tool: { description?: string; inputSchema?: Json };
  /**
   * The raw caller the generated file exports. Receives the step's input
   * plus the draft so far, so a later step can feed on an earlier one's
   * stored fields.
   */
  call: (input: Json, signal: AbortSignal | undefined, draft: Readonly<Json>) => Promise<unknown>;
  /** Map the call's result into the draft fields this step leaves behind. */
  store: (result: unknown) => Json;
  /** Draft fields this step leaves behind. Submit waits for all of them. */
  provides: string[];
  /** Override the agent-facing description. Default: the tool's own. */
  description?: string;
  /** Override the agent-facing input schema. Default: the tool's own. */
  input?: Json;
}

/**
 * A step with no backend call of its own — it collects input into the draft
 * ("set the title and dates"). With a `run`, it can do work first; whatever
 * `run` returns is stored. Without one, the input is stored verbatim.
 */
export interface FreeStep {
  description: string;
  input: Json;
  provides: string[];
  run?: (input: Json, signal: AbortSignal | undefined, draft: Readonly<Json>) => Promise<Json>;
}

export type JourneyStep = ToolStep | FreeStep;

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

function isToolStep(step: JourneyStep): step is ToolStep {
  return "tool" in step;
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

  function stepDescription(step: JourneyStep): string {
    const base =
      step.description ?? (isToolStep(step) ? step.tool.description : undefined) ?? "Journey step.";
    return `${base} Part of "${def.name}": ${def.goal}`;
  }

  function stepInput(step: JourneyStep): Json {
    if (step.input) return step.input;
    if (isToolStep(step) && step.tool.inputSchema) return step.tool.inputSchema;
    return { type: "object", properties: {} };
  }

  /** Run one step and store what it produced. */
  async function runStep(step: JourneyStep, input: Json, signal?: AbortSignal): Promise<void> {
    if (isToolStep(step)) {
      const result = await step.call(input, signal, { ...draft });
      Object.assign(draft, step.store(result));
      return;
    }
    const stored = step.run ? await step.run(input, signal, { ...draft }) : input;
    Object.assign(draft, stored);
  }

  async function registerSteps(signal?: AbortSignal): Promise<void> {
    if (!modelContext) return;
    for (const [key, step] of Object.entries(def.steps)) {
      await modelContext.registerTool(
        {
          name: `${def.name}-${key}`,
          description: stepDescription(step),
          inputSchema: stepInput(step),
          annotations: { readOnlyHint: true },
          execute: async (input, context) => {
            try {
              await runStep(step, input as Json, context?.signal);
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
