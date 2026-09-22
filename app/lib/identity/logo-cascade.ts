// Identity card engine P2 (#3885): the zero-spend logo cascade
// (REBUILD-STACK.md §5.5). Order: manifest icons[] -> apple-touch-icon ->
// <link rel="icon"> -> Google faviconV2 sz=256 -> DuckDuckGo ip3 ->
// /favicon.ico -> og:image last.
//
// Two live-probed traps honoured here: always GET, never HEAD (stripe.com
// answers HEAD content-length:0 and GET 15,086 bytes), and check res.ok
// (Google/DuckDuckGo return 404 with a placeholder image body).

import type { Extracted } from "./extract";

export interface LogoCandidate {
  url: string;
  via: string;
}

export interface LogoHit {
  url: string;
  via: string;
  bytes: number;
  contentType: string;
}

export function logoCandidates(
  pageUrl: string,
  extracted: Extracted,
  manifestIcons: string[],
): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const push = (url: string | null | undefined, via: string) => {
    if (!url) return;
    try {
      out.push({ url: new URL(url, pageUrl).toString(), via });
    } catch {
      // a bad href is skipped, never fatal
    }
  };

  for (const icon of manifestIcons) push(icon, "manifest");
  for (const l of extracted.iconLinks) {
    if (l.rel.includes("apple-touch-icon")) push(l.href, "apple-touch-icon");
  }
  for (const l of extracted.iconLinks) {
    if (l.rel === "icon" || l.rel === "shortcut icon" || l.rel === "icon shortcut") {
      push(l.href, "icon");
    }
  }
  const host = new URL(pageUrl).hostname;
  push(`https://www.google.com/s2/favicons?domain=${host}&sz=256`, "google-faviconV2");
  push(`https://icons.duckduckgo.com/ip3/${host}.ico`, "duckduckgo-ip3");
  push(`https://${host}/favicon.ico`, "favicon-ico");
  push(extracted.logoUrl, "ld-or-og");

  // De-dupe preserving order.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

export async function resolveLogo(
  candidates: LogoCandidate[],
  fetchFn: typeof fetch = fetch,
  deadlineMs = 8_000,
): Promise<LogoHit | null> {
  for (const c of candidates) {
    try {
      const res = await fetchFn(c.url, {
        method: "GET",
        signal: AbortSignal.timeout(deadlineMs),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) continue;
      const body = await res.arrayBuffer();
      if (body.byteLength === 0) continue;
      return { url: c.url, via: c.via, bytes: body.byteLength, contentType };
    } catch {
      continue;
    }
  }
  return null;
}
