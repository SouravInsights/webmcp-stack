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

Your spec already knows your tools. One command writes them, wires them into your app, and gets out of the way. Part of [webmcp-stack](https://github.com/SouravInsights/webmcp-stack), the open-source developer stack for [WebMCP](https://github.com/webmachinelearning/webmcp).

## Quick start

Zero install, zero config:

```bash
npx @webmcp-stack/codegen generate
```

One run finds your OpenAPI spec (monorepos included), finds the package that is your web app, and:

- **generates working tools** in `src/webmcp/`: reads call your API out of the box, mutations are generated disabled (working code, one uncomment away)
- **filters what shouldn't be a tool**: webhooks skipped, auth and admin endpoints flagged and disabled
- **wires registration into your app** (two additive lines for Next.js and Vite, reported with undo instructions)

Preview first, write nothing:

```bash
npx @webmcp-stack/codegen generate --dry-run
```

Then start your app, open it in Chrome with `#enable-webmcp-testing`, and ask the agent to use one of your tools.

## No OpenAPI spec? Use your schemas

Most React/Next.js apps don't have one. If your app validates with schemas (zod, valibot, arktype), you can declare agent-facing actions straight from them, and a schema entry can also *refine* an OpenAPI operation (your contract and words, the endpoint's mechanics):

```js
// codegen.config.mjs
import { defineConfig } from "@webmcp-stack/codegen";
import { openapi, schema } from "@webmcp-stack/codegen/sources";
import { tools } from "@webmcp-stack/codegen/outputs";
import { CreateTripInput } from "./src/schemas";

export default defineConfig({
  sources: [
    openapi({ spec: "./openapi.yaml" }),
    schema({
      tools: [
        // operation fuses this with the spec's createTrip endpoint into one tool
        { name: "create-trip", schema: CreateTripInput, operation: "createTrip" },
      ],
    }),
  ],
  outputs: [tools({ outDir: "./src/webmcp" })],
});
```

Every field gets text an agent can act on: your `.describe()` words stay verbatim, constraints are rendered as plain language ("A number from 30 to 600."), and anything still silent gets a marked draft the audit reports on.

Working with a literal `<form>` instead? The `form` output annotates it in place with WebMCP's declarative attributes (`{ name: "add-to-timesheet", schema: Entry, form: "./src/TimesheetForm.tsx" }` plus `form` in `outputs`), so the agent fills the visible form and a human keeps the final click on writes.

## Safety is part of generation

This is not a dumb API -> WebMCP converter. Giving agents access to application actions is a new security surface, so the generator analyzes what every endpoint actually is: read-only, write, destructive, auth-boundary, or sensitive/PII-related. Every tool gets a safety classification and WebMCP hints, the audit pass runs inside `generate` (errors block, exit codes for CI), and higher-risk tools are generated disabled so you explicitly decide what agents can touch. The goal is that you stay in control of the agent-facing surface instead of blindly exposing every endpoint.

## The dashboard

```bash
npx @webmcp-stack/codegen dev
```

A local control panel for your WebMCP surface, the way Scalar is for APIs or Storybook is for components: browse your tools, inspect and edit metadata, toggle tools on and off, and run any tool directly to check it works. Edits save to `.webmcp-codegen.json` and survive regeneration. Nothing is added to your app.

## What a generated tool looks like

One file per endpoint, like `delete-pet.webmcp.ts`:

```ts
// --- webmcp-codegen: generated. Do not edit this region. ---
export const deletePetInputSchema = { /* derived from your spec */ };
export type DeletePetInput = { id: string };
export async function registerDeletePet(signal?: AbortSignal) {
  // Registers the tool; mutations ask the user to confirm, always.
}
// --- webmcp-codegen: end generated. Your code below survives regeneration. ---

export async function executeDeletePet(input: DeletePetInput) {
  // This tool starts disabled: it changes things. To enable it, delete the
  // line below and uncomment the code.
  return toolDisabled("delete-pet.webmcp.ts");

  // const data = await callApi(`/pets/${input.id}`, { method: "DELETE" });
  // return toolResult(data);
}
```

- **Real files in your repo**: readable, editable, no runtime dependency on this package
- **Working implementations**: path params, query strings, and JSON bodies built from the spec; session cookies included
- **Safety classification on every tool**: read/write/destructive, with WebMCP hints computed
- **An audit pass built into `generate`**: PII-in-response warnings, agent-instructing description linting, auth-boundary checks; errors block generation (exit codes for CI)
- **Regeneration never clobbers your code**: the contract regenerates above the marker, your code below it survives; hand-edited generated regions produce a `.new` file, never a silent overwrite

## CLI

| Command | What it does |
|---|---|
| `webmcp-codegen generate` | Generate/update tools, wire registration (audit runs by default) |
| `generate --dry-run` | Preview everything, write nothing |
| `generate --watch` | Re-generate when source files change |
| `generate --force` | Write files even when the audit reports errors |
| `generate --spec PATH` / `--out DIR` | Overrides without a config file |
| `webmcp-codegen dev` | Open the tools dashboard (`--port N` to change the port) |
| `webmcp-codegen init` | Write `codegen.config.mjs` for full control (needs the package installed) |

## Config

Structure lives in `codegen.config.mjs` (code); remembered choices and per-tool
overrides live in `.webmcp-codegen.json` (data, safe with npx, commit it).

```js
// codegen.config.mjs
import { defineConfig } from "@webmcp-stack/codegen";
import { openapi } from "@webmcp-stack/codegen/sources";
import { tools } from "@webmcp-stack/codegen/outputs";

export default defineConfig({
  sources: [openapi({ spec: "./openapi.yaml" })],
  outputs: [tools({ outDir: "./src/webmcp" })],
  safety: {
    piiFields: ["internalId"],  // extend the built-in PII heuristics
    exclude: ["internal"],      // skip tools by name or route substring
  },
  // llm: { apiKey: "..." },    // opt-in advisory layer: drafts and suggestions
                                // rendered as proposals, never applied, never blocking
});
```

## Requirements

- Node.js 20 or newer
- To *use* the generated tools in a browser: enable `chrome://flags/#enable-webmcp-testing` for local development (Chrome 149+, Edge 150+); production pages join the WebMCP origin trial - or use the WebMCP polyfill

## License

MIT
