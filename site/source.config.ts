import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    // ```mermaid blocks become <Mermaid chart="..." />; see components/mermaid.tsx.
    remarkPlugins: [remarkMdxMermaid],
    rehypePlugins: [],
  },
});
