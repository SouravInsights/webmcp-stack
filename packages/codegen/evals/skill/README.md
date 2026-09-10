# Skill-file evals

The skill file (`assets/skill/SKILL.md`) is treated like code: a wording
change that makes agents write worse WebMCP tools should show up as a failed
test, not a vibe. This directory is that test rig, following the OpenAI
eval-skills writeup and philschmid's testing-skills post:
**prompt → captured run → checks → score, over multiple trials.**

## Layout

- `fixture/` — beenthere-lite, a real generated surface (place search, trip
  list, withheld trip creation) with the skill file installed at
  `.agents/skills/webmcp-tools/`. Every case starts from a fresh copy.
- `cases.json` — the prompt set. `core` cases gate; `negative` cases prove
  the skill doesn't leak into unrelated work; `control` cases are
  informational only.
- `run.mjs` — the harness and its deterministic graders.
- `results/` — timestamped JSON reports (gitignored).

## Running

You need an agent CLI on PATH (Codex, Claude Code, …). The command template
is `AGENT_CMD`, with `{PROMPT}` substituted and shell-quoted:

```sh
AGENT_CMD='codex exec --json "{PROMPT}"' node run.mjs
AGENT_CMD='claude -p "{PROMPT}" --output-format json' node run.mjs --trials 5
node run.mjs --case journey-document-trip     # one case
node run.mjs --selftest                       # grade the graders, no agent
```

Exit code is 0 only when every gated case passes every trial. Control cases
never gate.

## The sharpest case

`journey-document-trip`: the prompt asks for a flow around trip creation on
a *retrospective* (been-there) product. The right answer composes the
generated tools into `createJourney(...)`, names it like `document-trip`,
and gates creation behind the human. `plan-trip` / `book-trip` match a
forbidden pattern — that naming failure passes every mechanical lint yet is
semantically wrong, which is exactly the class of mistake the skill file
exists to prevent.

Its twin, `journey-without-skill`, runs the same prompt with the skill
directory deleted. It doesn't gate: it's the absorption detector. If it
starts passing reliably across models, the models internalized the practices
and the skill can retire.

## Deterministic checks, LLM judgment only via the agent under test

Graders look at files, not transcripts: expected files satisfying
include/exclude regexes, the generated region's marker preserved byte-for-byte,
description budgets measured, the tree unchanged on unrelated prompts. Adding
an LLM-as-judge pass is possible later — constrain it to a structured schema
(`overall_pass`, per-check results) so scores diff across runs — but the
fixtures were chosen so regex + structure carry the verdict.

## The operating loop

1. A real failure — from a user report, a docs change, a model regression —
  becomes a case here first.
2. Tune the skill until the case is at ~100% pass rate across trials.
3. The case joins the regression set permanently.
4. Run the suite on skill edits and on new flagship models; run the control
  case occasionally to detect absorption.

Results stay local under `results/` by design: this harness needs an agent
CLI and model access, so it runs on demand, not in CI.

## Refreshing the fixture

The fixture is committed generated output (see `fixture/README.md`). When
the generator's templates change, regenerate it so the eval baseline is what
users actually receive.
