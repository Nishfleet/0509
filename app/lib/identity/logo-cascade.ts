import { z } from "zod";

import type { Extracted } from "./extract";

interface LogoCandidate {
  url: string;
  via: string;
}

interface LogoHit {
  url: string;
  via: string;
  bytes: number;
  contentType: string;
}

interface LogoMiss {
  via: string;
  reason: string;
}

export interface LogoResolution {
  hit: LogoHit | null;
  misses: LogoMiss[];
}

const LogoHitSchema = z.object({
  url: z.string(),
  via: z.string(),
  bytes: z.number(),
  contentType: z.string(),
});
export const LogoResolutionSchema = z.object({
  hit: LogoHitSchema.nullable(),
  misses: z.array(z.object({ via: z.string(), reason: z.string() })),
});

export function logoCandidates(
  pageUrl: string,
  extracted: Extracted,
  manifestIcons: string[],
): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const push = (url: string | null | undefined, via: string) => {
    if (!url || !URL.canParse(url, pageUrl)) return;
    out.push({ url: new URL(url, pageUrl).toString(), via });
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

  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

export type ProbeFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export async function resolveLogo(
  candidates: LogoCandidate[],
  fetchFn: ProbeFetch,
  deadlineMs = 8_000,
): Promise<LogoResolution> {
  const misses: LogoMiss[] = [];
  for (const c of candidates) {
    try {
      const res = await fetchFn(c.url, { signal: AbortSignal.timeout(deadlineMs) });
      if (!res.ok) {
        misses.push({ via: c.via, reason: `http ${String(res.status)}` });
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        misses.push({ via: c.via, reason: `content-type ${contentType || "absent"}` });
        continue;
      }
      const body = await res.arrayBuffer();
      if (body.byteLength === 0) {
        misses.push({ via: c.via, reason: "empty body" });
        continue;
      }
      return { hit: { url: c.url, via: c.via, bytes: body.byteLength, contentType }, misses };
    } catch (err) {
      misses.push({ via: c.via, reason: err instanceof Error ? err.message : "fetch failed" });
    }
  }
  return { hit: null, misses };
}
