import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

const BASE = SITE_URL;

/**
 * Everything here is meant to be read, including by AI agents. The docs also
 * publish /llms.txt and /llms-full.txt for exactly that.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
