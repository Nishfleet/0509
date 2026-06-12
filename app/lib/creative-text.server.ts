import type { AppEnv } from "~/lib/env.server";
import { resolvePublicHttpUrl, resolvePublicRedirectUrl } from "~/lib/public-url.server";
import type { AdRecord } from "~/lib/types";

export const CREATIVE_TEXT_EXTRACTOR_VERSION = "creative-text-v2";
export const CREATIVE_TEXT_OCR_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

const ATTRIBUTE_TEXT_REGEX = /\b(?:aria-label|alt)=["']([^"']+)["']/gi;
const BLOCK_BREAK_REGEX = /<\/(?:div|p|h1|h2|h3|h4|h5|h6|li|section|article|button|a)>/gi;
const META_IMAGE_REGEX =
  /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
const IMAGE_SOURCE_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
const SKIP_IMAGE_PATTERN = /(logo|icon|avatar|profile|favicon|emoji|sprite)/i;
const GENERIC_UI_LINES = new Set([
  "sponsored",
  "learn more",
  "see ad details",
  "why am i seeing this ad?",
  "meta",
  "facebook",
  "instagram",
]);
const OCR_PROMPT =
  "Extract only the ad creative text visible in this image. Return the text as short lines separated by newlines. Ignore buttons, browser chrome, logos, and surrounding UI.";

type KnownAdText = Pick<
  AdRecord,
  "advertiser" | "body" | "previewHeadline" | "previewSubhead" | "cta"
>;

type CreativeTextEnv = Pick<AppEnv, "AI">;

interface CreativeImagePayload {
  bytes: Uint8Array;
  contentType: string;
  imageUrl: string;
  imageFetchStatus: number;
}

export interface CreativeTextCaptureResult {
  text: string | null;
  captureMethod: "ad_snapshot_fetch";
  extractorVersion: string;
  // Best https creative image mined from the snapshot — used as the ad
  // thumbnail. data: URLs are excluded (megabytes of base64 in raw_json).
  imageUrl: string | null;
  metadata: Record<string, unknown>;
}

const MAX_CREATIVE_FETCH_REDIRECTS = 5;

// Ad snapshot pages — and the og:image / <img> URLs mined out of them — are
// attacker-influenced content. Every fetch, including each redirect hop, must
// resolve to the public internet (same guard as landing-pages.server.ts), or
// the Worker becomes an SSRF proxy into private address space.
async function fetchPublicCreativeResource(
  url: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  let currentUrl = await resolvePublicHttpUrl(url);

  for (
    let redirects = 0;
    currentUrl && redirects <= MAX_CREATIVE_FETCH_REDIRECTS;
    redirects += 1
  ) {
    const response = await fetch(currentUrl.toString(), {
      redirect: "manual",
      headers,
    });

    if (response.status >= 300 && response.status < 400) {
      const redirected = resolvePublicRedirectUrl(response.headers.get("location"), currentUrl);
      currentUrl = redirected ? await resolvePublicHttpUrl(redirected) : null;
      continue;
    }

    return response;
  }

  return null;
}

export async function captureCreativeText(
  env: CreativeTextEnv,
  url: string,
  ad: KnownAdText,
): Promise<CreativeTextCaptureResult | null> {
  if (!url || !/^https?:\/\//i.test(url)) {
    return null;
  }

  try {
    const response = await fetchPublicCreativeResource(url, {
      "user-agent": "0509-bot/1.0 (+https://0509.in)",
    });

    if (!response?.ok) {
      return null;
    }

    const html = await response.text();
    const creativeImageUrl =
      extractCreativeImageCandidates(html, response.url || url).find(
        (candidate) => !candidate.startsWith("data:"),
      ) ?? null;
    const extractedFromHtml = extractCreativeTextFromSnapshotHtml(html, ad);
    if (extractedFromHtml) {
      return {
        text: extractedFromHtml,
        captureMethod: "ad_snapshot_fetch",
        extractorVersion: CREATIVE_TEXT_EXTRACTOR_VERSION,
        imageUrl: creativeImageUrl,
        metadata: {
          fetchStatus: response.status,
          extractionPath: "snapshot_html",
        },
      };
    }

    const extractedFromImage = await extractCreativeTextFromSnapshotImage(
      env,
      response.url || url,
      html,
      ad,
    );
    if (!extractedFromImage) {
      return null;
    }

    return {
      text: extractedFromImage.text,
      captureMethod: "ad_snapshot_fetch",
      extractorVersion: CREATIVE_TEXT_EXTRACTOR_VERSION,
      imageUrl: creativeImageUrl,
      metadata: {
        fetchStatus: response.status,
        extractionPath: "snapshot_image_ocr",
        ...extractedFromImage.metadata,
      },
    };
  } catch {
    return null;
  }
}

