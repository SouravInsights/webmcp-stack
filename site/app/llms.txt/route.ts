import { SITE_URL } from "@/lib/site-url";
import { source } from "@/lib/source";

/** Generated at build time, so it is a static file on the deployed site. */
export const dynamic = "force-static";

const BASE = SITE_URL;

/**
 * The llms.txt index: a short, curated map of the docs for an agent to read
 * before fetching anything. Format follows the llms.txt convention.
 */
export function GET() {
  const pages = source.getPages().sort((a, b) => a.url.localeCompare(b.url));
  const lines = [
    "# webmcp-stack",
    "",
    "> Generate safe, reviewable WebMCP tools from the API contract you already have, so AI agents can act on a site in the signed-in user's session.",
    "",
    "## Docs",
    "",
    ...pages.map((page) =>
      `- [${page.data.title}](${BASE}${page.url}): ${page.data.description ?? ""}`.trim(),
    ),
    "",
    "## Full text",
    "",
    `- [llms-full.txt](${BASE}/llms-full.txt): every docs page concatenated for a single read.`,
    "",
    "## Optional",
    "",
    "- [GitHub](https://github.com/SouravInsights/webmcp-stack)",
    "- [npm](https://www.npmjs.com/package/@webmcp-stack/codegen)",
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
