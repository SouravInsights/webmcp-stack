/**
 * The canonical production origin. One place to change it: page metadata, the
 * sitemap, robots.txt, and the llms.txt feeds all read from here.
 *
 * Set NEXT_PUBLIC_SITE_URL to override it (previews, a custom domain move).
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://webmcp.souravinsights.com";
