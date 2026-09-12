# PR #4 review: The intent surface

**PR:** https://github.com/SouravInsights/webmcp-stack/pull/4
**Branch:** `feat/intent-tools` against `main`
**Reviewed:** 2026-09-11

## The short version

The hard parts are built well. Grouping the upload handshake only when the rules
are exact is the right call. Putting the submit gate in a generator-owned file
means a journey can't edit the gate out. Tests pass, types pass, and the spec
sync is real.

The one thing to settle before touching code: codegen treats Chrome's character
advice as if it were a law the browser enforces. It isn't. Once that's clear, the
right fixes get easier, and one of them (the trimmer) stops being a straight bug
fix and becomes a design decision.

## First: are those character limits actually rules?

This matters, so I checked the spec itself rather than trusting the summary in
the code comments.

**What the browser actually rejects.** In `index.bs`, registering a tool fails
only for these reasons (lines 668-678):

- a tool with that name is already registered
- the name or the description is an empty string
- the name is longer than 128 characters, or contains anything other than
  letters, digits, `_`, `-`, or `.`
- the `inputSchema` can't be serialized to JSON

**There is no description length rule in the spec.** Not 150, not 500. Nothing.
The spec's own roadmap text says the opposite: the 128-char name is the only
"nominal size restriction," and "further work is needed to evaluate the right
size limits for titles, names, and other inputs" (line 1816, issue #73).

**Where 150/500/1.5K come from.** The spec README's Best Practices section points
at two Chrome guides (`best-practices` and `secure-tools`) for the detailed
numbers. Those guides are the source. They are authoring advice, and exceeding
them does not error. Nothing rejects a 600-character description.

So we have three different things that were being treated as one:

1. **Hard rules the browser enforces.** Name length and charset, non-empty name
   and description. Break these and registration fails. Codegen must never break
   these, and today it doesn't.
2. **Chrome's authoring guidance.** 30-char names, 150-char parameter text,
   500-char tool text, roughly 1.5K of output. These help the model pick and
   call tools, and keep context small. Overrunning them is a quality smell, not
   a failure.
3. **This project's own policy.** Generation truncates to those numbers and
   `verify` marks overruns as errors. That is a choice codegen made. It's a
   defensible choice, but it's a policy, not a law.

## What should codegen do about it?

The goal is a tool that writes good descriptions, not a tool that wins a
character-count contest. A few conclusions:

**Never silently shorten text a human or a spec wrote.** That's the real problem
with the current behavior. The developer (or their spec) had a precise sentence;
the generator quietly chops it. The generated region can't be hand-edited, so the
only way back is an override file most people won't know about. If something has
to give, keep the full text and tell them it's long. Silently changing meaning is
the worst of the options.

**When codegen writes the description itself, aim at the budget by construction.**
The generator controls its own phrasing, so it can compose text that naturally
fits, instead of composing something too long and then cutting it. This is where
being budget-aware actually belongs.

**Report overruns, don't block on them.** A 160-character description is not a
broken tool. Make it a warning in `verify` that says the real length, so a
developer or their coding agent can decide whether to tighten it. Keep `error`
for the things that genuinely break: a spec-invalid name, an empty name or
description, an unserializable schema.

**Make the budgets configurable.** Teams that want Chrome's exact numbers as a
CI gate can turn on strict mode. The default shouldn't fail a build over a
sentence that reads fine.

**Watch how truncation and `verify` fight each other.** Today `verify` warns when
a description doesn't say what the tool returns. But the most common reason a
description overflows is that it has a second sentence saying what it returns,
and the trimmer cuts exactly that sentence off. So the generator can create the
problem it then complains about. Whatever is decided for budgets has to be
decided for both generation and `verify` at the same time, or they'll contradict
each other.

**Keep the output cap as the exception.** The ~1.5K limit on tool results is
different: it protects the model's context at runtime, the helper already adds a
visible "truncated" notice, and cutting a giant JSON blob doesn't destroy
meaning the way cutting a sentence does. Truncation is the right tool there.

