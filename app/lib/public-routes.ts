export const PUBLIC_PATHS = ["/", "/privacy"] as const;
export const DISALLOWED_PREFIXES = ["/app", "/api", "/mcp", "/u", "/login", "/onboarding", "/design"] as const;
export const CARD_ROUTE_PATH = "s/:slug";
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
