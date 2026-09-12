---
"@webmcp-stack/codegen": minor
---

**Generate a small, intent-level surface, and teach your own coding agent the rules.**

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