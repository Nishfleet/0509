export interface PageNames {
  ogSiteName: string | null;
  ldOrganizationName: string | null;
}

interface PageNamesState {
  ogSiteName: string | null;
  scripts: string[];
  buffer: string;
}

interface LdNode {
  "@type"?: unknown;
  "@graph"?: unknown;
  name?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenNodes(value: unknown): LdNode[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  if (Array.isArray(value["@graph"])) {
    return value["@graph"].filter(isRecord);
  }
  return [value];
}

function isOrganization(node: LdNode): boolean {
  const type = node["@type"];
  if (type === "Organization") return true;
  return Array.isArray(type) && type.includes("Organization");
}

function organizationName(scripts: string[]): string | null {
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script);
    } catch (error) {
      console.error(JSON.stringify({ event: "discovery.page_names_json_parse_failed", error: String(error) }));
      continue;
    }
    for (const node of flattenNodes(parsed)) {
      if (!isOrganization(node)) continue;
      if (typeof node.name !== "string") continue;
      const trimmed = node.name.trim();
      if (trimmed.length === 0) continue;
      return trimmed;
    }
  }
  return null;
}

export async function readPageNames(html: string): Promise<PageNames> {
  const state: PageNamesState = { ogSiteName: null, scripts: [], buffer: "" };

  const rewritten = new HTMLRewriter()
    .on('meta[property="og:site_name"]', {
      element(el) {
        if (state.ogSiteName !== null) return;
        const content = el.getAttribute("content")?.trim() ?? "";
        state.ogSiteName = content.length > 0 ? content : null;
      },
    })
    .on('script[type="application/ld+json"]', {
      text(chunk) {
        state.buffer += chunk.text;
        if (!chunk.lastInTextNode) return;
        state.scripts.push(state.buffer);
        state.buffer = "";
      },
    })
    .transform(new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } }));

  await rewritten.arrayBuffer();

  return {
    ogSiteName: state.ogSiteName,
    ldOrganizationName: organizationName(state.scripts),
  };
}
