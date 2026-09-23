import { z } from "zod";

export const socialSchema = z.object({
  platform: z.string().min(1),
  url: z.url(),
  handle: z.string().min(1),
});

export const navLinkSchema = z.object({
  href: z.string().min(1),
  text: z.string(),
});

export const adLibraryHintSchema = z.object({
  source: z.string().min(1),
  value: z.string().min(1),
});

export const ldOrganizationSchema = z.object({
  name: z.string().optional(),
  url: z.string().optional(),
  logo: z.string().optional(),
  sameAs: z.array(z.string()).default([]),
});

export const extractedSiteSchema = z.object({
  url: z.string(),
  ogSiteName: z.string().optional(),
  ogTitle: z.string().optional(),
  ogDescription: z.string().optional(),
  ogImage: z.string().optional(),
  title: z.string().optional(),
  ldOrganization: ldOrganizationSchema.optional(),
  icons: z.array(z.string()).default([]),
  appleTouchIcons: z.array(z.string()).default([]),
  manifestUrl: z.string().nullable().default(null),
  socials: z.array(socialSchema).default([]),
  navLinks: z.array(navLinkSchema).default([]),
  adLibraryHints: z.array(adLibraryHintSchema).default([]),
  text: z.string(),
});

export type Social = z.infer<typeof socialSchema>;
export type NavLink = z.infer<typeof navLinkSchema>;
export type AdLibraryHint = z.infer<typeof adLibraryHintSchema>;
export type LdOrganization = z.infer<typeof ldOrganizationSchema>;
export type ExtractedSite = z.infer<typeof extractedSiteSchema>;

const IS_APPLE_TOUCH_REL = /(^|\s)apple-touch-icon(\s|$)/i;
const IS_ICON_REL = /(^|\s)(?:shortcut\s+)?icon(\s|$)/i;
const IS_MANIFEST_REL = /(^|\s)manifest(\s|$)/i;

export const SUBDOMAIN_PATTERN = /^(?:www|m|mobile)\./;

const SKIP_SELECTOR = "script, style, noscript, [aria-hidden='true']";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const SOCIAL_HOSTS: Record<string, string> = {
  "instagram.com": "instagram.com",
  "tiktok.com": "tiktok.com",
  "youtube.com": "youtube.com",
  "twitter.com": "twitter.com",
  "x.com": "twitter.com",
  "facebook.com": "facebook.com",
  "fb.com": "facebook.com",
  "linkedin.com": "linkedin.com",
  "pinterest.com": "pinterest.com",
  "pinterest.co.uk": "pinterest.com",
  "discord.gg": "discord.gg",
  "discord.com": "discord.gg",
  "reddit.com": "reddit.com",
  "threads.net": "threads.net",
  "twitch.tv": "twitch.tv",
  "github.com": "github.com",
  "medium.com": "medium.com",
  "snapchat.com": "snapchat.com",
  "vk.com": "vk.com",
  "weibo.com": "weibo.com",
};

const AD_LIBRARY_URLS: [needle: string, source: string][] = [
  ["facebook.com/ads/library", "meta"],
  ["ads.tiktok.com", "tiktok"],
  ["tiktok.com/business/creativecenter", "tiktok"],
  ["adstransparency.google.com", "google"],
  ["linkedin.com/ad-library", "linkedin"],
  ["snapchat.com/ads", "snapchat"],
  ["pinterest.com/business", "pinterest"],
];

const AD_LIBRARY_ATTRS: [attr: string, source: string][] = [
  ["data-advertiser-id", "meta"],
  ["data-facebook-page-id", "meta"],
  ["data-tiktok-advertiser-id", "tiktok"],
  ["data-google-advertiser-id", "google"],
];

const HANDLE_PATH_PREFIXES = new Set([
  "user",
  "channel",
  "c",
  "company",
  "pages",
  "profile",
  "add",
]);

export function normaliseText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function fromCodePoint(codePoint: number, fallback: string): string {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : fallback;
}

