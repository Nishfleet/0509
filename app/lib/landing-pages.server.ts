import { captureRenderedLandingPageSnapshot } from "~/lib/browser-run.server";
import { readResponseTextWithinLimit } from "~/lib/bounded-response.server";
import type { AppEnv } from "~/lib/env.server";
import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";
import { normalizeHeadline } from "~/lib/normalize";
import {
  normalizePublicHttpUrl,
  resolvePublicHttpUrl,
  resolvePublicRedirectUrl,
} from "~/lib/public-url.server";
import type { LandingPageSnapshotData } from "~/lib/types";

const TITLE_REGEX = /<title[^>]*>([^<]+)<\/title>/i;
const OG_TITLE_REGEX =
  /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const H1_REGEX = /<h1[^>]*>(.*?)<\/h1>/i;
const MAX_LANDING_PAGE_REDIRECTS = 5;
const MAX_LANDING_PAGE_HTML_BYTES = 1_000_000;

interface CaptureLandingPageSnapshotOptions {
  allowRenderedFallback?: boolean;
  preferRendered?: boolean;
}

export async function captureLandingPageSnapshot(
  env: AppEnv,
  url: string,
  options: CaptureLandingPageSnapshotOptions = {},
): Promise<LandingPageSnapshotData | null> {
  const publicUrl = await resolvePublicHttpUrl(url);
  if (!publicUrl) {
    return null;
  }

  return captureLandingPageSnapshotAt(env, publicUrl, options, 0);
}

async function captureLandingPageSnapshotAt(
  env: AppEnv,
  url: URL,
  options: CaptureLandingPageSnapshotOptions,
  redirectCount: number,
): Promise<LandingPageSnapshotData | null> {
  if (redirectCount > MAX_LANDING_PAGE_REDIRECTS) {
    return null;
  }

  try {
    const resolvedUrl = await resolvePublicHttpUrl(url);
    if (!resolvedUrl) {
      return null;
    }

    const response = await fetch(resolvedUrl.toString(), {
      redirect: "manual",
      headers: {
        "user-agent": "0509-bot/1.0 (+https://0509.io)",
      },
    });

    if (isRedirectStatus(response.status)) {
      const redirectedUrl = resolvePublicRedirectUrl(response.headers.get("location"), resolvedUrl);
      return redirectedUrl
        ? captureLandingPageSnapshotAt(env, redirectedUrl, options, redirectCount + 1)
        : null;
    }

    const finalUrl = await resolvePublicHttpUrl(response.url || resolvedUrl.toString());
    if (!finalUrl) {
      return null;
    }

    if (!response.ok) {
      return options.allowRenderedFallback === false
        ? null
        : captureRenderedLandingPageSnapshot(env, finalUrl.toString());
    }

    const html = await readResponseTextWithinLimit(response, MAX_LANDING_PAGE_HTML_BYTES);
    if (!html) {
      return options.allowRenderedFallback === false
        ? null
        : captureRenderedLandingPageSnapshot(env, finalUrl.toString());
    }
    const signals = extractLandingPageSignals(html);
    const headline =
      decodeHtml(findFirstMatch(html, OG_TITLE_REGEX) ?? "") ||
      decodeHtml(findFirstMatch(html, TITLE_REGEX) ?? "") ||
      decodeHtml(stripTags(findFirstMatch(html, H1_REGEX) ?? "")) ||
      "Landing page";

    const normalized = normalizeHeadline(headline);
    const canonicalUrl = finalUrl.toString();
    const artifactKey = env.LANDING_PAGE_ARTIFACTS
      ? await persistArtifact(env.LANDING_PAGE_ARTIFACTS, canonicalUrl, html)
      : null;
    if (options.preferRendered) {
      const renderedSnapshot = await captureRenderedLandingPageSnapshot(env, canonicalUrl);
      if (renderedSnapshot) {
        return renderedSnapshot;
      }
    }

    return {
      rawUrl: url.toString(),
      canonicalUrl,
      rawHeadline: normalized.raw,
      normalizedHeadline: normalized.normalized,
      normalizedHeadlineHash: normalized.hash,
      ctaText: signals.ctaText,
      priceText: signals.priceText,
      formPresent: signals.formPresent,
      captureMethod: "landing_page_fetch",
      capturedAt: new Date().toISOString(),
      artifactKey,
      metadata: {
        fetchStatus: response.status,
      },
    };
  } catch {
    return options.allowRenderedFallback === false
      ? null
      : captureRenderedLandingPageSnapshot(env, url.toString());
  }
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400;
}

async function persistArtifact(bucket: R2Bucket, url: string, html: string) {
  const objectKey = `landing-pages/${new Date().toISOString().slice(0, 10)}/${crypto
    .randomUUID()
    .replaceAll("-", "")}.html`;
  await bucket.put(objectKey, html, {
    httpMetadata: {
      contentType: "text/html; charset=utf-8",
    },
    customMetadata: {
      sourceUrl: url,
    },
  });
  return objectKey;
}

function findFirstMatch(value: string, regex: RegExp) {
  return value.match(regex)?.[1]?.trim() ?? null;
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
