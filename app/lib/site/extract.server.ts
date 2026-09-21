/**
 * Rendered HTML -> the structured page record. HTMLRewriter only: it is the
 * stack-named primitive (docs/REBUILD-STACK.md §5.1) and the html-to-text
 * library was rejected there on size. Text chunks are not text nodes — each
 * collector concatenates until lastInTextNode, which is the documented
 * contract.
 *
 * The extracted record is what a diff sees. `links` is the discovery feed;
 * `prices`, `headings`, `ctas` are the structured fields the packet asks for.
 */
export interface ExtractedPage {
  title: string;
  description: string;
  headings: string[];
  prices: string[];
  ctas: { text: string; href: string | null }[];
  links: { href: string; text: string }[];
  text: string;
}

const PRICE_PATTERN = /[$€£₹]\s?\d[\d,.]*/g;
const SKIP_BLOCKS = /<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export async function extractPage(html: string): Promise<ExtractedPage> {
  const cleaned = html.replace(SKIP_BLOCKS, " ");
  let title = "";
  let description = "";
  let bodyText = "";
  const headings: string[] = [];
  const prices: string[] = [];
  const ctas: { text: string; href: string | null }[] = [];
  const links: { href: string; text: string }[] = [];

  let headingBuf = "";
  let linkBuf = "";
  let linkHref: string | null = null;
  let priceBuf = "";
  let ctaBuf = "";
  let ctaHref: string | null = null;

  const flushHeading = () => {
    const v = norm(headingBuf);
    if (v && headings.length < 20) headings.push(v);
    headingBuf = "";
  };
  const flushLink = () => {
    const v = norm(linkBuf);
    if (linkHref && links.length < 300)
      links.push({ href: linkHref, text: v });
    linkBuf = "";
    linkHref = null;
  };
  const flushPrice = () => {
    const v = norm(priceBuf);
    if (v && prices.length < 30) prices.push(v);
    priceBuf = "";
  };
  const flushCta = () => {
    const v = norm(ctaBuf);
    if (v && ctas.length < 30) ctas.push({ text: v, href: ctaHref });
    ctaBuf = "";
    ctaHref = null;
  };

  await new HTMLRewriter()
    .on("title", {
      text(node: Text) {
        title += node.text;
      },
    })
    .on("meta[name='description']", {
      element(el: Element) {
        description = el.getAttribute("content") ?? "";
      },
    })
    .on("h1, h2", {
      text(node: Text) {
        if (node.lastInTextNode) {
          headingBuf += node.text;
          flushHeading();
        } else {
          headingBuf += node.text;
        }
      },
    })
    .on("a", {
      element(el: Element) {
        linkHref = el.getAttribute("href");
        if (/btn|button|cta/i.test(el.getAttribute("class") ?? ""))
          ctaHref = linkHref;
      },
      text(node: Text) {
        linkBuf += node.text;
        if (ctaHref !== null && ctaHref === linkHref) ctaBuf += node.text;
        if (node.lastInTextNode) {
          flushLink();
          if (ctaHref !== null) flushCta();
        }
      },
    })
    .on("button", {
      text(node: Text) {
        ctaBuf += node.text;
        if (node.lastInTextNode) {
          const v = norm(ctaBuf);
          if (v && ctas.length < 30) ctas.push({ text: v, href: null });
          ctaBuf = "";
          ctaHref = null;
        }
      },
    })
    .on("[class*='price'], [id*='price'], [data-price]", {
      text(node: Text) {
        priceBuf += node.text;
        if (node.lastInTextNode) flushPrice();
      },
    })
    .on("body", {
      text(node: Text) {
        bodyText += node.text;
      },
    })
    .transform(new Response(cleaned))
    .text();

  for (const m of bodyText.matchAll(PRICE_PATTERN)) {
    if (prices.length >= 30) break;
    if (!prices.includes(m[0])) prices.push(m[0]);
  }

  return {
    title: norm(title),
    description: norm(description),
    headings,
    prices,
    ctas,
    links,
    text: norm(bodyText),
  };
}

export function canonicalPageText(page: ExtractedPage): string {
  return norm(
    [
      page.title,
      page.description,
      ...page.headings,
      ...page.prices,
      ...page.ctas.map((c) => c.text),
      page.text,
    ].join("\n"),
  );
}

export function sameOriginLinks(
  page: ExtractedPage,
  pageUrl: string,
): string[] {
  const origin = new URL(pageUrl).origin;
  const seen = new Set<string>();
  for (const { href } of page.links) {
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (!/^https?:$/.test(url.protocol)) continue;
    if (/\.(pdf|png|jpe?g|gif|webp|svg|zip|mp4|webm|ico|xml|json)$/i.test(url.pathname))
      continue;
    url.hash = "";
    url.search = "";
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || path.split("/").filter(Boolean).length > 2) continue;
    seen.add(`${url.origin}${path}`);
    if (seen.size >= 8) break;
  }
  return [...seen];
}
