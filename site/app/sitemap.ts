import type { MetadataRoute } from "next";
import { source } from "@/lib/source";

const BASE = "https://webmcp-stack.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages().map((page) => ({
    url: `${BASE}${page.url}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [{ url: BASE, changeFrequency: "monthly", priority: 1 }, ...pages];
}
