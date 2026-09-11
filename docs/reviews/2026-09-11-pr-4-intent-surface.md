# PR #4 review: The intent surface (journeys, grouping, budgets, agent skill)

**PR:** https://github.com/SouravInsights/webmcp-stack/pull/4
**Branch:** `feat/intent-tools` (HEAD `0beff21`) against `main` (`ede5fd9`)
**Scope:** 44 files, +4,103 / -1,126
**Reviewed:** 2026-09-11

## Verdict

The core of this PR is sound and the restraint in the risky parts is the best
thing about it. Grouping merges only on exact, deterministic rules and skips
everything fuzzy. The submit gate lives in a generator-owned file, so a journey
cannot edit the gate itself. The spec sync is real (verified against the spec at
`97da8f5`). Tests, typecheck, the eval self-test, and a fixture regeneration all
pass.

It is not merge-ready as-is. There is one generation bug that can make `generate`
produce a surface that its own `verify` fails, and several user-facing claims in
the new docs describe enforcement that the code does not implement. Those claims
sit on the safety story this product sells, so they need to be either built or
rewritten before they ship.

## What I ran

| Check | Result |
|---|---|
| `pnpm --filter @webmcp-stack/codegen test` | 220 passed, 15 files |
| `pnpm --filter @webmcp-stack/codegen typecheck` | clean |
| `node packages/codegen/evals/skill/run.mjs --selftest` | passed |
| `pnpm exec biome check packages/codegen` | exits 0, 1 warning, 1 info |
| Fixture regen (`generate --spec fixture/spec.json`) | byte-identical to the committed fixture |
| Spec cross-check at `/Users/souravinsights/Documents/Personal/webmcp` (`97da8f5`) | see below |

Spec claims verified directly in `index.bs`:

- `title` exists on `ModelContextTool` (`USVString`), and `RegisteredTool` carries it back (lines 1070-1072, 1220).
- `consequentialHint` is a real third `ToolAnnotations` boolean (line 1082).
- `exposedTo` is a real `ModelContextRegisterToolOptions.sequence<USVString>` (line 1162).
- `executeTool(RegisteredTool, optional any, optional options)` returns `Promise<DOMString>` (line 611).
- Name rule is 1-128 chars over `[A-Za-z0-9._-]`, so the 30-char cap is Chrome guidance, not spec (line 158).
- `requestUserInteraction()` is absent from the spec, so the "watch item" framing is correct.

## Findings

### 1. `fitBudget` can return 151 characters for a 150-char budget (generation bug)

`packages/codegen/src/describe.ts:53`

```ts
return `${(wordEnd > 0 ? slice.slice(0, wordEnd) : slice).trimEnd()}…`;
```

When the overflow has no space in the first `budget` characters, `wordEnd` is
`-1`, so the whole `budget`-length slice is kept and an ellipsis is appended after
it. Reproduced:

```
fitBudget("x".repeat(300), 150).length === 151
```

These strings are author param descriptions (URLs, tokens, unbroken identifiers),
which is exactly where this branch fires. The 150-char cap is an error-level
`verify` check (`verify.ts`, "Budgets" check), so generation can emit output that
fails the repository's own CI gate. Fix: reserve the ellipsis inside the budget,
for example `slice.slice(0, Math.max(1, budget - 1)).trimEnd() + "…"`, and add a
test for the no-space case.

### 2. The docs claim a surface check that does not count journey tools and does not fail CI

