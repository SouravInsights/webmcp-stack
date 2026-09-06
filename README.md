<div align="center">
  <a href="https://webmcp-stack.vercel.app">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./brand/logo-mark.svg">
      <source media="(prefers-color-scheme: light)" srcset="./brand/logo-mark-light.svg">
      <img alt="webmcp-stack" src="./brand/logo-mark.svg" width="88" height="88">
    </picture>
  </a>
  <h1>webmcp-stack</h1>
  <p><strong>The open-source developer stack for WebMCP.</strong></p>
  <p>Today: codegen. The goal is the whole agent-surface lifecycle in one stack: Generate, Understand, Review, Test, Control, Observe, Secure.</p>
  <p>
    <a href="https://www.npmjs.com/package/@webmcp-stack/codegen"><img alt="npm version" src="https://img.shields.io/npm/v/@webmcp-stack/codegen?style=flat-square&labelColor=0a0b0f&color=58a6ff"></a>
    <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  </p>
  <p>
    <a href="https://webmcp-stack.vercel.app/docs">Docs</a> |
    <a href="https://www.npmjs.com/package/@webmcp-stack/codegen">npm</a> |
    <a href="https://webmcp-stack.vercel.app/brand">Brand</a> |
    <a href="./docs/about.md">About</a>
  </p>
</div>

---

