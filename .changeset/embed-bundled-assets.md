---
"@webmcp-stack/codegen": patch
---

Embed the agent skill and the journey helper in the build instead of reading them from the package at runtime.

The hosted playground deployed without the package's `assets/` directory and failed at runtime with "bundled asset missing: journey.webmcp.ts". A `readFile` of the package's own files is invisible to bundlers and file tracers, so the assets were never part of the deployment. They are now embedded at build time, which removes the runtime read entirely, needs no per-host tracing configuration, and leaves `assets/` as the reviewed source of truth (a test asserts the embed stays byte for byte equal to it).