`site/content/docs/journeys-faq.mdx` ("Won't journeys make my tool list even
bigger?") and `docs/research/2026-09-07-what-to-double-down-on.md` both say some
version of: `verify`'s surface-size check counts registered tools including
journey tools, and CI fails when the list grows.

Neither is true as implemented:

- `verifyTools` is called with `result.tools` (`cli.ts:337`), which contains only
  generated endpoint tools. Journey step tools and submit tools are created at
  runtime by `createJourney` and never appear there. `verifyJourneyFiles` counts
  steps per journey only, and always as a warning.
- The surface check is `level: "warning"` (`verify.ts:280`), and `verify` exits 1
  only on `error` checks (`cli.ts`, `return errors > 0 ? 1 : 0`). So a 40-tool
  surface passes with a warning.

Either sum registered endpoint tools plus journey-provided tools into the surface
budget and make it an error, or rewrite the FAQ to say what is actually measured.

### 3. "A tool that only makes sense inside a flow becomes its journey step's only face" is not enforced

`site/content/docs/journeys-faq.mdx`, `site/content/docs/journeys.mdx`,
`docs/research/2026-09-07-what-to-double-down-on.md`.

There is no link between a journey file and the generated tool it composes. When
`document-trip` composes `getAutocompleteTool`, the generated
`get-autocomplete.webmcp.ts` still registers standalone, because reads register by
default. Writes happen to be withheld by default, but a user who enables
`create-trip` standalone still gets two doors. Nothing in `verify` catches it.

This is a convention that the developer has to follow by hand (or by `safety.exclude`),
not a property of the system. The docs present it as enforced ("that's enforced,
not aspirational"). Rewrite to describe it as a convention, or add the machinery.

### 4. Journey steps are always advertised as read-only, but a step's `call` is arbitrary code

`packages/codegen/assets/journey.webmcp.ts:154` registers every step with
`annotations: { readOnlyHint: true }`. A `ToolStep.call` is user code and can call
any exported function, including a mutating raw caller such as `fetchCreateTrip`.
`FreeStep.run` can do anything too.

Two consequences:

- The `readOnlyHint: true` is a hardcoded assumption that the audit cannot verify.
  A step that performs a write is mislabeled and agents will treat it as safe.
  `docs/specs/journeys.md` even lists a `navigate` side effect as a possible step.
- The `verify` "no direct fetch" check matches `/\b(?:fetch|callApi)\s*\(/` only.
  `fetchCreateTrip(` and `executeCreateTrip(` do not match, so a journey that
  performs the real write inside a step bypasses the submit gate and still passes
  `verify`. The stated guarantee ("it can't skip the human's yes") only holds for
  journeys that route all writes through `submit`.

If read-only steps are a real invariant, enforce it (for example, require
`ToolStep.tool` to be a read tool, or check `readOnlyHint` at runtime and refuse
to register a step whose composed tool is not a read). If not, drop the claim.

### 5. `createJourney` captures the model context too early

`packages/codegen/assets/journey.webmcp.ts:108` does `const modelContext = getModelContext();`
once, when the journey definition is evaluated at module import. Generated tools
resolve `getModelContext()` inside `registerX()` at registration time. If the
runtime installs `document.modelContext` after module evaluation but before
`registerAllTools()` runs, journeys silently never register while ordinary tools
do. Resolve the context inside `registerSteps`/`registerSubmit` so the two paths
behave the same.

### 6. Journey step descriptions are not budget-checked, but the docs say budgets are enforced

The factory composes each step's agent-facing description as
`${base} Part of "${def.name}": ${def.goal}` (`journey.webmcp.ts:125`). `base`
already sits at the 500-char tool budget, so the composed string can exceed it.
`verifyJourneyFiles` only measures `description: "..."` literals inside the file
(`verify.ts`), not the runtime-composed text. The "character budgets, enforced"
claim is true for generated endpoint tools only. Worth either measuring composed
descriptions or documenting the gap.

### 7. Brittle journey linting

`verifyJourneyFiles` decides "has a submit gate" with
`/submit\s*:/ && /run\s*:/` over the whole file. A `submit:` string in a comment
plus any `run:` passes; a valid shape without those exact keys false-fails. The
step counter's brace matching does not skip string literals, so a `}` inside a
description truncates the count. These are lint false positives/negatives, not
safety holes, but they undermine "CI gates on it". A real parse or a tighter
scanner would be sturdier.

### 8. Withheld tools still cannot be enabled in one edit

Pre-existing on `main`, but this PR changes the same import logic and the promise
is central to the skill file. A withheld route-backed tool emits
`import { callApi, toolDisabled }` while its commented registration body uses
`getModelContext`, `requestUserConfirmation`, and `asToolError`. The enabling
comment only says "add toolResult", so uncommenting does not compile. At minimum
name every missing import in the comment, or just include the helpers.

### 9. Smaller notes

- `packages/codegen/evals/skill/run.mjs` imports `execFile`/`promisify`, then
  `const execFileAsync = promisify(execFile); void execFileAsync;`. Dead code.
- `packages/codegen/src/group.test.ts:129` trips Biome's
  `noTemplateCurlyInString` warning. `biome check` exits 0, so "biome clean" is
  technically true, but the PR added the warning.
- `packages/codegen/evals/skill/README.md` says "Adding an LLM-as-judge pass is
  possible later", which is fine, but note the PR deletes the LLM layer while the
  README still frames an LLM grader as a future option. Harmless, just be deliberate.

## Documentation drift

These are outside the diff's file list but the PR makes them wrong:

1. **Root `README.md:108`** still advertises `--suggest` and `--llm`. The site docs
   (`cli.mdx`) and `packages/codegen/README.md` were updated; the root README was
   not. This is the most visible stale reference.
2. **`docs/specs/journeys.md`** describes a `journeys: [...]` config block that was
   never built. The shipped design is TypeScript files under `journeys/`. The spec
   is marked "spec, not yet implemented", but the feature now exists in a different
   shape. Update it or mark it superseded so the next agent does not implement the
   old design.
3. **`docs/specs/generation-pipeline.md`, `codegen-design.md`, `tool-standard.md`**
   still describe the LLM layer as shipped or planned. Add a "removed in 0.9" note.
4. **No changeset.** `AGENTS.md` requires a changeset for any user-facing change.
   This removes two CLI flags, adds generated files, adds a skill file, and changes
   the published package's `files` list. `.changeset/` has no pending entry.

## Strengths worth keeping

- **Grouping restraint.** `groupHandshakes` merges only under four deterministic
  conditions, threads by exact name, and skips with a note when it cannot. The test
  suite pins the beenthere pair, the unthreadable pair, the cross-resource pair,
  the GETs-only negative, and the name-collision fallback. This is the right amount
  of cleverness.
- **The gate is in owned code.** Putting `build(draft)` and `run` behind a
  generator-rewritten file is the correct place for the safety. For journeys that
  use the factory as intended, there is no path around confirmation.
- **Budgets have one source of truth.** `TOOL_DESCRIPTION_MAX`/`FIELD_DESCRIPTION_MAX`
  are shared by generation and `verify`, so the measure matches the composer.
- **The eval harness grades files, not vibes.** Deterministic graders, a self-test
  for the graders, and the "skill removed" control case to detect absorption are
  all above the bar for a docs-driven feature.
- **The fixture is current.** Regenerating from `fixture/spec.json` produces
  byte-identical files, so the eval baseline is not drifting from the templates.
- **Spec sync is honest.** Everything claimed in `docs/research/2026-09-10-spec-sync.md`
  matches the spec at `97da8f5`, including the "not in the spec yet" watch items.

## Suggested before merge

1. Fix the `fitBudget` off-by-one and add a no-space test.
2. Fix findings 2, 3, and 4: either implement the surface/absorption/step-annotation
   guarantees or rewrite the docs to match reality. Do not ship a safety claim that
   the audit cannot back.
3. Resolve the model context inside `register` (finding 5).
4. Update root `README.md` and decide what to do with the stale specs.
5. Add a changeset.
