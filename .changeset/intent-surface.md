---
"@webmcp-stack/codegen": minor
---

**The intent surface: journeys, handshake grouping, budgets, and an agent skill.**

`generate` now scaffolds a skill file at `.agents/skills/webmcp-tools/SKILL.md`
so your own coding agent learns the naming rules, description budgets, the
execute contract, and the journey pattern. It also emits `title` and
`consequentialHint` from the current WebMCP spec, and accepts an `exposedTo`
config pass-through.

Handshake endpoints that are one action split across two calls (a
request-upload plus a complete-upload) are detected and merged into one
withheld tool, thread-wiring the first response into the second by exact name.
Fuzzy pairs are skipped with a note.

Journeys are the new multi-step primitive. `journey.webmcp.ts` is scaffolded
next to the runtime and regenerated every run; `journeys/*.webmcp.ts` files
import `createJourney` from it, the barrel registers them, and `verify` lints
them (submit gate present, step count, no direct `fetch`). `verify` also counts
journey tools in the surface total now.

The built-in LLM layer is removed: `--llm`, `--suggest`, the provider flow, and
the config options. Rules reach models through the skill file; the CLI never
calls a model.

**Budgets follow the tool's judgment better.** Chrome's 500/150 character
budgets are authoring guidance, not browser rules (the spec only rejects an
empty description or a name outside 1-128 chars). So generation no longer
silently shortens text a person or a spec wrote: machine-drafted text is
composed to fit, author text is kept in full, and `verify` reports an overrun
as a warning instead of a blocking error. The string trimmer also no longer
returns one character over budget on an unbroken token.

**Fixes:** the generated `runtime.webmcp.ts` shipped with a string literal
broken across two lines, so it did not parse; it is valid again. Journey steps
no longer claim to be read-only when the tool they compose is a write, and
journeys resolve the WebMCP API at registration time so a late-installed
polyfill still registers them.
