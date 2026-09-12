import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";
import { source } from "@/lib/source";

const BASE = SITE_URL;

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages().map((page) => ({
    url: `${BASE}${page.url}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [{ url: BASE, changeFrequency: "monthly", priority: 1 }, ...pages];
}
