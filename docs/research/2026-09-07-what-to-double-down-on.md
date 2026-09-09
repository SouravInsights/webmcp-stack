# What we build, and how

**Date:** 2026-09-07

Agents are the users now. Someone runs codegen once to scaffold their tools,
then asks their own model to improve them. We stop building anything the
user's own agent already does. What's left: make the existing surface more
reliable, add the two valuable things (skill file, journeys), and remove
what's unnecessary. Parked for later: the audit package and the dashboard
rework.

## codegen — the scaffold

The front door. Three jobs:

**1. Bake in the safety defaults nobody applies by hand.** Chrome's guidance
sets hard limits and per-tool flags; across 40 endpoints everyone forgets
some. The generator applies them to every tool, every run:

- Names max 30 characters: enforced at generation and checked by `verify`
  (shipped in 0.7). Still to build: tool descriptions max 500 and parameter
  descriptions max 150 — composed to fit at generation, trimmed at a
  sentence end and marked machine-written when inherited spec text
  overflows, and measured by `verify` so CI gates on them.
- Tool outputs max 1.5K characters (to build). You can't check this before
  the tool runs, so the generated code passes every result through a helper
  that truncates it — and that helper sits in the part of the file only the
  generator edits, so nobody deletes it by accident.
- Read tools get marked read-only automatically (shipped). Outputs
  containing free-text fields get marked as untrusted user content,
  including fields nested inside arrays, objects, and nullable unions
  (shipped in 0.7). Origin scoping (`exposedTo`) ships as a config option
  once `registerTool` supports it; until then the report flags it.
- Write and destructive tools ask the user to confirm each call, in the
  generator-owned part of the file (shipped).

**2. Say plainly that the schema is not the security boundary.** A nice JSON
Schema doesn't make a call safe — the app still has to validate types,
permissions, and state when the tool runs. So `execute` always calls the
app's real endpoint, never a generated shortcut around it, and every
generated file carries one comment line saying exactly this. We never
describe the tool as a security feature. The phrase is "scaffolding with
safe defaults."

**3. Generate intent-level tools, and call the output a draft.** One tool per
endpoint is the wrong shape — agents do better with a few coarse tools like
"search flights" than with a mirror of your CRUD API. So generation gets a
grouping step: cluster endpoints by resource, emit the obvious coarse tools,
leave mutations commented out. The report shows the grouping as a proposal;
the user or their agent adjusts it through the overrides file; regeneration
keeps their decisions. Without this, codegen is just a 1:1 mapper with
extra steps — this is what makes it not that.

## journeys — one file we ship, small files the user's agent writes

**Our code is exactly one file: `journey.webmcp.ts`.** When `generate` runs,
it writes this file into the user's repo next to `runtime.webmcp.ts`, under
the same contract as the runtime file: fully ours, regenerated on every run,
never hand-edited. ~90 lines, no dependencies beyond the runtime helpers
that already ship. This is the entire journey machinery — complete, not
abbreviated (the same file lives at
`packages/codegen/assets/journey.webmcp.ts`):

```ts
import {
  getModelContext, toolResult, toolError, asToolError, requestUserConfirmation,
  type WebMcpToolResult,
} from "./runtime.webmcp";

type Json = Record<string, unknown>;

export interface JourneyStep {
  description: string;   // what the agent reads: "Search real places and store the pick."
  input: Json;           // the step's input fields, as a JSON Schema object
  provides: string[];    // draft fields this step leaves behind; submit waits for them
  run?: (input: Json, signal: AbortSignal | undefined, draft: Readonly<Json>) => Promise<Json>;
  // ^ what the step does — usually calls an existing tool's execute.
  //   Gets the draft so far. Returns the fields to store. Default: store the input.
}

export interface JourneyDef {
  name: string;          // "document-trip" — step tools derive from it
  goal: string;          // the one sentence every step repeats to the agent
  steps: Record<string, JourneyStep>;
  submit: {
    description: string;                         // what the human confirms
    build: (draft: Readonly<Json>) => unknown;   // assemble the real tool's input
    run: (input: never, signal?: AbortSignal) => Promise<unknown>;  // the real tool's execute
  };
}

export function createJourney(def: JourneyDef) {
  const modelContext = getModelContext();
  let draft: Json = {};   // ← THE DRAFT. One plain object per page load.

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
      await modelContext.registerTool({
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
      }, { signal });
    }
  }

  async function registerSubmit(signal?: AbortSignal): Promise<void> {
    if (!modelContext) return;
    await modelContext.registerTool({
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
          draft = {};   // a submitted journey starts clean
          return result as WebMcpToolResult;
        } catch (error) {
          return asToolError(error);
        }
      },
    }, { signal });
  }

  return {
    async register(signal?: AbortSignal): Promise<void> {
      await registerSteps(signal);
      await registerSubmit(signal);
    },
    inspectDraft: (): Json => ({ ...draft }),   // for the dashboard and tests
  };
}
```

