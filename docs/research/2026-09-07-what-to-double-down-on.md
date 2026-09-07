# What we build, and how

**Date:** 2026-09-07

Agents are the users now. Someone runs codegen once to scaffold their tools,
then asks their own model to improve them. We stop building anything the
user's own agent already does. What's left is four parts.

## codegen — the scaffold

The front door. Three jobs:

**1. Bake in the safety defaults nobody applies by hand.** Chrome's guidance
sets hard limits and per-tool flags; across 40 endpoints everyone forgets
some. The generator applies them to every tool, every run:

- Name and parameter names max 30 characters, tool descriptions max 500,
  parameter descriptions max 150. The generator writes text that fits;
  spec text that's too long gets cut at a sentence end and marked as
  machine-written.
- Tool outputs max 1.5K characters. You can't check this before the tool
  runs, so the generated code passes every result through a helper that
  truncates it — and that helper sits in the part of the file only the
  generator edits, so nobody deletes it by accident.
- Read tools get marked read-only automatically (done). Outputs containing
  free-text fields get marked as untrusted user content, including fields
  nested inside arrays and objects (0.7). Origin scoping (`exposedTo`) ships
  as a config option once `registerTool` supports it; until then the report
  flags it.
- Write and destructive tools ask the user to confirm each call, in the
  generator-owned part of the file (done).

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

## journeys — a helper in the repo, a small file per flow

Multi-step flows stay in the product. The honest split:

**What codegen can't do:** read an OpenAPI spec and discover that "create a
trip" is really search → set details → create → open the editor. That
knowledge lives in the product, not the API contract. No automatic journey
detection, ever — a CLI guessing flows produces plausible garbage.

**What codegen owns:** the machinery that's identical for every journey —
a shared draft, step tools that fill it, a submit gate. Shipped as a
`createJourney` helper scaffolded into the user's repo, same as the tools.

**What the user (or their agent) writes:** one small file per flow. Two real
examples from beenthere's generated surface:

```ts
// journeys/document-trip.webmcp.ts
export const documentTrip = createJourney({
  name: "document-trip",
  goal: "Record a trip you've been on and open the editor to write its story",
  steps: {
    searchPlaces: { tool: getAutocompleteTool },   // GET /v1/places/autocomplete
    setDetails:   { input: { title: "string", startDate: "string", endDate: "string" } },
  },
  submit: { tool: "create-trip", confirm: true },  // POST /v1/trips/
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
    pickTrip:         { input: { tripId: "string" } },
    checkEligibility: { tool: getTripStampEligibilityTool },  // GET .../stamp-eligibility
  },
  submit: { tool: "generate-stamp", confirm: true },  // POST /v1/stamps/generate
});
```

Why this one exists: `generate-stamp` is a paid generation call, and a stamp
only makes sense for a trip that qualifies. Without the journey shape, an
agent generates stamps for cities the user never visited; with it, the
eligibility check gates the spend, and the submit reuses the trip from the
draft.

The helper does everything generic at runtime: registers the step tools with
correct descriptions, budgets, and annotations; the submit tool refuses
until the required steps are filled, asks the human to confirm, calls the
real endpoint through the existing tool's `execute`, clears the draft. The
dashboard lets you play the journey as an agent would — call steps out of
order, see the gate block, see the confirmation. `verify` checks the file:
submit gate present, budgets met, no PII from the draft leaking into tool
outputs, step count small enough for an agent to track.

No JSON config DSL — the declaration references the user's schemas and
tools, so it's code anyway; a second config language is weight for nothing.
The first scaffold of an existing app can't emit journeys (the spec doesn't
contain them); the most the report does is hint: "3 stamp endpoints and a
per-trip eligibility read look like one flow — declare a journey?" The skill
file teaches the user's agent how to turn that hint into the files above.

## skill file — the rules, sitting in the user's repo

One markdown file the generator drops next to the tools. It teaches whatever
agent the user runs the WebMCP best practices: naming, description limits,
which tools to expose, the safety rules, how to collapse a 1:1 draft into a
few intent-level tools.

This is how the rules reach the user's model when it edits their tools — no
API keys, no network calls, works even when the prompt is lazy. Their agent
knows their product, which our CLI never can, so this is also where good
grouping decisions actually happen.

The file gets tested like code: a set of evals runs it against real models,
so a wording change that makes agents write worse tools shows up as a failed
test, not a vibe. The sharpest fixture: "given beenthere's generated surface,
write the trip journey" has a known right answer — retrospective, named like
`document-trip`. If a wording change makes agents produce `plan-trip` again,
a test fails.

The hardest rule it teaches: **before naming an intent-level tool or
journey, understand the product** — what it is, who uses it, when in the
user's life the action happens. If that's not written down anywhere, the
agent asks the user. A wrong-tense or wrong-role name (`plan-trip` on a
memories product) passes every mechanical check and still ships wrong; this
is the one failure no deterministic check can catch, so the discipline lives
here, in the file the agent reads while it works.

## audit package — the checks

All the checks live in their own package, `@webmcp-stack/audit`. One copy,
so nothing can drift. Three readers: `verify` (a thin wrapper that reads
local files and calls the package), the dashboard's report view, and the
paste-a-URL audit when it ships — same checks, pointed at a live site.

The checks are fixed and run the same way every time, no model involved:
the character limits, whether the output matches what the OpenAPI schema
says, whether the tool set is small enough for an agent to pick from.

`verify` is the CI gate — it runs the package and exits 1 on errors, so CI
can block a bad tool set. There are also optional checks that use a model —
"would an agent pick these tools for these common requests? is this tool set
shaped around what users actually want?" Those need a key, are off by
default, and never change the exit code. That rule doesn't bend.

## dashboard — the report, not an editor

Nobody opens a dashboard to hand-edit descriptions anymore; they ask a
model. So the editing gets deleted — no more writing back to the overrides
file from the UI.

What's left: see your tools, see the verify results, run the model-based
review. The one control that stays is the enable/disable toggle, because
deciding what to expose to agents is a decision we want a human to make.

## What gets removed

- **The LLM suggestion layer** (`--suggest`, `--llm`, `src/llm.ts`). Frozen
  the day the skill file ships, deleted a release later. The user's own
  model does this better.
- **The big roadmap** (Test, Control, Observe, Secure). Narrowed to two
  jobs: write the rules down, check tools against them.

## Order of work

1. Ship the 0.7 tool standard — character limits, nested untrusted-content
   checks, disabled tools stop registering. Mostly specced already.
2. Extract the checks into `@webmcp-stack/audit`; `verify` becomes a thin
   wrapper and gets the character-limit checks.
3. The grouping step — intent-level tools by default, proposal in the report.
4. The skill file, with evals — including the "how to define a journey"
   guidance.
5. Dashboard surgery — editing out, report in. Delete the LLM layer.
6. Journeys scaffold — declared flows wired by codegen, per the journeys
   spec.
