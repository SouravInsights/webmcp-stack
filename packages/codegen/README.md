<div align="center">
  <a href="https://webmcp.souravinsights.com">
    <img alt="webmcp-stack" src="https://raw.githubusercontent.com/SouravInsights/webmcp-stack/main/brand/logo-mark-tile.svg" width="72" height="72">
  </a>
  <h1>@webmcp-stack/codegen</h1>
  <p><strong>Generate safe, typed, human-reviewed WebMCP tools from the API contract you already have.</strong></p>
  <p>
    <a href="https://www.npmjs.com/package/@webmcp-stack/codegen"><img alt="npm version" src="https://img.shields.io/npm/v/@webmcp-stack/codegen?style=flat-square&labelColor=0a0b0f&color=58a6ff"></a>
    <a href="https://github.com/SouravInsights/webmcp-stack/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square&labelColor=0a0b0f&color=58a6ff"></a>
  </p>
  <p>
    <a href="https://webmcp.souravinsights.com/docs">Docs</a> |
    <a href="https://github.com/SouravInsights/webmcp-stack">GitHub</a> |
    <a href="https://github.com/SouravInsights/webmcp-stack/issues">Issues</a>
  </p>
</div>

---

Hand-writing a WebMCP tool for every action is a chore, and the descriptions drift from the API they describe. If you already maintain an OpenAPI spec or validation schemas, you already have the source of truth.

`@webmcp-stack/codegen` turns that source into WebMCP tools as real TypeScript files in your repo. It writes the safe defaults, withholds anything risky until you enable it, scaffolds a skill file so your own coding agent knows the rules, and ships a `verify` command you can gate in CI.

