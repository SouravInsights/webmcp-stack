import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Generated at build time, so it is a static file on the deployed site. */
export const dynamic = "force-static";

/**
 * Every docs page as raw markdown, in the order the navigation uses, for an
 * agent that would rather read the whole thing in one request than crawl.
 * Frontmatter is stripped; the page bodies already start with their headings.
 */
export async function GET() {
  const dir = join(process.cwd(), "content/docs");
  const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as {
    pages: string[];
  };

  const parts: string[] = [
    "# webmcp-stack docs (full text)",
    "",
    "> The complete documentation for @webmcp-stack/codegen, concatenated for a single read.",
    "",
  ];

  for (const slug of meta.pages) {
    const raw = await readFile(join(dir, `${slug}.mdx`), "utf8");
    const body = raw
      .replace(/^---[\s\S]*?---\s*/, "")
      // Fumadocs code annotations are presentation only; a reader of the raw
      // markdown should not see "// [!code highlight]".
      .replace(/ ?\/\/ ?\[!code[^\]]*\]/g, "")
      .trim();
    parts.push(body, "", "---", "");
  }

  return new Response(parts.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
