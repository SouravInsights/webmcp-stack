/**
 * The hosted playground's one endpoint: an OpenAPI document goes in, the real
 * codegen pipeline runs over it, the tools come back as dashboard state.
 *
 * This is the same pipeline the CLI runs, in dry-run mode, against a scratch
 * directory: nothing is written anywhere, and what the page renders is what
 * `npx @webmcp-stack/codegen generate` would produce for that spec.
 *
 * Abuse posture matches the LLM route: a per-IP rate limit, a hard ceiling on
 * spec size, and no third-party fetch (the browser reads the spec, not us).
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGenerate } from "@webmcp-stack/codegen";
import { dashboardState } from "@webmcp-stack/codegen/dev";
import { tools } from "@webmcp-stack/codegen/outputs";
import { openapi } from "@webmcp-stack/codegen/sources";
import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";

/** The pipeline reads and writes files, so this route is Node-only. */
export const runtime = "nodejs";
/** A large spec parses for a few seconds; leave the function room for it. */
export const maxDuration = 60;

const MAX_SPEC_CHARS = 2_000_000;
const limiter = createRateLimiter({ windowMs: 60_000, max: 20 });

interface PlaygroundRequest {
  /** The OpenAPI document itself. The browser read it; we never fetch it. */
  spec?: string;
  /** What to call it in the sidebar, usually the file name. */
  label?: string;
}

export async function POST(request: Request) {
  if (limiter.limited(request)) {
    return NextResponse.json(
      { error: "The playground is rate limited for a moment. Try again in a minute." },
      { status: 429 },
    );
  }

  let body: PlaygroundRequest;
  try {
    body = (await request.json()) as PlaygroundRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const spec = body.spec;
  if (typeof spec !== "string" || spec.trim().length === 0) {
    return NextResponse.json(
      { error: "No spec: paste an OpenAPI document, upload a file, or point at a URL." },
      { status: 400 },
    );
  }
  if (spec.length > MAX_SPEC_CHARS) {
    return NextResponse.json(
      {
        error:
          "That spec is larger than 2 MB. Point the playground at an excerpt, " +
          "or run the CLI against the full document.",
      },
      { status: 413 },
    );
  }

  // A scratch directory, not the site tree. Sources resolve their spec through
  // a path and the tools output checks its outDir for files to preserve, so an
  // empty temp directory is what makes this run pristine.
  const scratch = await mkdtemp(join(tmpdir(), "webmcp-playground-"));
  try {
    const specPath = join(scratch, "spec.openapi.yaml");
    await writeFile(specPath, spec);

    const result = await runGenerate(
      {
        sources: [openapi({ spec: specPath })],
        outputs: [tools({ outDir: join(scratch, "src/webmcp") })],
      },
      {
        cwd: scratch,
        dryRun: true,
        // The playground is not a repo, so a blocked audit must not hide the
        // tools: it reports the errors and shows what generation would have
        // produced. In a repo those errors stop the write, and the page says so.
        force: true,
      },
    );

    return NextResponse.json({
      state: dashboardState(result, { label: body.label?.trim() || "spec", outDir: "src/webmcp" }),
      errors: result.findings.filter((finding) => finding.level === "error").length,
      warnings: result.findings.filter((finding) => finding.level === "warning").length,
    });
  } catch (error) {
    // A spec we cannot read is the visitor's to fix, so the pipeline's own
    // message goes back verbatim: it names the problem and what to do.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 422 },
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