export function decodeEntities(value: string): string {
  return value.replace(ENTITY_RE, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return fromCodePoint(Number.parseInt(body.slice(2), 16), match);
    }
    if (body.startsWith("#")) {
      return fromCodePoint(Number.parseInt(body.slice(1), 10), match);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

export function resolveUrl(href: string, base: string): string | null {
  if (!URL.canParse(href, base)) return null;
  return new URL(href, base).toString();
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function profileHost(url: string): string | null {
  if (!URL.canParse(url)) return null;
  return new URL(url).hostname.replace(SUBDOMAIN_PATTERN, "");
}

export function socialPlatformFor(host: string): string | null {
  for (const [suffix, platform] of Object.entries(SOCIAL_HOSTS)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return platform;
  }
  return null;
}

export function socialHandle(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  const segments = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  const [first, second] = segments;
  const candidate =
    second !== undefined && HANDLE_PATH_PREFIXES.has(first.toLowerCase()) ? second : first;
  const handle = candidate.replace(/^@/, "");
  return handle.length > 0 ? handle : null;
}

type LdRecord = Record<string, unknown>;

function isLdRecord(value: unknown): value is LdRecord {
  return typeof value === "object" && value !== null;
}

export function organizationFromLdJson(raw: string): LdOrganization | undefined {
  const parsed = parseJson(raw);
  if (parsed === undefined) return undefined;

  const found: LdRecord[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isLdRecord(node)) return;
    const type = node["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((value) => value === "Organization")) found.push(node);
    for (const value of Object.values(node)) walk(value);
  };
  walk(parsed);

  const first = found[0];
  if (first === undefined) return undefined;
  const rawSameAs = first.sameAs;
  const sameAs = Array.isArray(rawSameAs)
    ? rawSameAs.filter((value): value is string => typeof value === "string")
    : [];
  const candidate = {
    name: typeof first.name === "string" ? decodeEntities(first.name) : undefined,
    url: typeof first.url === "string" ? first.url : undefined,
    logo: typeof first.logo === "string" ? decodeEntities(first.logo) : undefined,
    sameAs,
  };
  const result = ldOrganizationSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

function adLibraryHintFor(url: string, text: string): AdLibraryHint | null {
  const haystack = `${decodeEntities(url)} ${text}`.toLowerCase();
  for (const [needle, source] of AD_LIBRARY_URLS) {
    if (haystack.includes(needle)) return { source, value: url };
  }
  return null;
}

export async function extractSite(html: string, responseUrl: string): Promise<ExtractedSite> {
  const og: Record<string, string> = {};
  const icons: string[] = [];
  const appleTouchIcons: string[] = [];
  const socials: Social[] = [];
  const navLinks: NavLink[] = [];
  const adLibraryHints: AdLibraryHint[] = [];
  const ldChunks: string[] = [];
  const titleChunks: string[] = [];
  const ldJson: string[] = [];
  const pageText: string[] = [];

  const seenSocials = new Set<string>();
  const seenNav = new Set<string>();
  const seenHints = new Set<string>();
  let manifestUrl: string | null = null;
  let title = "";
  let skipDepth = 0;

  const finishAnchor = (href: string | null, start: number): void => {
    const text = normaliseText(
      decodeEntities(pageText.slice(start).join("").replaceAll("\u0000", " ")),
    );

    const resolved = href === null ? null : resolveUrl(decodeEntities(href), responseUrl);
    const host = resolved === null ? null : profileHost(resolved);

    if (resolved !== null) {
      const hint = adLibraryHintFor(resolved, text);
      if (hint !== null) {
        const hintKey = `${hint.source}:${hint.value}`;
        if (!seenHints.has(hintKey)) {
          seenHints.add(hintKey);
          adLibraryHints.push(hint);
        }
        return;
      }
    }

    const platform = host === null ? null : socialPlatformFor(host);
    if (platform !== null && resolved !== null) {
      const handle = socialHandle(resolved);
      const key = `${platform}:${handle?.toLowerCase() ?? resolved}`;
      if (handle !== null && !seenSocials.has(key)) {
        seenSocials.add(key);
        socials.push({ platform, url: resolved, handle });
      }
      return;
    }

    const label = text.length > 0 ? text : (resolved ?? href ?? "");
    const navKey = `${label}\u0000${resolved ?? ""}`;
    if (label.length > 0 && !seenNav.has(navKey)) {
      seenNav.add(navKey);
      navLinks.push({ href: resolved ?? href ?? "", text: label });
    }
  };

  let rewriter = new HTMLRewriter()
    .on("meta", {
      element(element) {
        for (const attr of ["property", "name"]) {
          const key = element.getAttribute(attr);
          const content = element.getAttribute("content");
          if (key === null || content === null) continue;
          if (key.startsWith("og:")) og[key.slice(3)] = decodeEntities(content);
        }
      },
    })
    .on("link", {
      element(element) {
        const rel = element.getAttribute("rel");
        const href = element.getAttribute("href");
        if (rel === null || href === null) return;
        const resolved = resolveUrl(decodeEntities(href), responseUrl);
        if (resolved === null) return;
        if (IS_APPLE_TOUCH_REL.test(rel)) {
          appleTouchIcons.push(resolved);
          return;
        }
        if (IS_ICON_REL.test(rel)) {
          icons.push(resolved);
          return;
        }
        if (IS_MANIFEST_REL.test(rel)) manifestUrl = resolved;
      },
    })
    .on("a", {
      element(element) {
        if (skipDepth > 0) return;
        const href = element.getAttribute("href");
        const start = pageText.length;
        element.onEndTag(() => {
          finishAnchor(href, start);
        });
      },
    })
    .on(SKIP_SELECTOR, {
      element(element) {
        if (VOID_ELEMENTS.has(element.tagName.toLowerCase())) return;
        skipDepth += 1;
        element.onEndTag(() => {
          skipDepth -= 1;
        });
      },
    })
    .on("script[type='application/ld+json']", {
      text(chunk) {
        ldChunks.push(chunk.text);
        if (chunk.lastInTextNode) {
          ldJson.push(ldChunks.join(""));
          ldChunks.length = 0;
        }
      },
    })
    .on("title", {
      text(chunk) {
        titleChunks.push(chunk.text);
        if (chunk.lastInTextNode) {
          title = normaliseText(decodeEntities(titleChunks.join("")));
          titleChunks.length = 0;
        }
      },
    })
    .on("body", {
      text(chunk) {
        if (skipDepth > 0) return;
        pageText.push(chunk.text);
        if (!chunk.lastInTextNode) return;
        pageText.push("\u0000");
      },
    });

  for (const [attr, source] of AD_LIBRARY_ATTRS) {
    rewriter = rewriter.on(`[${attr}]`, {
      element(element) {
        const value = element.getAttribute(attr);
        if (value === null || value.length === 0) return;
        if (seenHints.has(`${source}:${value}`)) return;
        seenHints.add(`${source}:${value}`);
        adLibraryHints.push({ source, value });
      },
    });
  }

  await rewriter.transform(new Response(html)).text();


  const ldOrganization = ldJson
    .map((raw) => organizationFromLdJson(raw))
    .find((value): value is LdOrganization => value !== undefined);

  const candidate = {
    url: responseUrl,
    ogSiteName: og.site_name,
    ogTitle: og.title,
    ogDescription: og.description,
    ogImage: og.image,
    title: title.length > 0 ? title : undefined,
    ldOrganization,
    icons,
    appleTouchIcons,
    manifestUrl,
    socials,
    navLinks,
    adLibraryHints,
    text: normaliseText(decodeEntities(pageText.join("").replaceAll("\u0000", " "))),
  };

  const parsed = extractedSiteSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`extractSite: output shape invalid — ${parsed.error.message}`);
  }
  return parsed.data;
}

export function isUsable(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function titleWithoutTagline(title: string | undefined): string | undefined {
  if (!isUsable(title)) return undefined;
  const segments = normaliseText(title)
    .split(/\s*[|·•–—]\s*|\s+-\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const head = segments[0];
  return head !== undefined && head.length > 0 ? head : undefined;
}

export function cascadeName(site: ExtractedSite, wikidataLabel?: string): string | undefined {
  const ldName = site.ldOrganization?.name;
  if (isUsable(ldName)) return normaliseText(ldName);

  if (isUsable(site.ogSiteName)) return normaliseText(site.ogSiteName);

  const fromTitle = titleWithoutTagline(site.title);
  if (fromTitle !== undefined) return fromTitle;

  if (isUsable(wikidataLabel)) return normaliseText(wikidataLabel);
  return undefined;
}
