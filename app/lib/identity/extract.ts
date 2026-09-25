import { z } from "zod";

import { extractPageText } from "../site/extract-text";

const SOCIAL_PLATFORMS = ["instagram", "tiktok", "youtube", "twitter", "facebook"] as const;

export const identityExtractSchema = z.object({
  nameSources: z.object({
    ldOrganizationName: z.string().nullable(),
    ogSiteName: z.string().nullable(),
    title: z.string().nullable(),
  }),
  description: z.string().nullable(),
  ogImage: z.string().nullable(),
  ldOrganizationLogo: z.string().nullable(),
  appleTouchIcon: z.string().nullable(),
  manifestUrl: z.string().nullable(),
  socials: z.array(
    z.object({
      platform: z.enum(SOCIAL_PLATFORMS),
      url: z.string(),
    }),
  ),
  navLinks: z.array(z.string()),
  navPages: z.array(z.object({ url: z.string(), title: z.string() })),
  adLibraryHints: z.array(z.string()),
  text: z.string(),
});

export type IdentityExtract = z.infer<typeof identityExtractSchema>;

type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

interface SocialLink {
  platform: SocialPlatform;
  url: string;
}

interface IdentityRewriterState {
  ogSiteName: string | null;
  ogDescription: string | null;
  metaDescription: string | null;
  ogImage: string | null;
  titlePending: string;
  title: string | null;
  ldPending: string | null;
  ldBlocks: string[];
  appleTouchIcon: string | null;
  manifestUrl: string | null;
  anchors: string[];
  navLinks: string[];
  navPages: { url: string; title: string }[];
  navTitleOpen: boolean;
}

const TITLE_SEPARATORS = [" - ", " | ", " – "];

function firstContent(current: string | null, value: string | null): string | null {
  if (current !== null) return current;
  return value;
}

function resolveUrl(href: string, pageUrl: string): URL | null {
  return URL.canParse(href, pageUrl) ? new URL(href, pageUrl) : null;
}

function socialHost(hostname: string): string {
  const labels = hostname.toLowerCase().split(".");
  const first = labels[0];
  if (first === "www" || first === "m" || first === "uk") {
    labels.shift();
  }
  return labels.join(".");
}

function platformForUrl(href: string): SocialPlatform | null {
  if (!URL.canParse(href)) return null;
  const url = new URL(href);
  const host = socialHost(url.hostname);
  if (host === "instagram.com") return "instagram";
  if (host === "tiktok.com") return "tiktok";
  if (host === "youtube.com") return "youtube";
  if (host === "twitter.com" || host === "x.com") return "twitter";
  if (host === "facebook.com") {
    if (url.pathname.startsWith("/ads/library")) return null;
    return "facebook";
  }
  return null;
}

