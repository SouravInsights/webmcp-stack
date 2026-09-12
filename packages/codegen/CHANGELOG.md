# webmcp-codegen

## 0.9.0

### Minor Changes

- 193a696: **Generate a small, intent-level surface, and teach your own coding agent the rules.**
  
  This release changes what `@webmcp-stack/codegen` thinks its job is. It still writes safe, typed tools from your OpenAPI spec. What is new is the shape of the surface: instead of a one-to-one mirror of your routes, you get a few intent-level tools, actions your API split across calls, and journeys for goals that take several steps.
  
  **Journeys: a real goal, not just an endpoint.** Some things a user asks for cannot be one tool call. Booking a ride is find the destination, set the pickup time, then confirm. A journey is a small file in `src/webmcp/journeys/` that composes the tools you already generated into one flow, with a shared draft and a single confirmed write:
  
  ```ts
  export const bookRide = createJourney({
    name: "book-ride",
    goal: "Book a ride to a destination the user gives",
    steps: {
      "resolve-destination": {
        tool: geocodeAddressTool,
        call: (input, signal) => fetchGeocodeAddress(input as never, signal),
        store: (place) => ({ destination: place }),
        provides: ["destination"],
      },
      "set-pickup-time": {
        description: "Set when the user wants to be picked up.",
        input: { type: "object", properties: { pickupAt: { type: "string" } }, required: ["pickupAt"] },
        provides: ["pickupAt"],
      },
    },
    submit: {
      description: "Request the ride and show the driver's details.",
      build: (draft) => draft as RequestRideInput,
      run: executeRequestRide,
    },
  });
  ```
  
  `generate` scaffolds the `journey.webmcp.ts` factory next to the runtime, the barrel registers every journey file it finds, and `verify` lints them. The submit gate and the confirmation live in a file the generator owns and rewrites, so a journey file cannot edit them out.
  
  **One tool for an action your API split in two.** When a begin/end pair like request-upload plus complete-upload is really one action, the generator merges them into a single withheld tool and threads the first response into the second by exact name. A pair it cannot thread is skipped with a note, never guessed.
  
  **A skill file for your coding agent.** Every run writes `.agents/skills/webmcp-tools/SKILL.md`, where Claude Code, AGENTS.md, and the generic standard already look. It teaches the naming rules, the description budgets, the execute contract, and the journey pattern, so your own agent extends the surface in the shape this tool expects. The repo also ships an eval harness that runs prompts against a fixture and grades the result, so a wording change can be measured instead of guessed at.
  
  **Your descriptions are never silently shortened.** Chrome's 500 and 150 character budgets are authoring guidance, not rules the browser enforces. Generation composes its own text to fit, keeps your text and your spec's text in full, and `verify` warns on an overrun instead of blocking. A description that reads well no longer gets cut down to pass a counter.
  
  **Current with the WebMCP spec.** Generated tools carry `title`, the human label native UIs show, destructive tools carry `consequentialHint`, and the `tools` output accepts `exposedTo` to scope which origins your tools are shared with.
  
  **The CLI no longer calls a model.** `--llm` and `--suggest` are removed, along with the provider flow and its config options. If you used them, the skill file is the replacement: it teaches your own coding agent the rules, and a plain `generate` never touches the network.
  
  **Docs.** The journeys guide is rewritten around a relatable example, with new guides for why this matters, what to do after you generate, working with your coding agent, a prompt cookbook, choosing between a tool, a group, and a journey, and testing your tools. The docs site publishes `/llms.txt` and `/llms-full.txt` for agents, and the CLI's docs links point at the new home, https://webmcp.souravinsights.com.

## 0.8.2

### Patch Changes

- f792070: - Field descriptions for conventional names now read as sentences ("tripId" becomes "The unique identifier of the trip.") instead of the name with a period, and fields nested inside optional wrapper objects get descriptions instead of shipping blank.
  - Dashboard: field descriptions are readable rows with per-row edit instead of a second copy of the test form, running a tool no longer sends description text as input values, the test form only appears for tools with an endpoint, and the header no longer repeats the route and status.

## 0.8.1

### Patch Changes

- 99b3e77: **Fixed: tools now call your real API, not localhost.** Generated tools baked the spec's `servers[0]` into every fetch — and that's usually a dev address like `http://localhost:3001`, so on a deployed site every tool call hit the visitor's own machine and failed. Now the codegen picks the first non-local server from your spec (e.g. `https://api.beenthere.page`), and when no public URL exists it falls back to same-origin (the deployed app's own API) instead of a dead localhost.

## 0.8.0

### Minor Changes

- 5146d90: **Two LLM flags, one job each, no file paths.** `generate --llm` improves the names and descriptions of the tools being generated (applied as marked drafts you review — your words always win). `generate --suggest` discovers schemas worth declaring, and now finds your schema modules itself instead of taking a path. Both share one key chooser: hosted tier, your own key, or skip — and CI always runs deterministic. Also fixed: TypeBox modules are now actually loaded (the loader only recognized the Standard Schema marker before), and Node's type-stripping warning no longer leaks into output.

