import { sourcePillStatus, type SourcePillStatus, type SourceRow, type SourceSnapshot } from "../components/source-pill";
import { registeredToolDescriptors } from "./agent/mcp-tools";
import { PLANS, TRIAL_TERMS } from "./billing/plans";
import { LIVE_COVERAGE, PLAN_NOTE, WATCHED_NOUNS } from "./coverage";
import { FAQ } from "./faq";
import { SITE_URL } from "./structured-data";

export interface LlmsTxtSource {
  source: SourceRow;
  snapshot: SourceSnapshot | null;
}

export const PUBLIC_PATHS = ["/privacy", "/terms"] as const;
export const SITEMAP_PATHS = ["/privacy", "/terms", "/llms.txt"] as const;
export const DISALLOWED_PREFIXES = ["/app", "/api", "/mcp", "/u", "/login", "/onboarding", "/oauth", "/design"] as const;
export const MCP_URL = `${SITE_URL}/mcp`;

const PAGE_SUMMARIES: Record<(typeof PUBLIC_PATHS)[number], { title: string; summary: string }> = {
  "/privacy": {
    title: "Privacy",
    summary: "what we collect, who helps run 0509, how long we keep it, and how any brand or creator can be removed",
  },
  "/terms": {
    title: "Terms",
    summary: "who can use 0509, fair use, agent access, plans and cancelling, and how either side can end the agreement",
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

export function llmsTxt(origin: string, sources: readonly LlmsTxtSource[], now: number = Date.now()): string {
  const prices = PLANS.map((plan) => `${plan.name} €${String(plan.monthlyPriceEur)}/month`).join(", ");
  return (
    [
      "# Five to Nine",
      "",
      `> Five to Nine (0509.io) is a competitor tracker for founders, brands and creators. It finds your competitors for you, watches their ${WATCHED_NOUNS} from public sources, ranks you against them every week, and emails one brief every Monday with a screenshot behind every change.`,
      "",
      `- Plans: ${prices}. ${TRIAL_TERMS}`,
      `- Agents: every plan includes a read-only API and an MCP server at ${MCP_URL}.`,
      "",
      ...llmsWatchesBlock(sources, now),
      "",
      ...FAQ.flatMap((entry) => [`**${entry.question}** ${entry.answer}`, ""]),
      "## Agents",
      "",
      `- [MCP server](${MCP_URL}): add it as a connector in Claude, ChatGPT or Cursor and sign in; read-only, limited to your own workspace`,
      ...Object.entries(registeredToolDescriptors).map(([name, tool]) => `- ${name}: ${tool.title}`),
      `- [API reference](${origin}/api/v1/openapi.json): OpenAPI 3.1 for the read-only REST API; send an API key from Settings as a Bearer token`,
      "",
      "## Pages",
      "",
      ...PUBLIC_PATHS.map((path) => `- [${PAGE_SUMMARIES[path].title}](${origin}${path}): ${PAGE_SUMMARIES[path].summary}`),
    ].join("\n") + "\n"
  );
}

function llmsWatchStatus(
  source: { sourceKey?: string },
  ctx: { readonly byKey: ReadonlyMap<string, LlmsTxtSource>; readonly now: number },
): SourcePillStatus {
  const key = source.sourceKey;
  if (key === undefined) {
    return { state: "live", reason: null, lastGoodAt: null };
  }
  const row = ctx.byKey.get(key);
  if (row === undefined) {
    return { state: "disabled", reason: null, lastGoodAt: null };
  }
  return sourcePillStatus(row.source, row.snapshot, ctx.now);
}

function llmsWatchQualifier(status: SourcePillStatus): string {
  if (status.state !== "degraded") return "";
  if (status.lastGoodAt === null && status.reason === "no fresh data") {
    return " (no data yet)";
  }
  if (status.reason === null) {
    return " (degraded — not answering today)";
  }
  return ` (degraded: ${status.reason} — not answering today)`;
}

function llmsWatchLine(
  group: { readonly kind: string },
  source: { label: string; sourceKey?: string; plan?: "starter" | "agency" },
  ctx: { readonly byKey: ReadonlyMap<string, LlmsTxtSource>; readonly now: number },
): { text: string; degraded: boolean } | null {
  const status = llmsWatchStatus(source, ctx);
  if (status.state === "disabled") return null;
  const plan = source.plan === undefined ? "" : ` (${PLAN_NOTE[source.plan]})`;
  return {
    text: `- ${group.kind}: ${source.label}${plan}${llmsWatchQualifier(status)}`,
    degraded: status.state === "degraded",
  };
}

function llmsWatchesBlock(sources: readonly LlmsTxtSource[], now: number): readonly string[] {
  const byKey = new Map<string, LlmsTxtSource>();
  for (const entry of sources) {
    byKey.set(entry.source.key, entry);
  }
  const ctx = { byKey, now };
  const lines: string[] = [];
  let degraded = false;
  for (const group of LIVE_COVERAGE) {
    for (const source of group.sources) {
      const line = llmsWatchLine(group, source, ctx);
      if (line === null) continue;
      if (line.degraded) degraded = true;
      lines.push(line.text);
    }
  }
  if (!degraded) {
    return ["What it watches today:", "", ...lines];
  }
  return [
    "What it watches today:",
    "",
    "Some sources are not answering today; those lines say so.",
    "",
    ...lines,
  ];
}