Part of [webmcp-stack](https://github.com/SouravInsights/webmcp-stack), the open-source developer stack for [WebMCP](https://github.com/webmachinelearning/webmcp).

## Quick start

No install, no config for the first run:

```bash
npx @webmcp-stack/codegen generate
```

One run finds your OpenAPI spec (monorepos included), finds the package that is your web app, and:

- writes one `.webmcp.ts` file per endpoint
- gives read tools working implementations that call your API with the signed-in user's session
- **withholds** writes and destructive tools: the working code is generated, but the tool is not registered until you enable it
- skips webhooks, flags auth and admin endpoints
- wires registration into your app with two additive lines
- scaffolds a skill file for your coding agent, and a journey factory if you want one

Preview everything without writing:

```bash
npx @webmcp-stack/codegen generate --dry-run
```

Measure the surface before you ship, and gate it in CI:

```bash
npx @webmcp-stack/codegen verify
```

Browse and test the tools locally:

```bash
npx @webmcp-stack/codegen dev
```

Then open your app in Chrome with `chrome://flags/#enable-webmcp-testing` enabled, and let an agent use a tool. Other browsers work with the [WebMCP polyfill](https://github.com/webmachinelearning/webmcp-polyfill).

## What you get

**A small, intent-level surface.** Not every endpoint should be a tool. Reads register so you can see the surface; writes and destructive tools stay withheld until you turn them on one at a time.

**Handshake grouping.** When a begin/end pair (request an upload, then complete it) is really one action split across two calls, the generator merges them into a single withheld tool and threads the first response into the second by exact name. A pair it cannot thread is skipped with a note, never guessed.

**Journeys.** For a goal that takes several calls and ends in one confirmed write, you write a small file in `src/webmcp/journeys/` and the generator scaffolds the rest: a shared draft, one tool per step, and a submit gate a human confirms. See [Journeys](https://webmcp.souravinsights.com/docs/journeys).

**A skill file for your coding agent.** Every run writes `.agents/skills/webmcp-tools/SKILL.md`, where Claude Code, AGENTS.md, and the generic standard already look. Your agent follows the same naming, description, and safety rules the generator uses.

**Safety as part of generation.** Every endpoint is classified read, write, or destructive, corrected when the name disagrees. The audit runs inside `generate`: it names PII in outputs, descriptions that try to instruct the agent, and auth or admin endpoints. Errors block generation and set an exit code for CI; warnings report and continue.

**Descriptions you can trust.** Constraints become sentences ("A number from 30 to 600."), every description says what the tool returns, and free-text outputs are marked as untrusted. Your own text is kept in full. Chrome's 500 and 150 character budgets are treated as guidance, so `verify` warns on an overrun instead of shortening your words to pass a counter.

**Regeneration that never clobbers your code.** The API contract lives above a marker line and regenerates freely; your `execute()` body lives below it and is never touched. Hand-edited generated regions produce a `.new` file to merge, never a silent overwrite.

## Where this fits

This tool generates from a contract, not from a scan of your codebase. That is a deliberate choice, not a hidden limitation:

- **It needs a source you maintain.** An OpenAPI spec, or the validation schemas your app already uses (zod, valibot, arktype, TypeBox). If neither exists yet, there is nothing good to generate from, and writing that source is the work to do first.
- **The source has to be good.** A tool's description is part of the prompt a model reasons over. A vague or stale contract produces vague or stale tools; what an agent can do is bounded by what your contract actually says.
- **One thing done well.** A generator that claims to work on any codebase, by guessing intent from source code, tends to work well nowhere. This one asks for a contract and rewards you for keeping it current.

If you have an OpenAPI spec or maintained schemas, you are exactly who this is for. If you do not, the `schema` source lets you declare tools from schemas you write by hand in the meantime.

## A generated tool

One file per endpoint, like `create-trip.webmcp.ts`:

```ts
// --- webmcp-codegen: generated. Do not edit this region. ---
export const createTripTool = {
  name: "create-trip",
  title: "Create Trip",
  description: "Create a new trip. Returns the trip.",
  inputSchema: createTripInputSchema,
  annotations: {
    readOnlyHint: false,
    untrustedContentHint: true,
    consequentialHint: false,
  },
};

// Journeys and your own code compose this raw caller; executeCreateTrip wraps it.
export async function fetchCreateTrip(input: CreateTripInput, signal?: AbortSignal) {
  const data = await callApi("/v1/trips", { method: "POST", body: { ... }, signal });
  return data;
}

// Withheld, so the registration is generated but commented out, confirmation included:
//   const confirmed = await requestUserConfirmation("Allow the agent to: Create a new trip...");
// --- webmcp-codegen: end generated. Your code below survives regeneration. ---
```

## CLI

| Command | What it does |
|---|---|
| `webmcp-codegen generate` | Generate and update tools, wire registration (the audit runs by default) |
| `generate --dry-run` | Preview everything, write nothing |
| `generate --watch` | Re-generate when source files change |
| `generate --force` | Write files even when the audit reports errors |
| `generate --spec PATH` / `--out DIR` | Overrides without a config file |
| `webmcp-codegen verify` | Score the surface against the standard; exits 1 on errors |
| `verify --url URL` | Also check a deployed page serves an origin trial token |
| `webmcp-codegen dev` | Open the tools dashboard (`--port N` to change the port) |
| `webmcp-codegen init` | Write `codegen.config.mjs` for full control (needs the package installed) |

## Config

Structure lives in `codegen.config.mjs` (code). Remembered choices and per-tool
overrides live in `.webmcp-codegen.json` (data, safe with npx, meant to be committed).

```js
// codegen.config.mjs
import { defineConfig } from "@webmcp-stack/codegen";
import { openapi } from "@webmcp-stack/codegen/sources";
import { tools } from "@webmcp-stack/codegen/outputs";

export default defineConfig({
  sources: [openapi({ spec: "./openapi.yaml" })],
  outputs: [tools({ outDir: "./src/webmcp" })],
  safety: {
    piiFields: ["internalId"], // extend the built-in PII heuristics
    exclude: ["internal"],     // skip tools by name or route substring
  },
});
```

No OpenAPI spec? Declare tools from the schemas you already use, and a schema
entry can also refine an endpoint from your spec:

```js
// import { schema } from "@webmcp-stack/codegen/sources";
// import { CreateTripInput } from "./src/schemas";

sources: [
  openapi({ spec: "./openapi.yaml" }),
  schema({
    tools: [{ name: "create-trip", schema: CreateTripInput, operation: "createTrip" }],
  }),
],
```

Annotating a literal `<form>` instead? The `form` output wires WebMCP's
declarative attributes onto it, so an agent fills the controls a person can see.

## Requirements

- Node.js 20 or newer
- To *use* the generated tools in a browser: enable `chrome://flags/#enable-webmcp-testing` for local development (Chrome 149+, Edge 150+). Production pages join the WebMCP origin trial, or use the polyfill.

## License

MIT
