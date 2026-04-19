import { captureBrowserRunSnapshot } from "~/lib/browser-run.server";
import type { AppEnv } from "~/lib/env.server";
import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";
import { normalizeHeadline } from "~/lib/normalize";
import type { LandingPageSnapshotData } from "~/lib/types";

const TITLE_REGEX = /<title[^>]*>([^<]+)<\/title>/i;
const OG_TITLE_REGEX =
  /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const H1_REGEX = /<h1[^>]*>(.*?)<\/h1>/i;

export async function captureLandingPageSnapshot(
  env: AppEnv,
  url: string,
): Promise<LandingPageSnapshotData | null> {
  if (!url || !/^https?:\/\//i.test(url)) {
    return null;
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "0509-bot/1.0 (+https://0509.in)",
      },
    });

    if (!response.ok) {
      return captureBrowserRunSnapshot(env, url);
    }

    const html = await response.text();
    const signals = extractLandingPageSignals(html);
    const headline =
      decodeHtml(findFirstMatch(html, OG_TITLE_REGEX) ?? "") ||
      decodeHtml(findFirstMatch(html, TITLE_REGEX) ?? "") ||
      decodeHtml(stripTags(findFirstMatch(html, H1_REGEX) ?? "")) ||
      "Landing page";

    const normalized = normalizeHeadline(headline);
    const canonicalUrl = response.url || url;
    const artifactKey = env.LANDING_PAGE_ARTIFACTS
      ? await persistArtifact(env.LANDING_PAGE_ARTIFACTS, canonicalUrl, html)
      : null;

    return {
      rawUrl: url,
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
    return captureBrowserRunSnapshot(env, url);
  }
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
