# PR #4 review: The intent surface

**PR:** https://github.com/SouravInsights/webmcp-stack/pull/4
**Branch:** `feat/intent-tools` against `main`
**Reviewed:** 2026-09-11

## The short version

The hard parts are built well. Grouping the upload handshake only when the rules
are exact is the right call, and putting the submit gate in a generator-owned
file means a journey can't edit the gate out. Tests pass, types pass, and the
spec sync is real.

But before this merges I'd fix one generation bug and correct two safety
promises in the new docs. The bug can make the tool fail the project's own CI.
The promises are worse in a quiet way: they tell a reader the audit enforces
things it doesn't, and the whole pitch of this product is that the audit is
where the safety lives.

## What I actually ran

- Test suite: 220 pass.
- Typecheck: clean.
- Eval self-test (`run.mjs --selftest`): passes.
- Regenerated the eval fixture from its spec: byte-for-byte identical to what's
  committed, so the eval baseline matches the current templates.
- Checked every spec claim against the spec fork at `97da8f5`. `title`,
  `consequentialHint`, `exposedTo`, the `executeTool` signature, and the 1-128
  name rule are all exactly as described. `requestUserInteraction()` really is
  absent, so the "watch item" framing is honest.

## The problems, in plain terms

### 1. The generator can produce a value that's one character too long

A parameter description is supposed to be trimmed to 150 characters. If the
description is one long unbroken string (a URL, a token, an ID with no spaces),
the trimmer keeps all 150 characters and then adds an ellipsis, so the result is
151. I reproduced it.

Why that matters: `verify` later flags anything over 150 as an **error**, and the
project's CI gate fails on errors. So a developer runs `generate`, gets a file the
tool wrote, and then their own pipeline rejects it. And they can't just edit the
generated region to fix it, because that's the region that gets overwritten. The
tool should never produce text that its own checker refuses.

The cause is one line in `packages/codegen/src/describe.ts` that appends the
ellipsis after slicing to the budget instead of inside it.

### 2. Two safety promises the docs make, that the code doesn't keep

Both are in the new journey FAQ (and one is repeated in the direction doc):

**"Journey tools count toward the surface limit, and CI fails when the list
gets too big."** Neither half is true. The surface check only looks at the
generated endpoint tools. The journey step tools are built at runtime and never
reach that code, so they aren't counted at all. And going over the limit is a
warning, not an error, so it doesn't fail CI either.

**"A tool that only makes sense inside a journey won't register on its own, so
the journey shrinks your surface."** Nothing implements this. When
`document-trip` gets its place data from `get-autocomplete`, that tool still
registers on its own, because reads register by default. The convention is real,
but following it is on the developer. The docs present it as enforced.

Why it matters: a reader will trust that the audit has their back here and stop
paying attention. Then they ship forty tools and nothing in `verify` objects.

### 3. A journey step is labeled "read-only" even when it writes

Every journey step is registered as read-only, no matter what it does. But a
step's `call` is just user code. It can call the real create-trip caller directly
instead of going through the submit gate. When it does:

- The tool is advertised to the agent as safe to call, so the agent calls it.
- The write happens with no confirmation prompt.
- `verify` doesn't catch it, because its "no direct fetch" check looks for
  `fetch(` and `callApi(`, not for `fetchCreateTrip(`.

So the human-in-the-loop guarantee only holds for a journey that routes every
write through `submit`. A sloppy journey (or a coding agent having a bad day) can
route around it, and the audit will stay quiet. For a tool whose reason to exist
is "the audit blocks the dangerous stuff," this is the finding I'd care most
about.

There's a related assumption baked in: `docs/specs/journeys.md` even lists a
`navigate` side effect as a possible step, which plainly isn't a read.

### 4. Journeys can silently fail to register

Generated tools ask the browser for the WebMCP API at the moment they register.
Journeys ask once, when the file is first loaded, and remember the answer
forever. If the API appears in between those two moments, the tools register and
the journeys don't, with no error. The fix is small: ask at registration time,
the same way the tools do.

### 5. Journey step descriptions can go over the 500-character limit

The factory takes the generated tool's description, which is already trimmed to
500, and appends `Part of "document-trip": ...`. So the final text can be over
budget, and `verify` only measures the description written in the journey file,
not the text the factory builds at runtime. Again: the "budgets enforced" claim
holds for endpoint tools, but not for journey tools.

## Smaller things, worth a look but not blockers

- **The root `README.md` still sells the two flags this PR deletes.** It says
  `--suggest` and `--llm` exist. The package README and the docs site were
  updated; the root one was missed. This is the most visible stale line.
- **`docs/specs/journeys.md` describes a design that was never built.** It
  describes declaring journeys in a config block. What shipped is TypeScript
  files. The spec is marked "not yet implemented", but the feature now exists in
  a different shape, so the next person will read the wrong plan.
- **The old LLM layer is still all over `docs/specs/`.** Fine to defer, but a
  one-line "removed in 0.9" note would stop someone rebuilding it.
- **No changeset.** The repo's own rule is to add one for user-facing changes,
  and this removes two CLI flags, adds files, and changes what the package
  publishes.
- **Small cleanups:** dead code in `evals/skill/run.mjs` (imports and then voids
  `execFile`), and one Biome warning from a test string in `group.test.ts`.

## What's genuinely good here

Worth saying plainly, because most of this doc is complaints:

- **Grouping is disciplined.** It merges only when four exact rules line up, and
  skips anything fuzzy with a note. The tests pin the real beenthere pair, the
  unthreadable pair, the cross-resource pair, and a GET negative. That's the
  right instinct: a decision it doesn't have to make is a decision it can't get
  wrong.
- **The gate sits in owned code.** For journeys that use the factory as intended,
  there is genuinely no way around the confirmation. That's the right design.
- **Budgets have one source of truth.** Generation and `verify` read the same
  constants, so the measure matches the composer.
- **The evals grade files, not vibes.** A self-test for the graders and a
  "skill removed" control case for detecting absorption is more rigor than most
  features get.
- **The spec sync is honest.** The watch items really aren't in the spec.

## If I were merging this

1. Fix the one-character overflow and add a test for the no-space case.
2. Decide on the step read-only labels and the write-bypass. Either enforce that
   steps are reads, or stop calling them read-only, and teach `verify` to spot a
   step that calls a known write tool.
3. Correct the two doc promises (surface count, tool absorption), or build them.
   Don't ship a safety claim the audit can't back.
4. Ask the browser for the WebMCP API at registration time.
5. Update the root README and add a changeset.