Reading that code, the three pieces are:

1. **The draft** — `let draft = {}`, one plain object per page load. Steps
   write into it; the submit reads from it. It dies with the page: a
   half-finished journey doesn't survive a reload, which is what you want.
2. **Step tools** — `registerSteps`: ordinary registered WebMCP tools named
   `<journey>-<step>` (`document-trip-search-places`). A step's `execute`
   stores its result into the draft and replies with what's still missing,
   so the agent always knows the next move.
3. **The submit gate** — `registerSubmit`: one more tool, `<journey>-submit`,
   whose `execute` does four things in order: refuse with the missing list →
   ask the human to confirm → run the real tool's `execute` with
   `build(draft)` → clear the draft. No way around it, because the real
   input only exists inside `build(draft)`.

**What the CLI does around that one file — three mechanical jobs:**

1. **Copy it in.** The same code path that already scaffolds
   `runtime.webmcp.ts` on every `generate`.
2. **Register journeys on page load.** The generated `index.ts` — the file
   that today exports `registerAllTools()` — also imports every export of
   `journeys/*.webmcp.ts` and calls its `.register()`. Dropping a new
   journey file into that folder makes it live with zero wiring.
3. **Check journey files in `verify`.** Submit gate present, every step
   described within budget, step count ≤5, no PII-shaped draft field leaking
   into a step's output.