export function extractCreativeTextFromSnapshotHtml(
  html: string,
  ad: KnownAdText,
): string | null {
  const attributeMatches = Array.from(html.matchAll(ATTRIBUTE_TEXT_REGEX)).map(
    (match) => match[1] ?? "",
  );
  const sanitizedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(BLOCK_BREAK_REGEX, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const bodyText = decodeHtml(stripTags(sanitizedHtml));

  return selectCreativeTextCandidates(
    [...bodyText.split(/\n+/), ...attributeMatches],
    ad,
  );
}

async function extractCreativeTextFromSnapshotImage(
  env: CreativeTextEnv,
  snapshotUrl: string,
  html: string,
  ad: KnownAdText,
) {
  if (!env.AI) {
    return null;
  }

  const candidates = extractCreativeImageCandidates(html, snapshotUrl);
  for (const candidate of candidates) {
    try {
      const image = await fetchCreativeImagePayload(candidate, snapshotUrl);
      if (!image) {
        continue;
      }

      const response = await env.AI.run(CREATIVE_TEXT_OCR_MODEL, {
        image: [...image.bytes],
        prompt: OCR_PROMPT,
        max_tokens: 256,
      });
      const text = selectCreativeTextCandidates(
        splitTextLines(readOcrDescription(response)),
        ad,
      );

      if (!text) {
        continue;
      }

      return {
        text,
        metadata: {
          imageUrl: image.imageUrl,
          imageFetchStatus: image.imageFetchStatus,
          imageContentType: image.contentType,
          ocrProvider: "workers_ai",
          ocrModel: CREATIVE_TEXT_OCR_MODEL,
        },
      };
    } catch {
      continue;
    }
  }

  return null;
}

function extractCreativeImageCandidates(html: string, snapshotUrl: string) {
  const ranked = new Map<string, number>();

  for (const rawCandidate of collectMatches(html, META_IMAGE_REGEX)) {
    const resolved = resolveImageCandidate(rawCandidate, snapshotUrl);
    if (!resolved) {
      continue;
    }
    ranked.set(resolved, Math.max(ranked.get(resolved) ?? 0, 10));
  }

  for (const rawCandidate of collectMatches(html, IMAGE_SOURCE_REGEX)) {
    const resolved = resolveImageCandidate(rawCandidate, snapshotUrl);
    if (!resolved) {
      continue;
    }
    ranked.set(resolved, Math.max(ranked.get(resolved) ?? 0, 5));
  }

  return [...ranked.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([candidate]) => candidate);
}

function collectMatches(html: string, regex: RegExp) {
  return Array.from(html.matchAll(regex)).map((match) => match[1] ?? "");
}

function resolveImageCandidate(candidate: string, snapshotUrl: string) {
  const normalized = decodeHtml(candidate).trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("data:image/")) {
    return normalized;
  }

  try {
    const resolved = new URL(normalized, snapshotUrl).toString();
    if (!/^https?:\/\//i.test(resolved)) {
      return null;
    }
    if (SKIP_IMAGE_PATTERN.test(resolved)) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

async function fetchCreativeImagePayload(
  candidate: string,
  snapshotUrl: string,
): Promise<CreativeImagePayload | null> {
  if (candidate.startsWith("data:image/")) {
    const payload = decodeDataUrl(candidate);
    if (!payload) {
      return null;
    }
    return {
      bytes: payload.bytes,
      contentType: payload.contentType,
      imageUrl: "data:image",
      imageFetchStatus: 200,
    };
  }

  const response = await fetchPublicCreativeResource(candidate, {
    "user-agent": "0509-bot/1.0 (+https://0509.in)",
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    referer: snapshotUrl,
  });
  if (!response?.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    return null;
  }

  return {
    bytes: new Uint8Array(buffer),
    contentType,
    imageUrl: response.url || candidate,
    imageFetchStatus: response.status,
  };
}

function decodeDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) {
    return null;
  }

  const contentType = match[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(match[2]), (character) =>
    character.charCodeAt(0),
  );

  return {
    bytes,
    contentType,
  };
}

function readOcrDescription(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "description" in value &&
    typeof value.description === "string"
  ) {
    return value.description;
  }

  return "";
}

function splitTextLines(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function selectCreativeTextCandidates(
  candidates: string[],
  ad: KnownAdText,
): string | null {
  if (candidates.length === 0) {
    return null;
  }

  const knownText = [
    ad.advertiser,
    ad.body,
    ad.previewHeadline,
    ad.previewSubhead,
    ad.cta,
  ]
    .map((line) => normalizeLine(line))
    .filter(Boolean);

  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    const normalized = normalizeLine(candidate);
    if (!normalized) {
      continue;
    }
    if (GENERIC_UI_LINES.has(normalized.toLowerCase())) {
      continue;
    }
    if (normalized.length < 4 || normalized.length > 80) {
      continue;
    }
    if (!/[a-z\u0900-\u0D7F]/i.test(normalized)) {
      continue;
    }
    if (
      knownText.some(
        (line) =>
          line === normalized ||
          line.includes(normalized) ||
          normalized.includes(line),
      )
    ) {
      continue;
    }
    unique.set(normalized, candidate.trim());
  }

  const ranked = [...unique.values()]
    .filter((candidate) => scoreCandidate(candidate) > 0)
    .slice(0, 3);

  return ranked.length > 0 ? ranked.join("\n") : null;
}

function scoreCandidate(value: string) {
  let score = 0;
  if (/\d/.test(value)) score += 2;
  if (/[₹$€]/.test(value)) score += 2;
  if (value === value.toUpperCase() && /[A-Z]/.test(value)) score += 1;
  if (value.length >= 8 && value.length <= 32) score += 1;
  return score;
}

function normalizeLine(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function stripTags(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}
