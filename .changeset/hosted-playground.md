---
"@webmcp-stack/codegen": minor
---

Add a `dev` subpath with the dashboard's shared pieces, and let the dashboard run on a host other than the dev server.

- `dashboardState(run, { label, outDir, overrides })` shapes a pipeline run for the dashboard UI. The dev server now uses it instead of its own private copy.
- `buildToolRequest(route, input, baseUrl)` builds the HTTP request a tool makes, shared by the dev server's run-it test and the browser. It now keeps a spec server's base path (`https://api.example.com/v1`), matching what the generated `callApi(...)` does.
- `dashboardHtml(state, { scoped, mode })` takes `mode: "playground"` for hosts where edits stay in the tab and test calls leave from the browser. The default, `"dev"`, is unchanged.
