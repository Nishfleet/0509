export const PUBLIC_PATHS = ["/", "/privacy"] as const;
export const DISALLOWED_PREFIXES = ["/app", "/api", "/mcp", "/login", "/onboarding", "/design"] as const;
export const CARD_ROUTE_PATH = "s/:slug";
export function sitemapXml(origin: string, paths: readonly string[]): string {
  const rows = paths.map((path) => {
    const loc = `${origin}${path}`
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    return `  <url><loc>${loc}</loc></url>\n`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("")}</urlset>\n`;
}

export function robotsTxt(origin: string): string {
  return (
    [
      "User-agent: *",
      "Allow: /",
      ...DISALLOWED_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
      "",
      `Sitemap: ${origin}/sitemap.xml`,
    ].join("\n") + "\n"
  );
}
