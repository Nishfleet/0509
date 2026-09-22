import {
  adapterResultSchema,
  fetchUpstream,
  type MentionItem,
  type MentionTarget,
  UpstreamStatus,
} from "./types";

const PLUGIN_KEY = "ddg.html";

interface RewriterElement {
  getAttribute(name: string): string | null;
}

interface HtmlRewriterInstance {
  on(
    selector: string,
    handlers: {
      element?: (element: RewriterElement) => void;
      text?: (text: { text: string }) => void;
    },
  ): HtmlRewriterInstance;
  transform(response: Response): Response;
}

function htmlRewriter(): HtmlRewriterInstance | null {
  const ctor = (globalThis as { HTMLRewriter?: new () => HtmlRewriterInstance }).HTMLRewriter;
  return ctor ? new ctor() : null;
}

function realUrl(href: string): string | null {
  try {
    const url = new URL(href, "https://html.duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg?.startsWith("http")) return uddg;
    if (href.startsWith("http") && !url.hostname.endsWith("duckduckgo.com")) return href;
  } catch {
    return null;
  }
  return null;
}

export async function parseDdg(html: string): Promise<MentionItem[]> {
  const rewriter = htmlRewriter();
  if (!rewriter) return [];
  const found: { href: string; title: string }[] = [];
  let current: { href: string; title: string } | null = null;
  rewriter.on("a.result__a", {
    element(element) {
      const href = element.getAttribute("href");
      current = href ? { href, title: "" } : null;
      if (current) found.push(current);
    },
    text(text) {
      if (current) current.title += text.text;
    },
  });
  await rewriter.transform(new Response(html)).text();
  const items: MentionItem[] = [];
  for (const row of found) {
    const canonicalUrl = realUrl(row.href);
    if (!canonicalUrl) continue;
    items.push({
      dedupKey: canonicalUrl,
      title: row.title.trim(),
      bodyExcerpt: "",
      canonicalUrl,
      publishedAt: null,
      author: null,
      publisher: null,
      engagement: {},
    });
  }
  return items;
}

export async function pollDdg(target: MentionTarget, _cursor: string | null) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", `"${target.query}"`);
  const { status, body } = await fetchUpstream(url.toString());
  if (status !== 200) throw new UpstreamStatus(PLUGIN_KEY, status);
  const items = await parseDdg(body);
  return adapterResultSchema.parse({ items, canaryCount: items.length, rawBody: body, status });
}