Plus one report line at generate time when endpoints cluster like a flow
("3 stamp endpoints and a per-trip eligibility read look like one flow —
declare a journey?"). A hint, never an auto-generation.

**What we never write: the journey definitions themselves.** Every
`journeys/*.webmcp.ts` file is the user's agent's code, written with the
skill file's guidance — only the product side knows the flow. What codegen
can't do: read an OpenAPI spec and discover that "create a trip" is really
search → set details → create → open the editor. That knowledge lives in
the product, not the API contract. A CLI guessing flows produces plausible
garbage.

Two real examples of those user-side files, from beenthere's generated
surface:

```ts
// journeys/document-trip.webmcp.ts
export const documentTrip = createJourney({
  name: "document-trip",
  goal: "Record a trip you've been on and open the editor to write its story",
  steps: {
    "search-places": {
      description: "Search real places and store the pick.",
      input: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
      provides: ["locationObject"],
      run: async (input, signal) => {
        const res = await executeGetAutocomplete({ input: String(input.input) }, signal);
        return { locationObject: pickFrom(res) };  // the user's pick
      },
    },
    "set-details": {
      description: "Set the trip's title and dates.",
      input: { type: "object", properties: { title: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["title"] },
      provides: ["title"],
    },
  },
  submit: {
    description: "Create the trip and open it in the editor.",
    build: (draft) => draft as CreateTripInput,
    run: executeCreateTrip,                         // POST /v1/trips/
  },
});
```

Why this journey exists: `create-trip`'s input has a `locationObject` with 7
required fields (`placeId`, `fullAddress`, `country`, ...) that an agent
cannot invent — it comes from `get-autocomplete`. Called cold, the agent
hallucinates a place and fails server-side validation. The journey's draft
carries the resolved place from step 1 into the submit, so the hard input is
real by construction.

Why it's named `document-trip` and not `plan-trip`: beenthere is a journal
for trips you've *been on*, not a planner. Naming it `plan-trip` would pass
every mechanical check — verb-first, short, maps to a real endpoint — and
still be wrong. That class of mistake is the skill file's job; see below.

```ts
// journeys/collect-stamp.webmcp.ts
export const collectStamp = createJourney({
  name: "collect-stamp",
  goal: "Generate a stamp for a city the user has a qualifying trip for",
  steps: {
    "pick-trip": {
      description: "Pick the trip to base the stamp on.",
      input: { type: "object", properties: { tripId: { type: "string" } }, required: ["tripId"] },
      provides: ["tripId"],
    },
    "check-eligibility": {
      description: "Check what stamp this trip qualifies for.",
      input: { type: "object", properties: {} },
      provides: ["eligibility"],
      run: async (_input, signal, draft) => ({
        eligibility: await executeGetTripStampEligibility({ tripId: String(draft.tripId) }, signal),
      }),
    },
  },
  submit: {
    description: "Generate the stamp (a paid generation call).",
    build: (draft) => ({ name: cityFrom(draft.eligibility) }),
    run: executeGenerateStamp,                       // POST /v1/stamps/generate
  },
});
```

Why this one exists: `generate-stamp` is a paid generation call, and a stamp
only makes sense for a trip that qualifies. Without the journey shape, an
agent generates stamps for cities the user never visited; with it, the
eligibility check gates the spend, and the submit reuses the trip from the
draft. (A step's `run` receives the draft so far — that's how
`check-eligibility` reads the `tripId` that `pick-trip` stored.)

No JSON config DSL — the declaration references the user's schemas and
tools, so it's code anyway; a second config language is weight for nothing.
The skill file teaches the user's agent how to turn the report's cluster
hint into the files above.

## skill file — the rules, sitting in the user's repo

The actual file is written and reviewable:
`packages/codegen/assets/skill/SKILL.md` (standard skill format — YAML
frontmatter with a `description` written as the trigger, then the rules).
The generator drops it into the user's repo on first run, next to the tools.
It teaches whatever agent the user runs: the naming rules, description
budgets, exposure decisions, the execute contract, how to edit generated
files without fighting regeneration, and the journey pattern above.

This is how the rules reach the user's model when it edits their tools — no
API keys, no network calls, works even when the prompt is lazy. Their agent
knows their product, which our CLI never can, so this is also where good
grouping decisions actually happen.

The hardest rule it teaches: **before naming an intent-level tool or
journey, understand the product** — what it is, who uses it, when in the
user's life the action happens. If that's not written down anywhere, the
agent asks the user. A wrong-tense or wrong-role name (`plan-trip` on a
memories product) passes every mechanical check and still ships wrong; this
is the one failure no deterministic check can catch, so the discipline lives
in the file the agent reads while it works.

### The eval plan

Following the two references the user pointed at
([OpenAI](https://developers.openai.com/blog/eval-skills),
[philschmid](https://www.philschmid.de/testing-skills)): an eval is
prompt → captured run → checks → score. Concretely for this skill:

1. **Prompt set** — 10–20 cases in `evals/skill/`, each a situation plus its
   own expected checks. Categories: trigger tests ("add a webmcp tool for
   X" should activate the skill), core tasks (write a tool from a schema,
   improve a generated description, enable a withheld write tool), the
   journey fixture (below), and negative controls (an unrelated coding
   prompt — the skill must not trigger).
2. **The sharpest fixture** — a copy of beenthere's generated surface with
   the prompt "write the trip journey." The right answer is retrospective:
   name matches `document|record|log`, and `/plan|book/` is an automatic
   fail. Regex-checkable, no judge needed.
3. **Harness** — run the agent CLI headlessly (`codex exec --json` or
   equivalent) in a clean copy of the fixture repo per case, 3–5 trials per
   case since behavior is nondeterministic. Grade outcomes, not paths.
4. **Deterministic checks first** — produced file parses; name verb-first
   and ≤30 chars; description ≤500 and says what returns; writes keep the
   confirmation call; `execute` calls the real endpoint; nothing edited
   above the generated marker; journeys use `createJourney` with a submit
   gate.
5. **LLM rubric second, selectively** — for what regex can't grade (is the
   tool intent-shaped? did the agent ask about product context?), a second
   pass constrained to a structured schema (`overall_pass`, per-check
   results), so scores diff across runs.
6. **Operate like tests** — every real failure becomes a new case; once a
   case hits ~100% it graduates into a regression suite; run the suite with
   the skill unloaded occasionally — if everything still passes, the model
   absorbed the skill and we retire it.

## Out of scope for now

Two pieces from earlier versions of this direction are parked — real, but
later, after the reliability work above lands:

- **The audit package** (`@webmcp-stack/audit`): extracting the checks into
  their own package with `verify` as a thin wrapper, plus the paste-a-URL
  audit. `verify` keeps growing inside codegen for now; extraction happens
  when the URL-audit product actually starts.
- **The dashboard as a report**: browse + scorecard + model-based review,
  with the editing UI removed. Not now. (Removing the LLM layer is *not*
  parked — that's deletion, and deletion is in scope.)

## What gets removed

- **The LLM suggestion layer** (`--suggest`, `--llm`, `src/llm.ts`). Frozen
  the day the skill file ships, deleted a release later. The user's own
  model does this better.
- **The big roadmap** (Test, Control, Observe, Secure). Narrowed to two
  jobs: write the rules down, check tools against them.

## Order of work

Already shipped (0.7–0.8.2, current on npm): withheld-by-default writes,
confirmation gates, the naming rules, descriptions that say what a tool
returns, nested untrusted-content marking, and `verify` with its scorecard
and `--url` check.

What's left, in order:

1. Close the budget gaps: the 500/150 description limits in generation and
   `verify`, and the 1.5K output-truncation helper in the generated region.
2. The skill file (`assets/skill/SKILL.md` — written, needs the scaffold
   wiring) plus its eval harness.
3. Journeys — ship the `createJourney` helper (`assets/journey.webmcp.ts` —
   written, needs the scaffold wiring) and the verify checks for journey
   files.
4. The grouping step — intent-level tools by default, proposal in the
   report.
5. Delete the LLM layer (`--llm`, `--suggest`, shipped in 0.8) once the
   skill file has shipped and nobody has complained.

Parked (out of scope for now): the audit-package extraction, the
dashboard-as-report rework, and the paste-a-URL audit.