## 0.7.1

### Patch Changes

- eb648f3: **`--suggest` no longer dead-ends without an API key.** In a real terminal, running `generate --suggest` with no key configured now offers three choices: use the free hosted tier (our proxy holds the key server-side, rate-limited, so trying the LLM layer takes zero setup), enter your own key for this run (masked input, OpenRouter/OpenAI/any OpenAI-compatible endpoint), or skip. In CI it still quietly runs deterministic — a prompt can never block a pipeline.

## 0.7.0

### Minor Changes

- a14dc9b: **Generated tools now meet the full authoring standard.** This release closes every measured quality gap in generated output and adds `verify`, a command that measures your tools locally before you ship.
  
  **Unreviewed tools no longer register.** Writes, destructive, auth, and admin tools are generated withheld: the working code is there, commented, but the tool is not registered, so agents never see or pick it. Enable a tool in the dashboard or by uncommenting its registration fence. Set `safety.registerDisabled: true` to keep the old visible-but-gated behavior. On a 72-endpoint spec this halves the surface agents choose from.
  
  **Better names.** POST on a member path names the association (`add-bucket-list-destination`, not `post-destination`). Batch endpoints put the verb first (`update-trip-blocks-batch`, not `batch-trip-blocks`). `signup` becomes `sign-up`. `GET /pricing/all` becomes `list-all-pricing`, not `get-all`. Collisions spend real context (`get-admin-pricing`) instead of numbering (`get-pricing-2`); a collision that truly cannot be resolved is a report error, never a silent suffix. Names stay within Chrome's 30-character guidance. Renames between runs are reported, and your dashboard edits follow the renamed tool automatically.
  
  **Descriptions say what a tool returns.** "List all trips for the authenticated user" becomes "List all trips for the authenticated user. Returns an array of trips." Title Case spec labels become sentences ("Get My Unlocked Stamps" becomes "Get my unlocked stamps."). Nested input fields (array items, object properties) get the same synthesized descriptions top-level fields already did.
  
  **Annotations see through unions.** A nullable string (`anyOf: [string, null]`, how validators spell optional text) now correctly marks a tool's output as potentially user-written content.
  
  **Generated tools carry the co-browsing pattern.** Each endpoint tool's `execute()` ends with a marked spot to update the UI, so the human watching the page sees what the agent did. New docs page: "Make the effect visible."
  
  **New command: `verify`.** Runs the pipeline without writing and reports a scorecard: name shape, description coverage, field text, annotations, surface size. Exits 1 on error-level findings so CI can gate on it. `verify --url <deployed-url>` also checks the page serves an origin trial token, because "generated" and "live in a visitor's browser" are different facts.
  
  **Fixed:** the CLI now applies dashboard edits (`.webmcp-codegen.json` overrides) on every `generate` run; previously only the dashboard itself read them, so a CLI regeneration silently dropped your edits. Tool files are matched to tools by endpoint identity, not filename: a rename between runs carries your `execute()` to the new filename instead of a different tool inheriting it, files whose endpoints are gone are reported as orphans, and nothing is ever deleted silently. The registration wiring recreates a missing `register.tsx` instead of trusting a stale layout that mounts it.

## 0.6.1

### Patch Changes

- c8ad050: Absolute paths now win over the project directory. The `tools` output's `outDir` and the `--config` existence check used `path.join(cwd, path)`, which nests an absolute path under the project (`--out /tmp/out` became `<project>/tmp/out`). They now resolve correctly.
- c8ad050: Generated files now import only the runtime helpers they actually use. Disabled tools (which keep their request commented out) no longer import `callApi`/`toolResult`, and standalone schema tools no longer import `callApi`, so generated output passes strict `no-unused-vars` lint configs — including Next.js production builds, which treat those warnings as errors. The disabled-tool scaffold comment now names the imports to add back when enabling the call by hand.

## 0.6.0

### Minor Changes

- ea1f941: Generated tools now carry the full WebMCP authoring contract:
  
  - **Annotations in every tool definition.** `readOnlyHint` comes from the safety classification; `untrustedContentHint` is set when a tool's output can contain user-written text (free-text fields with no enum or format). Agents use these to decide how careful to be.
  - **Failures return readable results instead of throwing.** A rejected `execute` reaches the agent as a bare `UnknownError` with the message discarded; generated wrappers now convert failures into error results the agent can read and retry from. Cancellation (`AbortError`) still throws, as it should.
  - **The execute context's `signal` reaches fetch**, so a cancelled tool call actually stops the request.
  - **Registration skips quietly when the browser has no WebMCP.** One quiet log line per page load instead of a thrown error per tool; the human-facing page never notices.
  - The CLI now exits with `process.exitCode` instead of `process.exit()`, so no log line can be truncated at the end of a run.

## 0.5.0

### Minor Changes