## The problems, in plain terms

### 1. The description trimmer has a real bug, but the deeper issue is the trimming

Two separate things here.

The bug: a parameter description is supposed to be cut to 150 characters. If the
text is one long unbroken string (a URL, a token, an ID), the trimmer keeps all
150 and then adds an ellipsis, landing at 151. I reproduced it. Since `verify`
treats 150 as an error, the generator can produce text its own checker rejects,
and the developer can't fix it in the generated region. If we keep any trimming,
that line needs to reserve room for the ellipsis.

The deeper issue: per the section above, 150 is Chrome's advice, and cutting a
description at a character boundary is a blunt way to honor it. Before fixing
the off-by-one, decide whether silent truncation of author text is the behavior
we want at all. My suggestion is no: compose short, warn on long. But if the
team decides to keep truncating, fix the one line and add a test for the
no-space case.

### 2. Two safety promises the docs make, that the code doesn't keep

Both are in the new journey FAQ (and repeated in the direction doc).

**"Journey tools count toward the surface limit, and CI fails when the list
gets too big."** Neither half is true. The surface check only looks at generated
endpoint tools; journey step tools are built at runtime and never reach it. And
going over the limit is a warning, so it doesn't fail CI.

**"A tool that only makes sense inside a journey won't register on its own, so
the journey shrinks your surface."** Nothing implements this. When
`document-trip` gets its place data from `get-autocomplete`, that tool still
registers on its own, because reads register by default. It's a convention the
developer has to follow, presented in the docs as if the system enforces it.

Why it matters: a reader will trust that the audit is watching this and stop
watching it themselves, then ship forty tools while `verify` stays quiet.

The other AI's suggested resolution is reasonable: count the journey tools (steps
plus one submit per file, which you can already compute from the linted files)
and make over-limit a real error, then reword the absorption sentence to say it's
a convention. Auto-hiding a standalone read that a journey fully absorbs can wait
for later.

### 3. A journey step is labeled "read-only" even when it might write

Every journey step is registered as read-only, whatever it actually does. A
step's `call` is just user code. It can call the real create-trip caller directly
instead of going through the submit gate. When that happens, the tool is
advertised to the agent as safe, the write goes through with no confirmation,
and the audit says nothing.

The other AI pushed back on my first framing, and it was right: a regex can't be
the answer here, because the deepest bypass is editing the owned half of
`create-trip.webmcp.ts`, and no lint will catch that. That's a separate integrity
feature.

But there are two different cases and it's worth keeping them apart:

- **A step that calls a generated write caller** (`fetchCreateTrip` or
  `executeCreateTrip`). No editing required, just a coding agent taking a
  shortcut. This is reachable today, and a lint *can* flag it, because the caller
  is generated and its tool is already classified as a write. Worth doing as a
  tripwire, not a guarantee.
- **A hand-edited owned region.** Not catchable by any lint. Out of scope here.

The honest fix for the actual defect is to stop claiming the steps are read-only
when we can't prove it, and to write down that a journey is only as safe as the
person who wrote it. The lint tripwire is a bonus.

### 4. Journeys can silently fail to register

Generated tools ask the browser for the WebMCP API at the moment they register.
Journeys ask once, when the file first loads, and remember the answer. If the API
appears in between, the tools register and the journeys don't, with no error.
Fix is small: look it up at registration time, the same way the tools do.

### 5. Journey step descriptions can go over the limit

The factory takes a description already trimmed to 500 and appends
`Part of "document-trip": ...`, so the final text can be over. `verify` only
measures the text in the journey file, not what the factory builds at runtime.
This is the same policy question as #1: if budgets are guidance, this is a
warning at most; if they're hard, trim the base before appending so the composed
text fits.

## Smaller things, worth a look but not blockers

- **The root `README.md` still sells the two flags this PR deletes.** It says
  `--suggest` and `--llm` exist. The package README and the docs site were
  updated; the root one was missed.
