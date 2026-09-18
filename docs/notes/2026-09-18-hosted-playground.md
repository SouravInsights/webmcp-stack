# The hosted playground (2026-09-18)

The dev dashboard (`webmcp-codegen dev`) was reachable only by installing and running a
command. This note records the decision to put the same product on the site as
`/playground`, so a visitor can see what their spec becomes without a checkout.

## The shape

Spec in, tools out, in the browser:

1. The visitor pastes an OpenAPI document, uploads a file, or points at a URL.
2. `POST /api/playground` writes the spec to a temp directory, runs `runGenerate` with
   the real `openapi` and `tools` outputs, and returns dashboard state. Dry run, `force:
   true`, so audit errors are reported instead of hiding the tools.
3. The page mounts `dashboardHtml(state, { mode: "playground" })` in a shadow root and
   answers the dashboard's three requests in the page itself.

## Decisions and why

**The browser reads the spec, not our server.** A demo that fetched any URL a visitor
typed would be an open proxy into the network the site runs in. Client-side fetch keeps
the blast radius at CORS, which is a limit we can explain in one sentence.

**Tool calls leave from the browser.** Same reason, plus a better story: the call uses the
visitor's own session and network, and we never see the traffic. The cost is that an API
without CORS cannot be called from the playground. The page shows the exact request and
says which of the two failures happened.

**One UI, two hosts.** `dashboardHtml` grew a `mode: "dev" | "playground"` option for the
five lines whose meaning depends on where the dashboard runs (edits saved or not, calls
server-side or browser-side). Everything else is identical, so the playground cannot
drift into a lookalike.

**One state mapping, one request planner.** `toUiTool` and the request building moved out
of `dev/server.ts` into `dev/state.ts` and `dev/request.ts`, exported together from the new
`@webmcp-stack/codegen/dev` subpath. Both hosts import them. This is also what surfaced a
real bug: the dashboard's run-it resolved `/pets/{id}` against the spec's server with
`new URL(path, base)`, which drops a base path like `/api/v3`. The generated `callApi(...)`
concatenates and keeps it. The planner now concatenates too, so the test call and the
shipped tool hit the same URL.

**Edits in the playground stay in the tab.** The dashboard's override endpoint is answered
in-page. Each editor's hint says so in playground mode, and the page repeats it below the
frame. No fake persistence, no account, no storage.

## Not done, on purpose

- No server-side spec fetching, even behind an allowlist. It adds an SSRF surface for a
  convenience the paste box already covers.
- No saved sessions or shareable playground links. Both need storage, which is the thing
  the page promises not to have.
- No `/playground` entry in `sitemap.ts`. It is a tool, not a page to rank; the docs page
  and the nav link are the way in. Revisit if it earns organic traffic.
