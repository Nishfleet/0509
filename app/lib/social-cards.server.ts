/**
 * Dynamic social-card SVGs for programmatic buyer surfaces.
 *
 * Serves `/social/ads/:domain`, `/social/compare/:slug`, `/social/switch/:slug`,
 * `/social/sneaker-resale`, and `/social/competitor-monitoring` from the Worker
 * edge. The SVGs are pure text/geometry generated from data the public routes
 * already use — no image pipeline, no raster rendering, no external fetch.
 */

import {
  adHasVerifiedDomainLink,
  computeBrandPageAggressionScore,
  loadBrandPageCacheSnapshot,
  normalizeBrandPageDomain,
} from "~/lib/brand-page.server";
import { defaultCountryForVisitor } from "~/lib/countries";
import { COMPARE_PRODUCT_NAMES, type CompareSlug } from "~/lib/compare-pages";
import type { AppEnv } from "~/lib/env.server";
import { resolveE2ELocalSearchEnv } from "~/lib/e2e-search.server";
import { SWITCH_PAGES, type SwitchSlug } from "~/lib/switch-pages";

const SOCIAL_CARD_PATH_PATTERN = /^\/social\/(ads|compare|switch|sneaker-resale|competitor-monitoring)(?:\/(.+))?$/;

interface SocialCardMatch {
  kind: "ads" | "compare" | "switch" | "sneaker-resale" | "competitor-monitoring";
  slug: string | undefined;
}

export function parseSocialCardPath(pathname: string): SocialCardMatch | null {
  const match = pathname.match(SOCIAL_CARD_PATH_PATTERN);
  if (!match) return null;
  const kind = match[1] as SocialCardMatch["kind"];
  const slug = match[2] ?? undefined;
  return { kind, slug };
}

/**
 * Serve a dynamic social-card SVG. Returns `null` when the path is not a social
 * card route; returns a 404 Response when the path matches but the underlying
 * page data is not available (e.g. an unknown compare slug).
 */
export async function serveSocialCard(
  env: AppEnv,
  request: Request,
  pathname: string,
): Promise<Response | null> {
  const parsed = parseSocialCardPath(pathname);
  if (!parsed) return null;

  try {
    const body = await buildSocialCardBody(env, request, parsed);
    if (body === null) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.warn("social card generation failed", { pathname, errorName: error instanceof Error ? error.name : typeof error });
    return new Response("Not Found", { status: 404 });
  }
}

async function buildSocialCardBody(
  env: AppEnv,
  request: Request,
  parsed: SocialCardMatch,
): Promise<string | null> {
  switch (parsed.kind) {
    case "ads":
      return buildAdsSocialCard(env, request, parsed.slug);
    case "compare":
      return buildCompareSocialCard(parsed.slug);
    case "switch":
      return buildSwitchSocialCard(parsed.slug);
    case "sneaker-resale":
      return buildGenericSocialCard({
        headline: "Sneaker resale competitor ads",
        subtitle: "Five to Nine",
      });
    case "competitor-monitoring":
      return buildGenericSocialCard({
        headline: "Competitor monitoring software",
        subtitle: "Five to Nine",
      });
    default:
      return null;
  }
}

async function buildAdsSocialCard(
  env: AppEnv,
  request: Request,
  rawSlug: string | undefined,
): Promise<string | null> {
  if (!rawSlug) return null;
  const brand = normalizeBrandPageDomain(rawSlug);
  if (!brand) return null;

  const e2eEnv = await resolveE2ELocalSearchEnv(env, request);
  const visitorCountry = defaultCountryForVisitor(request.headers.get("cf-ipcountry"));
  const snapshot = await loadBrandPageCacheSnapshot(e2eEnv, {
    domain: brand.domain,
    visitorCountry,
  });
  if (!snapshot) return null;

  const now = new Date();
  const verifiedLinkedAds = snapshot.ads.filter((ad) => adHasVerifiedDomainLink(ad, brand.domain));
  const aggression = computeBrandPageAggressionScore(verifiedLinkedAds, now);

  const subtitle = aggression
    ? `Ad Aggression Score: ${aggression.score}/100`
    : "Five to Nine";

  return buildGenericSocialCard({
    headline: brand.displayName,
    subtitle,
  });
}

function buildCompareSocialCard(rawSlug: string | undefined): string | null {
  if (!rawSlug) {
    return buildGenericSocialCard({
      headline: "Compare Five to Nine vs the alternatives",
      subtitle: "Side-by-side competitor monitoring comparisons",
    });
  }
  const productName = COMPARE_PRODUCT_NAMES[rawSlug as CompareSlug];
  if (!productName) return null;
  return buildGenericSocialCard({
    headline: `Five to Nine vs ${productName}`,
    subtitle: "Compare page",
  });
}

function buildSwitchSocialCard(rawSlug: string | undefined): string | null {
  if (!rawSlug) return null;
  const page = SWITCH_PAGES[rawSlug as SwitchSlug];
  if (!page) return null;
  return buildGenericSocialCard({
    headline: `Five to Nine vs ${page.productName}`,
    subtitle: "Switch guide",
  });
}

function buildGenericSocialCard(input: { headline: string; subtitle: string }): string {
  const headlineLines = wrapText(escapeXml(input.headline), 22);
  const subtitleLines = wrapText(escapeXml(input.subtitle), 55);

  const headlineTspans = headlineLines
    .map((line, index) => `<tspan x="86" dy="${index === 0 ? "0" : "92"}">${line}</tspan>`)
    .join("");
  const subtitleTspans = subtitleLines
    .map((line, index) => `<tspan x="86" dy="${index === 0 ? "0" : "48"}">${line}</tspan>`)
    .join("");

  const headlineY = headlineLines.length === 1 ? "222" : "180";
  const subtitleY = String(Number(headlineY) + 92 + (headlineLines.length - 1) * 92 + 40);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">Five to Nine — ${escapeXml(input.headline)}</title>
  <desc id="desc">${escapeXml(input.subtitle)}</desc>
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#52c9df"/>
      <stop offset="0.42" stop-color="#7f5cff"/>
      <stop offset="0.72" stop-color="#ff5f74"/>
      <stop offset="1" stop-color="#f9c37b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <path d="M0 420 L1200 300 L1200 630 L0 630 Z" fill="#fff"/>
  <g font-family="Inter, Arial, sans-serif" font-weight="800">
    <text x="86" y="92" fill="#fff" font-size="42">Five to Nine</text>
    <text x="86" y="${headlineY}" fill="#07111a" font-size="78">${headlineTspans}</text>
    <text x="86" y="${subtitleY}" fill="#344052" font-size="34" font-weight="600">${subtitleTspans}</text>
  </g>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}
