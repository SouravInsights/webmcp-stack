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
  (shipped in 0.7). Destructive tools get marked consequential
  (`consequentialHint`, spec annotation — to ship). Origin scoping
  (`exposedTo`) ships as a config option — the spec API exists now
  (to ship; see docs/research/2026-09-10-spec-sync.md).
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

**Grouping and journeys are not the same thing.** Grouping *merges*: several
endpoints that are one action split by API shape become one tool —
beenthere's `create-media-request-upload` + `complete-media-upload` are an
upload handshake no agent should see; one `upload-media` tool wraps both
calls. It happens at generate time, from the spec, no human input. Journeys
*chain*: several different decisions with shared state and one guarded
submit (`document-trip`). They're written after generation, by the user's
agent, because the flow lives in the product. One-line test: same action
split across calls → group it; different decisions along the way → journey.
Grouping shrinks the standalone surface; journeys make dangerous writes
reachable under a gate — and tools a journey covers get absorbed into it
(flow-only tools never register standalone), so the total registered surface
goes down, not up. `verify`'s surface budget counts journey tools too, so
this is enforced, not aspirational.

## journeys — one file we ship, small files the user's agent writes

**Our code is exactly one file: `journey.webmcp.ts`.** When `generate` runs,
it writes this file into the user's repo next to `runtime.webmcp.ts`, under
the same contract as the runtime file: fully ours, regenerated on every run,
never hand-edited. ~120 lines, no dependencies beyond the runtime helpers
that already ship. The complete, current copy lives at
`packages/codegen/assets/journey.webmcp.ts` — that file is the review
artifact; this section explains it.

The contract it exposes — this is the part that matters:

```ts
// A step backed by an existing generated tool: inherits its description and
// input schema, calls the raw caller the generated file exports. You write
// only what's new — which slice of the result lands in the draft.
interface ToolStep {
  tool: { description?: string; inputSchema?: Json };          // e.g. getAutocompleteTool
  call: (input, signal, draft) => Promise<unknown>;            // e.g. fetchGetAutocomplete
  store: (result: unknown) => Json;                            // what lands in the draft
  provides: string[];                                          // draft fields submit waits for
  description?: string;                                        // override; default: the tool's
  input?: Json;                                                // override; default: the tool's
}

// A step with no backend call — it just collects input into the draft
// ("set the title and dates"). With a run, it can do work first.
interface FreeStep {
  description: string;
  input: Json;
  provides: string[];
  run?: (input, signal, draft) => Promise<Json>;               // default: store the input
}

interface JourneyDef {
  name: string;          // "document-trip" — step tools derive from it
  goal: string;          // the one sentence every step repeats to the agent
  steps: Record<string, JourneyStep>;                          // ToolStep | FreeStep
  submit: {
    description: string;                          // what the human confirms
    build: (draft) => unknown;                    // assemble the real tool's input
    run: (input: never, signal?) => Promise<unknown>;  // the real tool's execute
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
   `runtime.webmcp.ts` on every `generate`. One template change rides along:
   generated tool files also export the raw caller (`fetchGetAutocomplete` —
   just the `callApi` line, unwrapped), because journeys compose raw data,
   not agent-shaped results.
2. **Register journeys on page load.** The generated `index.ts` — the file
   that today exports `registerAllTools()` — also imports every export of
   `<outDir>/journeys/*.webmcp.ts` and calls its `.register()`. Dropping
   a new journey file into that folder and re-running generate is the
   whole wiring story.
3. **Check journey files in `verify`.** Submit gate present, every step
   described within budget, step count ≤5, no PII-shaped draft field leaking
   into a step's output.

Plus one report line at generate time when endpoints cluster like a flow
("3 stamp endpoints and a per-trip eligibility read look like one flow —
declare a journey?"). A hint, never an auto-generation.

**What we never write: the journey definitions themselves.** Every
`<outDir>/journeys/*.webmcp.ts` file is the user's agent's code, written with the
skill file's guidance — only the product side knows the flow. What codegen
can't do: read an OpenAPI spec and discover that "create a trip" is really
search → set details → create → open the editor. That knowledge lives in
the product, not the API contract. A CLI guessing flows produces plausible
garbage.

Two real examples of those user-side files, from beenthere's generated
surface:

```ts
// src/webmcp/journeys/document-trip.webmcp.ts
export const documentTrip = createJourney({
  name: "document-trip",
  goal: "Record a trip you've been on and open the editor to write its story",
  steps: {
    "search-places": {
      tool: getAutocompleteTool,                        // schema + description inherited
      call: (input, signal) => fetchGetAutocomplete({ input: String(input.input) }, signal),
      store: (places) => ({ locationObject: pickFrom(places) }),  // the resolved pick
      provides: ["locationObject"],
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
    run: executeCreateTrip,                             // POST /v1/trips/
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
// src/webmcp/journeys/collect-stamp.webmcp.ts
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
      tool: getTripStampEligibilityTool,
      input: { type: "object", properties: {} },        // the agent provides nothing
      call: (_input, signal, draft) => fetchGetTripStampEligibility({ tripId: String(draft.tripId) }, signal),
      store: (eligibility) => ({ eligibility }),
      provides: ["eligibility"],
    },
  },
  submit: {
    description: "Generate the stamp (a paid generation call).",
    build: (draft) => ({ name: cityFrom(draft.eligibility) }),
    run: executeGenerateStamp,                           // POST /v1/stamps/generate
  },
});
```

Why this one exists: `generate-stamp` is a paid generation call, and a stamp
only makes sense for a trip that qualifies. Without the journey shape, an
agent generates stamps for cities the user never visited; with it, the
eligibility check gates the spend, and the submit reuses the trip from the
draft. (A step's `call` receives the draft so far — that's how
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

Shipped 2026-09-10 on the journeys feature branch (feat/journeys):

1. ~~Spec sync quick wins~~ — `title` emitted everywhere (tools and journey
   gates), `consequentialHint` on destructive tools, `exposedTo` config
   pass-through on the tools output, Chrome 149/150 version fixes.
2. ~~Budgets~~ — generation composes within 500/150 (fitBudget, sentence
   cuts), verify's new error-level Budgets check measures the final text,
   the runtime caps every `toolResult` at ~1.5K with a truncation notice.
3. ~~Skill file~~ — scaffolded at `.agents/skills/webmcp-tools/SKILL.md`
   (cross-client location, Claude Code included), regenerated like the
   runtime; eval harness at `packages/codegen/evals/skill/` with the
   beenthere-lite fixture, nine cases, deterministic graders, and a passing
   self-test (`node run.mjs --selftest`).
4. ~~Journeys~~ — `journey.webmcp.ts` scaffolded next to the runtime, the
   barrel registers every `<outDir>/journeys/*.webmcp.ts` it finds,
   endpoint-backed tools emit the `fetchX` raw caller that steps compose,
   and verify lints journey files (gate, budgets, step count, no raw fetch).
5. ~~Grouping~~ — `groupHandshakes` merges POST handshake pairs
   (request-upload + complete-upload → upload-media) with exact-name
   threading only; the merged tool is a withheld draft, members untouched,
   the CLI prints the proposal line.
6. ~~LLM layer~~ — deleted: `--llm`, `--suggest`, the config options, the
   provider flow, ~1,050 lines gone. The skill file is how rules reach
   models now.

Parked (out of scope for now): the audit-package extraction, the
dashboard-as-report rework, and the paste-a-URL audit.