- **`docs/specs/journeys.md` describes a design that was never built.** It
  describes declaring journeys in a config block. What shipped is TypeScript
  files. The spec is marked "not yet implemented", but the feature now exists in
  a different shape, so the next person reads the wrong plan.
- **The old LLM layer is still all over `docs/specs/`.** A one-line "removed in
  0.9" note would stop someone rebuilding it.
- **No changeset.** The repo's own rule is to add one for user-facing changes,
  and this removes two CLI flags, adds files, and changes what the package
  publishes.
- **Small cleanups:** dead code in `evals/skill/run.mjs`, and one Biome warning
  from a test string in `group.test.ts`.

## What's genuinely good here

- **Grouping is disciplined.** It merges only when four exact rules line up, and
  skips anything fuzzy with a note. The tests pin the real beenthere pair, the
  unthreadable pair, the cross-resource pair, and a GET negative.
- **The gate sits in owned code.** For journeys that use the factory as intended,
  there's genuinely no way around the confirmation.
- **Budgets have one source of truth.** Generation and `verify` read the same
  constants. That's the right structure even if the policy around it needs a
  decision.
- **The evals grade files, not vibes.** A self-test for the graders and a
  "skill removed" control case is more rigor than most features get.
- **The spec sync is honest.** The watch items really aren't in the spec.

## If I were merging this

1. Decide the budget policy first: guidance (warn) or hard limit (error). Then
   make generation and `verify` agree. My vote is guidance, composed short, with
   warnings instead of silent cuts.
2. If truncation stays, fix the off-by-one so it can never return 151.
3. Correct the two doc promises about surface counting and tool absorption.
4. Stop labeling journey steps read-only, and add the best-effort write-caller
   tripwire.
5. Look up the WebMCP API at registration time.
6. Update the root README and add a changeset.

## Post-review discovery: the generated runtime did not parse

While typechecking the copied journey factory, I found something worse than
everything above. The 1.5K output cap this PR added writes a truncation notice:

```ts
const TRUNCATED_NOTICE =
  "\n… [truncated to fit the 1.5K output budget]";
```

That `\n` sits inside the outer template literal that builds the runtime file,
so the emitted file contains a real newline inside a double-quoted string.
Every generated `runtime.webmcp.ts` is a syntax error, which means no generated
tool compiles at all. The committed eval fixture carried the same broken file,
and because the graders only match text and never compile, it passed every
check. This was invisible until something tried to parse the output.

## What was implemented

All of the above is now in the branch, plus the runtime fix:

1. **Budget policy is guidance, not law.** `describe.ts` no longer silently
   shortens author or spec text. Machine-drafted text is composed to fit;
   author text is kept in full. `verify` reports overruns as warnings, for both
   tools and journey files. Tests updated to lock the new behavior.
2. **The trimmer off-by-one is fixed** and covered by a test with an unbroken
   token.
3. **Journey steps no longer claim to be read-only by default.** A tool-backed
   step inherits the composed tool's `readOnlyHint`; a free step with no `run`
   is read-only; anything else defaults to not-read-only, with an opt-in
   `readOnly` override.
4. **The WebMCP API is resolved at registration time** in the journey factory,
   matching generated tools.
5. **Journey step descriptions are composed within budget**, keeping the
   journey-name tag and fitting the base when the goal would overflow.
6. **The surface check counts journey tools** (one per step plus the submit
   gate) via `countJourneyTools`, so the docs' promise is now true.
7. **The generated runtime parses again.** `generated-code.test.ts` runs every
   output through the TypeScript compiler to catch escaping mistakes.
8. **Docs corrected:** the FAQ's surface and absorption claims, the safety
   bullet on the journeys page, the skill file's step guidance, the root README
   (removed the deleted LLM flags), and a status note on `docs/specs/journeys.md`.
9. **A changeset was added.** The fixture was regenerated and the skill copies
   were synced. `biome check` is clean, typecheck passes, and 229 tests pass.