[WebMCP](https://github.com/webmachinelearning/webmcp) lets a website expose typed tools that AI agents can call in the browser, with the signed-in user's session and no server or build step. What you expose to agents matters: the caller is a model acting as your user, possibly while reading attacker-influenced page content. webmcp-stack is the tooling for it: generate the surface from the API contract you already have, review it, and keep it honest in CI.

## Today: codegen

**[@webmcp-stack/codegen](./packages/codegen)** turns an OpenAPI spec, or your zod/valibot/arktype/TypeBox schemas, into WebMCP tools in your own codebase:

```bash
npx @webmcp-stack/codegen generate
```

No install, no config for the first run. It detects your app, writes one `.webmcp.ts` file per tool, and adds the registration call to your entry file (additive edits, always reported; if it can't find the entry point, it prints the two lines for you to paste).

```bash
npx @webmcp-stack/codegen dev      # local dashboard: browse, edit, toggle, and test tools
npx @webmcp-stack/codegen verify   # check the tool set against the standard; exits 1 on errors
```

## Why not just ask an LLM to write these?

You can, and it works. What you get back is different every time, and nothing checks it. Each tool needs the same small decisions made correctly: read or write, registered or hidden, user confirmation or not, trustworthy output or not. Across 40 endpoints that is hundreds of decisions, easy to forget and tedious to apply by hand. The generator makes each one once, from rules, and applies it to every tool on every run, so you review a diff and gate it in CI. It also knows the spec trivia: a rejected `execute` reaches the agent as a bare `UnknownError` with your message discarded, so generated tools return readable errors instead of throwing.

## What it does

- **Decides what agents may do.** Every endpoint is classified read, write, or destructive from the HTTP verb, corrected when the name disagrees (`POST /orders/{id}/cancel` is destructive, `POST /search` is a read). Reads work immediately. Everything else is generated but not registered, so enabling a write is a deliberate edit. Webhooks are skipped, auth and admin endpoints are flagged, and anything it cannot classify starts disabled.
- **Asks the user before any mutation.** Write and destructive tools confirm each call with the user (a plain dialog you can replace). The confirmation lives in the generated region of the file, so it cannot be edited away and survive regeneration.
- **Writes the text agents read.** Constraints become sentences ("A number from 30 to 600."), names come from intent (`generate-story`, not `post-trips-trip-id-story-generate`), and every description says what the tool returns. Your own text always wins; machine-written text is marked and flagged in the audit.
- **Says what can be trusted.** Free-text outputs get `untrustedContentHint`; PII-looking fields are named in the report and in a comment in the file; mutating tools on authenticated endpoints carry a session warning; `execute` calls your real endpoint, so your own validation still runs.
- **Annotates real forms.** A tool that maps to a visible `<form>` can annotate it in place, so the agent fills the same controls the user sees, and the user reviews and submits the write.

## What a generated tool looks like

A real tool from a real app: `create-trip`, one of 70+ tools generated for [beenthere.page](https://beenthere.page) from its OpenAPI spec, shortened for the README:

```ts
// --- webmcp-codegen: generated. Do not edit this region. ---
/**
 * Create a new trip. Returns the trip.
 * Source: POST /v1/trips/ (openapi). Risk: write-confirm.
 * Starts withheld: not registered until you enable it.
 */
export const createTripTool = {
  name: "create-trip",
  description: "Create a new trip. Returns the trip.",
  inputSchema: createTripInputSchema,  // title, dates, location, theme, field notes
  annotations: { readOnlyHint: false, untrustedContentHint: true },
};

// A write tool, so it is withheld: the registration is generated but commented
// out, including the built-in user confirmation, until you enable it:
//   const confirmed = await requestUserConfirmation(
//     "Allow the agent to: Create a new trip. Returns the trip.",
//   );
// --- webmcp-codegen: end generated. Your code below survives regeneration. ---

export async function executeCreateTrip(input: CreateTripInput, signal?: AbortSignal) {
  return toolDisabled("create-trip.webmcp.ts");
  // Uncomment to go live:
  // const data = await callApi("https://api.beenthere.page/v1/trips/", { method: "POST", ... });
  // return toolResult(data);
}
```

The bar the ecosystem is converging on (Chrome's WebMCP best-practices and tool-security docs, plus the writeups around them), and where the generator stands against it:

| The bar | Today |
|---|---|
| Verb-first, intent-shaped names, 30 characters or fewer | Enforced on every run |
| Descriptions say what the tool does and when, positively, within 500 characters; every parameter described within 150 | Assembled on every run; length budgets measured by `verify` next |
| Outputs within 1.5K characters; errors that help recovery; user-written content marked `untrustedContentHint` | Errors and annotations enforced; output budget next |
| Exposure as a decision: `readOnlyHint`, registration only where usable, `exposedTo` origin scoping | Annotations and withheld-by-default enforced; `exposedTo` lands as the runtime stabilizes |
| The human in the loop: visible page effects, confirmation on consequential actions | Confirmation enforced, in the generated region where it can't be edited away; visible-effect hook scaffolded |
| No steering: descriptions never instruct the agent or encode flow control | Flagged in the audit |
| The schema is not the security boundary; the app still validates at run time | Stated in the output; `execute` calls your real endpoint |

`verify` measures this locally and exits 1 on errors, so the bar is a CI gate, not a hope.

## Changing things later

- **`.webmcp-codegen.json`**: per-tool overrides for descriptions, names, enabled state, fields. Applied last, so your text always wins.
- **Dashboard** (`dev`): edit descriptions, toggle tools, run tools against real endpoints. Writes back to the overrides file.
- **Audit**: problems reported in plain language every run: missing descriptions, mislabeled verbs, PII in outputs, agent-instruction smells, oversized surfaces. Errors block file writing; warnings do not.
- **`verify`**: the standard, checked locally. Built for CI.
- **LLM help if you want it**: `--suggest` proposes tools worth declaring, `--llm` drafts descriptions. Advisory only: it never classifies risk, never changes exit codes, and a plain `generate` never makes a network call.

## Where this is going

Codegen first:

- **More sources.** OpenAPI and validation schemas today, tRPC on the list. The rule holds: contracts, not codebases, and the CLI never scans app code.
- **Journeys.** One tool per CRUD operation is rarely the right shape; agents do better with a few coarse, intent-level tools. Declare a flow once (draft store, step tools, a submit gate), run it in the dashboard, review the generated Mermaid diagram.
- **The dashboard becomes the review surface.** LLM suggestions arrive as an accept/reject queue that writes to the overrides file. In progress now.
- **Evals for the LLM layer.** A prompt change becomes a visible regression, not a vibe.

Then the stack around it: **audit** (point it at a URL, get a report on the surface a visiting agent would find) and **telemetry** (how agents actually use your tools). The goal is one stack where each tool covers one stage of the lifecycle and they compound. The bet underneath: websites are growing an agent-facing surface the way they grew APIs, and that surface needs the same kind of tooling, with higher stakes, because the caller is a model acting as your user, inside your page.

The guarantees hold through all of it: the repo pins the WebMCP draft it targets and watches for spec drift; your overrides, execute bodies, and review decisions survive every regeneration; breaking changes print the exact fix. Deterministic where possible, LLM where useful, honest always.

## Principles

- **The generated code belongs to you.** Real files in your repo, no runtime dependency. Regeneration rewrites only the contract region of each file; your `execute` body is written once and then it's yours. Inspect it, modify it, delete the generator, keep the files.
- **Safety first.** An agent-facing surface is a security surface. The tools help you decide what to expose, then enforce the decision.
- **Open-source first.** Everything here is genuinely useful on its own and self-hostable. Any future cloud offering adds convenience, never a gate.

<details>
<summary><strong>Repository layout</strong></summary>

| Path | npm name | What it is |
|---|---|---|
| `packages/codegen` | `@webmcp-stack/codegen` | The CLI and the generation pipeline: sources (OpenAPI, validation schemas), outputs, the safety audit, the dev dashboard. |
| `examples/openapi-petstore` | private | Example app with tools generated from the Petstore OpenAPI spec. |
| `site/` | private | Landing page and documentation (Next.js + Fumadocs). |
| `docs/` | - | Design specs (`specs/`), decision notes (`notes/`), and [what this project is](./docs/about.md). |
| `scripts/` | - | Committed git hooks (lint on commit, lint + typecheck + test before push). |
| `brand/` | - | Logo and brand assets. |

</details>

<details>
<summary><strong>Development</strong></summary>

```bash
pnpm install
pnpm build        # turbo run build
pnpm test         # turbo run test
pnpm typecheck
pnpm lint:fix
```

```bash
pnpm --filter openapi-petstore dev   # example app
pnpm --filter site dev               # landing page & docs on :3001
```

</details>

## License

MIT
