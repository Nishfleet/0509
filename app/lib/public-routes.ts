import { PLANS, TRIAL_TERMS } from "./billing/plans";
import { SITE_URL } from "./structured-data";

export const PUBLIC_PATHS = ["/privacy"] as const;
export const DISALLOWED_PREFIXES = ["/app", "/api", "/mcp", "/u", "/login", "/onboarding", "/oauth", "/design"] as const;
export const MCP_URL = `${SITE_URL}/mcp`;

const PAGE_SUMMARIES: Record<(typeof PUBLIC_PATHS)[number], { title: string; summary: string }> = {
  "/privacy": {
    title: "Privacy",
    summary: "what we collect, how long we keep it, and how any brand or person can be removed",
  },
};

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

export function llmsTxt(origin: string): string {
  const prices = PLANS.map((plan) => `${plan.name} €${String(plan.monthlyPriceEur)}/month`).join(", ");
  return (
    [
      "# Five to Nine",
      "",
      "> Five to Nine (0509.io) tracks your competitors for you. It watches their ads, website changes, mentions and hiring from public sources, ranks you against them every week, and emails one brief every Monday with a screenshot behind every change.",
      "",
      `- Plans: ${prices}. ${TRIAL_TERMS}`,
      `- Agents: every plan includes a read-only API and an MCP server at ${MCP_URL}.`,
      "",
      "## Agents",
      "",
      `- [MCP server](${MCP_URL}): add it as a connector in Claude, ChatGPT or Cursor and sign in; read-only tools get_brief, list_competitors and list_alerts, limited to your own workspace`,
      `- [API reference](${origin}/api/v1/openapi.json): OpenAPI 3.1 for the read-only REST API; send an API key from Settings as a Bearer token`,
      "",
      "## Pages",
      "",
      ...PUBLIC_PATHS.map((path) => `- [${PAGE_SUMMARIES[path].title}](${origin}${path}): ${PAGE_SUMMARIES[path].summary}`),
    ].join("\n") + "\n"
  );
}