function isAdLibraryHint(href: string): boolean {
  if (href.startsWith("https://www.facebook.com/ads/library")) return true;
  return URL.canParse(href) && new URL(href).hostname === "adstransparency.google.com";
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function cutTitle(title: string): string | null {
  let end = title.length;
  for (const separator of TITLE_SEPARATORS) {
    const index = title.indexOf(separator);
    if (index !== -1 && index < end) end = index;
  }
  const cut = title.slice(0, end).trim();
  return cut.length === 0 ? null : cut;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeIncludesOrganization(type: unknown): boolean {
  if (type === "Organization") return true;
  return Array.isArray(type) && type.includes("Organization");
}

function flattenLd(value: unknown, into: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) flattenLd(entry, into);
    return;
  }
  if (!isRecord(value)) return;
  into.push(value);
  if (Array.isArray(value["@graph"])) flattenLd(value["@graph"], into);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function logoField(logo: unknown): string | null {
  if (typeof logo === "string") return logo;
  if (isRecord(logo) && typeof logo.url === "string") return logo.url;
  return null;
}

function sameAsField(sameAs: unknown): string[] {
  if (!Array.isArray(sameAs)) return [];
  return sameAs.filter((entry): entry is string => typeof entry === "string");
}

function readOrganization(blocks: readonly string[]): {
  name: string | null;
  logo: string | null;
  sameAs: string[];
} {
  const nodes: Record<string, unknown>[] = [];
  for (const block of blocks) {
    try {
      flattenLd(JSON.parse(block) as unknown, nodes);
    } catch (error) {
      console.log(JSON.stringify({ event: "identity-ld-json-unreadable", error: String(error) }));
      continue;
    }
  }
  const organization = nodes.find((node) => typeIncludesOrganization(node["@type"]));
  if (!organization) return { name: null, logo: null, sameAs: [] };
  return {
    name: stringField(organization.name),
    logo: logoField(organization.logo),
    sameAs: sameAsField(organization.sameAs),
  };
}

function collectSocials(sameAs: readonly string[], anchors: readonly string[]): SocialLink[] {
  const socials: SocialLink[] = [];
  const seen = new Set<SocialPlatform>();
  for (const href of [...sameAs, ...anchors]) {
    const platform = platformForUrl(href);
    if (platform === null || seen.has(platform)) continue;
    seen.add(platform);
    socials.push({ platform, url: new URL(href).href });
  }
  return socials;
}

export async function extractIdentity(html: string, pageUrl: string): Promise<IdentityExtract> {
  const state: IdentityRewriterState = {
    ogSiteName: null,
    ogDescription: null,
    metaDescription: null,
    ogImage: null,
    titlePending: "",
    title: null,
    ldPending: null,
    ldBlocks: [],
    appleTouchIcon: null,
    manifestUrl: null,
    anchors: [],
    navLinks: [],
    navPages: [],
    navTitleOpen: false,
  };
  const pageOrigin = new URL(pageUrl).origin;

  const rewritten = new HTMLRewriter()
    .on('meta[property="og:site_name"]', {
      element(element) {
        state.ogSiteName = firstContent(state.ogSiteName, element.getAttribute("content"));
      },
    })
    .on('meta[property="og:description"]', {
      element(element) {
        state.ogDescription = firstContent(state.ogDescription, element.getAttribute("content"));
      },
    })
    .on('meta[property="og:image"]', {
      element(element) {
        state.ogImage = firstContent(state.ogImage, element.getAttribute("content"));
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        state.metaDescription = firstContent(state.metaDescription, element.getAttribute("content"));
      },
    })
    .on("title", {
      text(chunk) {
        state.titlePending += chunk.text;
        if (!chunk.lastInTextNode) return;
        state.title ??= state.titlePending;
        state.titlePending = "";
      },
    })
    .on('script[type="application/ld+json"]', {
      element() {
        state.ldPending = "";
      },
      text(chunk) {
        if (state.ldPending === null) return;
        state.ldPending += chunk.text;
        if (!chunk.lastInTextNode) return;
        state.ldBlocks.push(state.ldPending);
        state.ldPending = null;
      },
    })
    .on("link[rel]", {
      element(element) {
        const rel = element.getAttribute("rel");
        const href = element.getAttribute("href");
        if (rel === null || href === null) return;
        const tokens = rel.split(/\s+/).map((token) => token.toLowerCase());
        const resolved = resolveUrl(href, pageUrl);
        if (resolved === null) return;
        if (tokens.includes("apple-touch-icon")) {
          state.appleTouchIcon = firstContent(state.appleTouchIcon, resolved.href);
        }
        if (tokens.includes("manifest")) {
          state.manifestUrl = firstContent(state.manifestUrl, resolved.href);
        }
      },
    })
    .on("a[href]", {
      element(element) {
        const href = element.getAttribute("href");
        if (href === null) return;
        const resolved = resolveUrl(href, pageUrl);
        if (resolved === null) return;
        state.anchors.push(resolved.href);
      },
    })
    .on("nav a[href]", {
      element(element) {
        state.navTitleOpen = false;
        const href = element.getAttribute("href");
        if (href === null) return;
        const url = resolveUrl(href, pageUrl);
        if (url === null) return;
        if (url.origin !== pageOrigin) return;
        state.navLinks.push(url.href);
        state.navPages.push({ url: url.href, title: "" });
        state.navTitleOpen = true;
      },
      text(chunk) {
        if (!state.navTitleOpen) return;
        const last = state.navPages[state.navPages.length - 1];
        if (last === undefined) return;
        state.navPages[state.navPages.length - 1] = { url: last.url, title: last.title + chunk.text };
      },
    })
    .transform(new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } }));

  await rewritten.arrayBuffer();

  const organization = readOrganization(state.ldBlocks);
  const anchors = [...state.anchors];
  const navLinks = dedupe(state.navLinks);
  const navPages: { url: string; title: string }[] = [];
  const navPageSeen = new Set<string>();
  for (const entry of state.navPages) {
    if (navPageSeen.has(entry.url)) continue;
    navPageSeen.add(entry.url);
    const title = entry.title.split(/\s+/).join(" ").trim();
    navPages.push({ url: entry.url, title });
  }
  const adLibraryHints = dedupe(anchors.filter(isAdLibraryHint));

  return identityExtractSchema.parse({
    nameSources: {
      ldOrganizationName: organization.name,
      ogSiteName: state.ogSiteName,
      title: state.title === null ? null : cutTitle(state.title),
    },
    description: state.ogDescription ?? state.metaDescription,
    ogImage: state.ogImage,
    ldOrganizationLogo: organization.logo,
    appleTouchIcon: state.appleTouchIcon,
    manifestUrl: state.manifestUrl,
    socials: collectSocials(organization.sameAs, anchors),
    navLinks,
    navPages,
    adLibraryHints,
    text: (await extractPageText(html)).text,
  });
}