- 133a715: **Breaking:** In `codegen.config.mjs`, `generate:` is now `outputs:`, `js()` is now `tools()`, and imports come from `@webmcp-stack/codegen/outputs` (not `/generators`). An old config fails with the exact fix printed.
  
  **What's new:**
  
  - **Tool names now read as intent, not routing.** Specs without `operationId`s used to produce names like `post-trips-trip-id-story-generate`. Now the same route produces `generate-story`: the generator recognizes action endpoints and plain REST, drops version prefixes and path params, understands `me` and lookup keys (`GET /trips/{username}/{slug}` → `get-trip-by-slug`), and resolves collisions by adding parent context, with every rename shown in the report.
  
  - **No OpenAPI spec? Use your validation schemas.** If your app validates with zod, valibot, arktype, or TypeBox, you can declare agent-facing actions directly from those schemas:
  
    ```js
    import { schema } from "@webmcp-stack/codegen/sources";
    import { CreateTripInput } from "./src/schemas";
  
    export default defineConfig({
      sources: [
        schema({ tools: [{ name: "create-trip", schema: CreateTripInput }] })
      ],
    });
    ```
  
  - **Override an OpenAPI tool with your own schema.** If you have a zod schema that's better than what the OpenAPI spec describes, declare it with `operation: "createTrip"` and the tool uses your schema instead:
  
    ```js
    schema({
      tools: [
        {
          name: "create-trip",
          schema: CreateTripInput,  // your zod schema with .describe() text
          operation: "createTrip",  // the OpenAPI operation this replaces
        },
      ],
    })
    ```
  
    The tool gets your descriptions and constraints, but still calls the right endpoint.
  
  - **Field descriptions are now useful.** Your `.describe()` text stays as-is. Constraints like `min(30)` become "A number from 30 to 600." Fields with no description get a draft the audit flags, so you know what to fix.
  
  - **Working with a real `<form>`?** The new `form` output annotates it with WebMCP's attributes instead of generating a file. The agent fills the form; a human clicks submit on writes.
  
  - **The audit catches mistakes.** If you reference an OpenAPI operation that doesn't exist, that's an error. If a field needs another tool you didn't declare, that's a warning. If a read has no output schema, that's a warning. If all a tool's descriptions are machine-generated, that's a warning.
  
  - **Optional LLM help.** Add `llm: { apiKey: "..." }` to your config and the CLI can draft descriptions and suggest which schemas might work well as tools. It prints proposals (marked `◦`), never writes them, and works without a key (just skipped).
  
  - **`generate --suggest ./src/schemas.ts`** asks the LLM which schemas in that file might be worth turning into tools. It proposes; you decide.
  
  - **The CLI explains itself.** Verbose mode shows each step ("Reading sources", "Found 73 candidates", "Disabled 2 auth endpoints"). Tables replace walls of text. Colors auto-disable in CI logs.
  
  - **`init` detects your setup.** Finds zod/valibot/arktype/TypeBox in `package.json` and scaffolds accordingly. No OpenAPI spec? It starts you with schemas instead of a placeholder.
  
  Your generated files and `.webmcp-codegen.json` keep working unchanged.

## 0.4.0

### Minor Changes

- cf2f1d4: The dev dashboard now shows each tool's generated source. Every tool's detail
  pane has a "view source" disclosure that opens the real `<name>.webmcp.ts`
  file in place — the same progressive disclosure the site's demo has, wired to
  the live pipeline output.
- f403059: Rename the package to `@webmcp-stack/codegen`, published under the webmcp-stack npm org. Same CLI, same features; the unscoped `webmcp-codegen` package is deprecated. The zero-install command is now `npx @webmcp-stack/codegen generate`. Also points the error-report URL at the renamed repo.

## 0.3.4

### Patch Changes

- Fix dashboard UI issues

## 0.3.3

### Patch Changes

- Human-readable CLI output

## 0.3.2

### Patch Changes

- Redesigned CLI output and dashboard UI

## 0.3.1

### Patch Changes

- Fix: use spec's servers URL for API calls

## 0.3.0

### Minor Changes

- Generate now emits working tools (reads call your API immediately, mutations start disabled), auto-wires registration into Next.js and Vite apps, and detects your web app in monorepos. Adds the dev command: a local dashboard to review, describe, toggle, and try tools.

## 0.2.1

### Patch Changes

- 12aa13e: Cleaner voice everywhere: em dashes and middle-dot separators removed from CLI messages, audit findings, generated-file headers, and the merge markers themselves. The CLI report now shows plain risk labels (read/write/destructive). Note: the marker text changed, so files generated by 0.1.x/0.2.x won't be recognized as marked regions on the next regeneration. Delete the generated directory once and regenerate; your execute() implementations are below the marker and unaffected by this if you regenerate before implementing.

## 0.2.0

### Minor Changes

- 447c12f: Zero-config `generate`: auto-detects OpenAPI/Swagger specs anywhere in the project (monorepo layouts included), so `npx webmcp-codegen generate` now works with no install and no config file. Adds `--spec` and `--out` flags as config-free overrides; `init` remains the path to full control via codegen.config.mjs.

## 0.1.0

### Minor Changes

- First release: OpenAPI source, safety audit, js generator, init/generate CLI
