import puppeteer from "@cloudflare/puppeteer";

import type { AppEnv } from "~/lib/env.server";
import {
  extractLandingPageSignals,
  LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
} from "~/lib/landing-page-signals.server";
import { normalizeHeadline } from "~/lib/normalize";
import type { LandingPageSnapshotData, ProofDeviceProfile, ProofRenderMode } from "~/lib/types";

const TITLE_REGEX = /<title[^>]*>([^<]+)<\/title>/i;
const OG_TITLE_REGEX =
  /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i;
const H1_REGEX = /<h1[^>]*>(.*?)<\/h1>/i;

const MOBILE_RENDER_MODE: ProofRenderMode = "mobile";
const MOBILE_DEVICE_PROFILE: ProofDeviceProfile = "mobile_default";
const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export async function captureBrowserRunSnapshot(
  env: AppEnv,
  url: string,
): Promise<LandingPageSnapshotData | null> {
  if (!env.BROWSER || !url || !/^https?:\/\//i.test(url)) {
    return null;
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent(MOBILE_USER_AGENT);
    await page.setViewport(MOBILE_VIEWPORT);
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

    const html = await page.content();
    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: 85,
      fullPage: true,
    });
    const canonicalUrl = page.url() || url;

    return buildBrowserRenderedSnapshot(env, {
      url,
      canonicalUrl,
      html,
      screenshot,
    });
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function buildBrowserRenderedSnapshot(
  env: AppEnv,
  input: {
    url: string;
    canonicalUrl: string;
    html: string;
    screenshot: Uint8Array | ArrayBuffer | Buffer;
  },
): Promise<LandingPageSnapshotData> {
  const html = input.html;
  const signals = extractLandingPageSignals(html);
  const headline = resolveHeadline(html);
  const normalized = normalizeHeadline(headline);

  return persistBrowserArtifacts(env, input.canonicalUrl, html, input.screenshot).then(
    ({ htmlArtifactKey, screenshotArtifactKey }) => ({
      rawUrl: input.url,
      canonicalUrl: input.canonicalUrl,
      rawHeadline: normalized.raw,
      normalizedHeadline: normalized.normalized,
      normalizedHeadlineHash: normalized.hash,
      ctaText: signals.ctaText,
      priceText: signals.priceText,
      formPresent: signals.formPresent,
      captureMethod: "browser_render",
      capturedAt: new Date().toISOString(),
      artifactKey: htmlArtifactKey,
      metadata: {
        htmlArtifactKey,
        screenshotArtifactKey,
        renderMode: MOBILE_RENDER_MODE,
        deviceProfile: MOBILE_DEVICE_PROFILE,
        extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        extractionWarnings: buildExtractionWarnings({
          headline,
          ctaText: signals.ctaText,
          priceText: signals.priceText,
          formPresent: signals.formPresent,
        }),
        extractedFieldConfidence: {
          headline: 0.95,
          ctaText: signals.ctaText ? 0.9 : 0.3,
          priceText: signals.priceText ? 0.85 : 0.25,
          formPresent: typeof signals.formPresent === "boolean" ? 0.9 : 0.25,
        },
      },
    }),
  );
}

async function persistBrowserArtifacts(
  env: AppEnv,
  canonicalUrl: string,
  html: string,
  screenshot: Uint8Array | ArrayBuffer | Buffer,
) {
  if (!env.LANDING_PAGE_ARTIFACTS) {
    return {
      htmlArtifactKey: null,
      screenshotArtifactKey: null,
    };
  }

  const baseKey = `landing-pages/${new Date().toISOString().slice(0, 10)}/${crypto
    .randomUUID()
    .replaceAll("-", "")}`;
  const htmlArtifactKey = `${baseKey}.html`;
  const screenshotArtifactKey = `${baseKey}.jpeg`;

  await env.LANDING_PAGE_ARTIFACTS.put(htmlArtifactKey, html, {
    httpMetadata: {
      contentType: "text/html; charset=utf-8",
    },
    customMetadata: {
      sourceUrl: canonicalUrl,
      renderMode: MOBILE_RENDER_MODE,
    },
  });
  await env.LANDING_PAGE_ARTIFACTS.put(screenshotArtifactKey, toUint8Array(screenshot), {
    httpMetadata: {
      contentType: "image/jpeg",
    },
    customMetadata: {
      sourceUrl: canonicalUrl,
      renderMode: MOBILE_RENDER_MODE,
      deviceProfile: MOBILE_DEVICE_PROFILE,
    },
  });

  return {
    htmlArtifactKey,
    screenshotArtifactKey,
  };
}

function resolveHeadline(html: string) {
  return (
    decodeHtml(findFirstMatch(html, OG_TITLE_REGEX) ?? "") ||
    decodeHtml(findFirstMatch(html, TITLE_REGEX) ?? "") ||
    decodeHtml(stripTags(findFirstMatch(html, H1_REGEX) ?? "")) ||
    "Landing page"
  );
}

function buildExtractionWarnings(input: {
  headline: string | null;
  ctaText: string | null;
  priceText: string | null;
  formPresent: boolean | null;
}) {
  const warnings: string[] = [];

  if (!input.headline) {
    warnings.push("headline_missing");
  }
  if (!input.ctaText) {
    warnings.push("cta_missing");
  }
  if (!input.priceText) {
    warnings.push("offer_missing");
  }
  if (input.formPresent === false) {
    warnings.push("form_not_detected");
  }

  return warnings.filter((warning) => warning !== "form_not_detected");
}

function toUint8Array(value: Uint8Array | ArrayBuffer | Buffer) {
  if (value instanceof Uint8Array) {
    return value;
  }

  return new Uint8Array(value);
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
