import { parse } from "tldts";
import { z } from "zod";

export const Extracted = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  socials: z.array(z.string()),
  ldOrganization: z.record(z.string(), z.unknown()).nullable(),
  navLinks: z.array(z.object({ href: z.string(), text: z.string() })),
  iconLinks: z.array(z.object({ href: z.string(), rel: z.string(), sizes: z.string().nullable() })),
  manifestHref: z.string().nullable(),
  adLibraryHints: z.array(z.object({ platform: z.string(), id: z.string(), via: z.string() })),
  title: z.string().nullable(),
  text: z.string(),
});
export type Extracted = z.infer<typeof Extracted>;

const SOCIAL_HOSTS = [
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "linkedin.com",
  "threads.net",
];

const TEXT_LIMIT = 4000;
const LINK_LIMIT = 50;

function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function findOrganization(documents: unknown[]): Record<string, unknown> | null {
  for (const doc of documents) {
    for (const node of asArray(doc && typeof doc === "object" && "@graph" in doc ? (doc as { "@graph": unknown[] })["@graph"] : doc)) {
      if (
        node &&
        typeof node === "object" &&
        (node as Record<string, unknown>)["@type"] === "Organization"
      ) {
        return node as Record<string, unknown>;
      }
    }
  }
  return null;
}

function stripTagline(title: string): string {
  const cut = title.split(/\s[|–—-]\s/)[0]?.trim();
  return cut && cut.length >= 2 ? cut : title.trim();
}

export async function extract(html: string, pageUrl: string): Promise<Extracted> {
  const meta = new Map<string, string>();
  const iconLinks: { href: string; rel: string; sizes: string | null }[] = [];
  const anchors: { href: string; text: string }[] = [];
  const ldBlocks: string[] = [];
  const adLibraryHints: { platform: string; id: string; via: string }[] = [];
  const textParts: string[] = [];
  let title: string | null = null;
  let manifestHref: string | null = null;

  let currentAnchor: { href: string; text: string } | null = null;
  let ldBuf = "";
  let inTitle = false;
  let titleBuf = "";

  const rewriter = new HTMLRewriter()
    .on("title", {
      element() {
        inTitle = true;
        titleBuf = "";
      },
      text(chunk) {
        if (inTitle) {
          titleBuf += chunk.text;
          if (chunk.lastInTextNode) {
            title = titleBuf.trim() || null;
            inTitle = false;
          }
        }
      },
    })
    .on("meta", {
      element(el) {
        const key = el.getAttribute("property") ?? el.getAttribute("name");
        const content = el.getAttribute("content");
        if (!key || content === null) return;
        const k = key.toLowerCase();
        if (k.startsWith("og:") || k.startsWith("twitter:") || k === "description" || k.startsWith("fb:")) {
          meta.set(k, content);
        }
        if (k === "fb:app_id") adLibraryHints.push({ platform: "meta", id: content, via: "fb:app_id" });
        if (k === "fb:pages") adLibraryHints.push({ platform: "meta", id: content, via: "fb:pages" });
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") ?? "").toLowerCase();
        const href = el.getAttribute("href");
        if (!href) return;
        if (rel === "manifest") {
          manifestHref = new URL(href, pageUrl).toString();
        } else if (/\b(icon|apple-touch-icon|apple-touch-icon-precomposed|shortcut icon)\b/.test(rel)) {
          iconLinks.push({
            href: new URL(href, pageUrl).toString(),
            rel,
            sizes: el.getAttribute("sizes"),
          });
        }
      },
    })
    .on('script[type="application/ld+json"]', {
      text(chunk) {
        ldBuf += chunk.text;
        if (chunk.lastInTextNode) {
          ldBlocks.push(ldBuf);
          ldBuf = "";
        }
      },
    })
    .on("a[href]", {
      element(el) {
        const href = el.getAttribute("href");
        if (href && anchors.length < LINK_LIMIT) {
          currentAnchor = { href, text: "" };
          anchors.push(currentAnchor);
        }
      },
      text(chunk) {
        if (currentAnchor) {
          currentAnchor.text += chunk.text;
          if (chunk.lastInTextNode) {
            currentAnchor.text = currentAnchor.text.trim();
            currentAnchor = null;
          }
        }
      },
    })
    .on("body", {
      text(chunk) {
        if (textParts.join(" ").length < TEXT_LIMIT) textParts.push(chunk.text);
      },
    });

  await rewriter.transform(new Response(html)).text();

  const ldDocs: unknown[] = [];
  for (const raw of ldBlocks) {
    const doc = tryJson(raw);
    if (doc !== null) ldDocs.push(doc);
  }
  const ldOrg = findOrganization(ldDocs);
  const ldSameAs = asArray(ldOrg?.sameAs as string | string[] | undefined).filter(
    (s): s is string => typeof s === "string",
  );
  const ldLogo = ldOrg?.logo;
  const ldLogoUrl =
    typeof ldLogo === "string"
      ? ldLogo
      : ldLogo && typeof ldLogo === "object"
        ? ((ldLogo as Record<string, unknown>).url as string | undefined) ?? null
        : null;

  const socials = new Set<string>(ldSameAs);
  const navLinks: { href: string; text: string }[] = [];
  const pageHost = new URL(pageUrl).hostname;
  for (const a of anchors) {
    let resolved: URL;
    try {
      resolved = new URL(a.href, pageUrl);
    } catch {
      continue;
    }
    if (SOCIAL_HOSTS.some((h) => parse(resolved.hostname).domain === h)) {
      socials.add(resolved.toString());
      continue;
    }
    if (resolved.hostname === pageHost || resolved.hostname.endsWith(`.${pageHost}`)) {
      navLinks.push({ href: resolved.toString(), text: a.text });
    }
  }

  const gtm = /GTM-[A-Z0-9]{4,}/.exec(html);
  if (gtm) adLibraryHints.push({ platform: "google", id: gtm[0], via: "gtm" });
  const gaId = /G-[A-Z0-9]{6,}/.exec(html);
  if (gaId) adLibraryHints.push({ platform: "google", id: gaId[0], via: "ga4" });

  const name =
    (typeof ldOrg?.name === "string" ? ldOrg.name : null) ??
    meta.get("og:site_name") ??
    (title ? stripTagline(title) : null);
  const description =
    meta.get("og:description") ?? meta.get("description") ?? meta.get("twitter:description") ?? null;

  return Extracted.parse({
    name,
    description,
    logoUrl: ldLogoUrl ?? meta.get("og:image") ?? null,
    socials: [...socials],
    ldOrganization: ldOrg,
    navLinks,
    iconLinks,
    manifestHref,
    adLibraryHints,
    title,
    text: textParts.join(" ").replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT),
  });
}
