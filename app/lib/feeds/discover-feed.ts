export const COMMON_FEED_PATHS: readonly string[] = [
  "/feed",
  "/rss.xml",
  "/atom.xml",
  "/blog/feed",
  "/changelog.xml",
  "/changelog/rss.xml",
  "/changelog/feed.xml",
  "/blog/rss.xml",
  "/feed.xml",
  "/atom",
];

export const MAX_FEED_CANDIDATES = 12;

const FEED_TYPES: ReadonlySet<string> = new Set(["application/rss+xml", "application/atom+xml"]);

const MAX_DECLARED_FEEDS = 64;

function httpsHref(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || !URL.canParse(trimmed, base)) return null;
  const url = new URL(trimmed, base);
  url.hash = "";
  return url.protocol === "https:" ? url.href : null;
}

const ATTRIBUTE_REFERENCES: ReadonlyMap<string, string> = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
]);

function decodeAttribute(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (reference) => ATTRIBUTE_REFERENCES.get(reference) ?? reference);
}

interface DeclaredFeeds {
  found: string[];
}

function pushDeclared(state: DeclaredFeeds, href: string, base: string): void {
  if (state.found.length >= MAX_DECLARED_FEEDS) return;
  const resolved = httpsHref(decodeAttribute(href), base);
  if (resolved !== null) state.found.push(resolved);
}

function alternateLinkHandler(state: DeclaredFeeds, base: string): HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      const type = element.getAttribute("type");
      const href = element.getAttribute("href");
      if (type === null || href === null) return;
      if (!FEED_TYPES.has(type.trim().toLowerCase())) return;
      pushDeclared(state, href, base);
    },
  };
}

export async function feedLinksFromHtml(html: string, base: string): Promise<string[]> {
  const state: DeclaredFeeds = { found: [] };
  const rewritten = new HTMLRewriter()
    .on('link[rel~="alternate"][type]', alternateLinkHandler(state, base))
    .transform(new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } }));
  await rewritten.arrayBuffer();
  return state.found;
}

export async function feedCandidates(html: string | null, homepage: string): Promise<string[]> {
  const declared = html === null ? [] : await feedLinksFromHtml(html, homepage);
  const common = COMMON_FEED_PATHS.flatMap((path) => httpsHref(path, homepage) ?? []);
  return [...new Set([...declared, ...common])].slice(0, MAX_FEED_CANDIDATES);
}
