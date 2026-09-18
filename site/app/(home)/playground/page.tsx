import type { Metadata } from "next";
import { Playground } from "@/components/playground";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  title: "Playground",
  description:
    "Paste an OpenAPI spec and see the WebMCP tools it becomes: the real codegen pipeline, the real dashboard, running in your browser.",
};

/**
 * The hosted playground. Same product as `webmcp-codegen dev`, reachable
 * without installing anything, which is the whole point: the first run should
 * cost a visitor nothing.
 */
export default function PlaygroundPage() {
  return (
    <main className="dark flex min-h-dvh flex-col bg-baseline font-sans text-ink">
      <SiteNav product="codegen" />
      <Playground />
      <SiteFooter />
    </main>
  );
}
