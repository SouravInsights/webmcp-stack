---
"@webmcp-stack/codegen": patch
---

- Field descriptions for conventional names now read as sentences ("tripId" becomes "The unique identifier of the trip.") instead of the name with a period, and fields nested inside optional wrapper objects get descriptions instead of shipping blank.
- Dashboard: field descriptions are readable rows with per-row edit instead of a second copy of the test form, running a tool no longer sends description text as input values, the test form only appears for tools with an endpoint, and the header no longer repeats the route and status.
