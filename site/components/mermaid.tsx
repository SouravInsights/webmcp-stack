// biome-ignore-all lint/security/noDangerouslySetInnerHtml: this component renders Mermaid's SVG from this repo's own diagram source, not from user input.
"use client";

import { useTheme } from "next-themes";
import { use, useEffect, useId, useState } from "react";

/**
 * Renders a Mermaid diagram on the client. `remarkMdxMermaid` turns a
 * ```mermaid code block in MDX into `<Mermaid chart="..." />`, so a diagram is
 * authored as text and stays reviewable in the raw markdown (which also flows
 * into llms-full.txt).
 *
 * This follows the Fumadocs recommended renderer. Mermaid is imported on
 * demand, so pages without a diagram never load it.
 */
export function Mermaid({ chart }: { chart: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return;
  return <MermaidContent chart={chart} />;
}

const cache = new Map<string, Promise<unknown>>();

function cachePromise<T>(key: string, setPromise: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached as Promise<T>;

  const promise = setPromise();
  cache.set(key, promise);
  return promise;
}

function MermaidContent({ chart }: { chart: string }) {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const { default: mermaid } = use(cachePromise("mermaid", () => import("mermaid")));

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    fontFamily: "inherit",
    themeCSS: "margin: 1.5rem auto 0;",
    theme: resolvedTheme === "dark" ? "dark" : "default",
  });

  const { svg, bindFunctions } = use(
    cachePromise(`${chart}-${resolvedTheme}`, () => {
      return mermaid.render(id, chart.replaceAll("\\n", "\n"));
    }),
  );

  return (
    <div
      ref={(container) => {
        if (container) bindFunctions?.(container);
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
