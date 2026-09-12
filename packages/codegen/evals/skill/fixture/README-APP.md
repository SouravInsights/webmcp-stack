# beenthere-lite

A journal for trips you've been on. Document the places, write the story,
share the memory. (Not a planner: users come here *after* the trip.)

## Dev

The stack is a small web app with an API at the same origin (`/v1/...`) and
WebMCP tools under `src/webmcp/`, generated from `spec.json` with
webmcp-codegen. Tools register on page load via `registerAllTools()` from
`src/webmcp/index.ts`.

teh editor opens after a trip is created.
