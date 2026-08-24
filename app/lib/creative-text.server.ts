import type { AppEnv } from "~/lib/env.server";
import {
  base64DecodedLengthExceeds,
  contentLengthExceeds,
  readResponseBytesWithinLimit,
  readResponseTextWithinLimit,
} from "~/lib/bounded-response.server";
import { decodeHtmlEntities as decodeHtml } from "~/lib/decode-html.server";
import { creativeCaptureSourceFingerprint } from "~/lib/creative-capture-policy";
import {
  fetchWithTimeout,
  promiseWithTimeout,
  releaseFetchTimeout,
} from "~/lib/fetch-timeout.server";
import { hasClassifierScriptChar } from "~/lib/language-classifier";
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
const MAX_CREATIVE_SNAPSHOT_HTML_BYTES = 750_000;
const MAX_CREATIVE_IMAGE_BYTES = 2_000_000;
const MAX_CREATIVE_IMAGE_CANDIDATES = 5;
const CREATIVE_OCR_TIMEOUT_MS = 10_000;
const CREATIVE_OCR_RETRY_BACKOFF_MS = 100;

type KnownAdText = Pick<
  AdRecord,
  | "advertiser"
  | "body"
  | "previewHeadline"
  | "previewSubhead"
  | "cta"
  | "creativeImageUrl"
> & { adSnapshotUrl?: string | null };

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

export function createMissingCreativeCaptureResult(
  ad: Pick<AdRecord, "creativeImageUrl">,
): CreativeTextCaptureResult {
  return buildUnreadableCreativeResult(
    "no_creative_capture_stored",
    ad.creativeImageUrl ?? null,
    null,
  );
}

export type CreativeUnreadableReasonCode =
  | "no_creative_capture_stored"
  | "creative_capture_url_invalid"
  | "creative_snapshot_fetch_failed"
  | "creative_snapshot_http_error"
  | "creative_snapshot_empty_or_oversized"
  | "creative_image_missing"
  | "creative_image_invalid_or_oversized"
  | "ocr_binding_missing"
  | "ocr_provider_failed"
  | "ocr_empty_result"
  | "ocr_text_filtered";

interface CreativeOcrResult {
  text: string | null;
  imageUrl: string | null;
  reasonCode: CreativeUnreadableReasonCode | null;
  metadata: Record<string, unknown>;
}

const MAX_CREATIVE_FETCH_REDIRECTS = 5;
const CREATIVE_RESOURCE_FETCH_TIMEOUT_MS = 12_000;

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
    const response = await fetchWithTimeout(
      currentUrl.toString(),
      {
        redirect: "manual",
        headers,
      },
      { timeoutMs: CREATIVE_RESOURCE_FETCH_TIMEOUT_MS },
    );

    if (response.status >= 300 && response.status < 400) {
      const redirected = resolvePublicRedirectUrl(response.headers.get("location"), currentUrl);
      releaseFetchTimeout(response);
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
  const primaryResult = withCreativeSourceFingerprint(
    await captureCreativeTextFromSource(env, url, ad),
    ad,
  );
  const creativeImageUrl = ad.creativeImageUrl?.trim() ?? "";
  const primaryReasonCode =
    typeof primaryResult?.metadata.unreadableReasonCode === "string"
      ? primaryResult.metadata.unreadableReasonCode
      : null;
  if (
    primaryResult?.text ||
    !creativeImageUrl ||
    creativeImageUrl === url.trim() ||
    primaryReasonCode === "ocr_binding_missing" ||
    primaryResult?.metadata.storedCreativeImageAttempted === true
  ) {
    return primaryResult;
  }

  const fallbackResult = withCreativeSourceFingerprint(
    await captureCreativeTextFromSource(env, creativeImageUrl, ad),
    ad,
  );
  if (!fallbackResult) return primaryResult;

  return {
    ...fallbackResult,
    metadata: {
      ...fallbackResult.metadata,
      sourceFallbackAttempted: true,
      sourceFallbackSucceeded: Boolean(fallbackResult.text),
      ...(primaryReasonCode
        ? { sourceFallbackFromReasonCode: primaryReasonCode }
        : {}),
    },
  };
}

async function captureCreativeTextFromSource(
  env: CreativeTextEnv,
  url: string,
  ad: KnownAdText,
): Promise<CreativeTextCaptureResult | null> {
  const capturedAt = new Date().toISOString();
  if (!url) {
    return createMissingCreativeCaptureResult(ad);
  }
  if (!/^https?:\/\//i.test(url)) {
    return buildUnreadableCreativeResult(
      "creative_capture_url_invalid",
      ad.creativeImageUrl ?? null,
      capturedAt,
    );
  }

  try {
    const response = await fetchPublicCreativeResource(url, {
      "user-agent": "0509-bot/1.0 (+https://0509.io)",
    });

    if (!response) {
      return buildUnreadableCreativeResult(
        "creative_snapshot_fetch_failed",
        ad.creativeImageUrl ?? null,
        capturedAt,
      );
    }
    if (!response.ok) {
      const fetchStatus = response.status;
      releaseFetchTimeout(response);
      return buildUnreadableCreativeResult(
        "creative_snapshot_http_error",
        ad.creativeImageUrl ?? null,
        capturedAt,
        { fetchStatus },
      );
    }

    const responseUrl = response.url || url;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().startsWith("image/")) {
      const image = await readDirectCreativeImage(response, responseUrl, contentType);
      if (!image) {
        return buildUnreadableCreativeResult(
          "creative_image_invalid_or_oversized",
          responseUrl,
          capturedAt,
          { fetchStatus: response.status, extractionPath: "direct_image_ocr" },
        );
      }
      const ocr = await extractCreativeTextFromImage(env, image, ad);
      return buildOcrCaptureResult(ocr, {
        capturedAt,
        fetchStatus: response.status,
        extractionPath: "direct_image_ocr",
        fallbackImageUrl: responseUrl,
      });
    }

    const genericPayload = isGenericCreativeContentType(contentType)
      ? await readGenericCreativeResource(response, responseUrl)
      : null;
    if (genericPayload?.image) {
      const ocr = await extractCreativeTextFromImage(env, genericPayload.image, ad);
      return buildOcrCaptureResult(ocr, {
        capturedAt,
        fetchStatus: response.status,
        extractionPath: "direct_image_ocr",
        fallbackImageUrl: responseUrl,
      });
    }
    const html = isGenericCreativeContentType(contentType)
      ? genericPayload?.html ?? null
      : await readResponseTextWithinLimit(
          response,
          MAX_CREATIVE_SNAPSHOT_HTML_BYTES,
        );
    if (!html) {
      return buildUnreadableCreativeResult(
        "creative_snapshot_empty_or_oversized",
        ad.creativeImageUrl ?? null,
        capturedAt,
        { fetchStatus: response.status },
      );
    }
    const creativeImageCandidates = mergeCreativeImageCandidates(
      ad.creativeImageUrl,
      extractCreativeImageCandidates(html, responseUrl),
    );
    const creativeImageUrl =
      creativeImageCandidates.find(
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
          capturedAt,
          fetchStatus: response.status,
          extractionPath: "snapshot_html",
          extractionStatus: "readable",
        },
      };
    }

    const extractedFromImage = await extractCreativeTextFromSnapshotImage(
      env,
      responseUrl,
      creativeImageCandidates,
      ad,
    );
    return buildOcrCaptureResult(extractedFromImage, {
      capturedAt,
      fetchStatus: response.status,
      extractionPath: "snapshot_image_ocr",
      fallbackImageUrl: creativeImageUrl,
    });
  } catch (error) {
    logCreativeCaptureWarning("creative_snapshot_fetch_failed", error);
    return buildUnreadableCreativeResult(
      "creative_snapshot_fetch_failed",
      ad.creativeImageUrl ?? null,
      capturedAt,
    );
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
  candidates: string[],
  ad: KnownAdText,
): Promise<CreativeOcrResult> {
  if (candidates.length === 0) {
    return {
      text: null,
      imageUrl: null,
      reasonCode: "creative_image_missing",
      metadata: { ocrAttemptCount: 0 },
    };
  }
  if (!env.AI) {
    return {
      text: null,
      imageUrl: candidates.find((candidate) => !candidate.startsWith("data:")) ?? null,
      reasonCode: "ocr_binding_missing",
      metadata: { ocrAttemptCount: 0 },
    };
  }

  let lastReason: CreativeUnreadableReasonCode = "creative_image_invalid_or_oversized";
  let lastMetadata: Record<string, unknown> = { ocrAttemptCount: 0 };
  let lastImageUrl =
    candidates.find((candidate) => !candidate.startsWith("data:")) ?? null;
  for (const candidate of candidates.slice(0, MAX_CREATIVE_IMAGE_CANDIDATES)) {
    try {
      const image = await fetchCreativeImagePayload(candidate, snapshotUrl);
      if (!image) {
        continue;
      }
      const ocr = await extractCreativeTextFromImage(env, image, ad);
      if (ocr.text) return ocr;
      lastReason = ocr.reasonCode ?? lastReason;
      lastMetadata = ocr.metadata;
      lastImageUrl = ocr.imageUrl ?? lastImageUrl;
    } catch (error) {
      lastReason = "creative_image_invalid_or_oversized";
      logCreativeCaptureWarning(lastReason, error);
      continue;
    }
  }

  return {
    text: null,
    imageUrl: lastImageUrl,
    reasonCode: lastReason,
    metadata: {
      ...lastMetadata,
      storedCreativeImageAttempted: Boolean(
        ad.creativeImageUrl?.trim() &&
        candidates
          .slice(0, MAX_CREATIVE_IMAGE_CANDIDATES)
          .includes(ad.creativeImageUrl.trim()),
      ),
    },
  };
}

async function extractCreativeTextFromImage(
  env: CreativeTextEnv,
  image: CreativeImagePayload,
  ad: KnownAdText,
): Promise<CreativeOcrResult> {
  if (!env.AI) {
    return {
      text: null,
      imageUrl: image.imageUrl,
      reasonCode: "ocr_binding_missing",
      metadata: buildOcrMetadata(image, 0),
    };
  }

  let lastReason: CreativeUnreadableReasonCode = "ocr_provider_failed";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await promiseWithTimeout(
        env.AI.run(CREATIVE_TEXT_OCR_MODEL, {
          image: [...image.bytes],
          prompt: OCR_PROMPT,
          max_tokens: 256,
        }),
        CREATIVE_OCR_TIMEOUT_MS,
        "Creative OCR provider timed out.",
      );
      const rawDescription = readOcrDescription(response);
      if (!rawDescription.trim()) {
        lastReason = "ocr_empty_result";
        if (attempt === 1) continue;
        return {
          text: null,
          imageUrl: image.imageUrl,
          reasonCode: lastReason,
          metadata: buildOcrMetadata(image, attempt),
        };
      }

      const text = selectCreativeTextCandidates(splitTextLines(rawDescription), ad);
      if (!text) {
        return {
          text: null,
          imageUrl: image.imageUrl,
          reasonCode: "ocr_text_filtered",
          metadata: buildOcrMetadata(image, attempt),
        };
      }

      return {
        text,
        imageUrl: image.imageUrl,
        reasonCode: null,
        metadata: buildOcrMetadata(image, attempt),
      };
    } catch (error) {
      lastReason = "ocr_provider_failed";
      logCreativeCaptureWarning(lastReason, error, attempt);
      if (attempt === 1 && isTransientOcrError(error)) {
        await delay(CREATIVE_OCR_RETRY_BACKOFF_MS);
        continue;
      }
      return {
        text: null,
        imageUrl: image.imageUrl,
        reasonCode: lastReason,
        metadata: buildOcrMetadata(image, attempt),
      };
    }
  }

  return {
    text: null,
    imageUrl: image.imageUrl,
    reasonCode: lastReason,
    metadata: buildOcrMetadata(image, 2),
  };
}

async function readDirectCreativeImage(
  response: Response,
  imageUrl: string,
  contentType: string,
): Promise<CreativeImagePayload | null> {
  if (contentLengthExceeds(response.headers, MAX_CREATIVE_IMAGE_BYTES)) {
    releaseFetchTimeout(response);
    return null;
  }
  const bytes = await readResponseBytesWithinLimit(response, MAX_CREATIVE_IMAGE_BYTES);
  if (!bytes?.byteLength) return null;
  return {
    bytes,
    contentType,
    imageUrl,
    imageFetchStatus: response.status,
  };
}

async function readGenericCreativeResource(
  response: Response,
  imageUrl: string,
): Promise<{ html: string | null; image: CreativeImagePayload | null } | null> {
  if (contentLengthExceeds(response.headers, MAX_CREATIVE_IMAGE_BYTES)) {
    releaseFetchTimeout(response);
    return null;
  }
  const bytes = await readResponseBytesWithinLimit(
    response,
    MAX_CREATIVE_IMAGE_BYTES,
  );
  if (!bytes?.byteLength) return null;

  const detectedContentType = detectImageContentType(bytes);
  if (detectedContentType) {
    return {
      html: null,
      image: {
        bytes,
        contentType: detectedContentType,
        imageUrl,
        imageFetchStatus: response.status,
      },
    };
  }
  return {
    html:
      bytes.byteLength <= MAX_CREATIVE_SNAPSHOT_HTML_BYTES
        ? new TextDecoder().decode(bytes)
        : null,
    image: null,
  };
}

function isGenericCreativeContentType(contentType: string) {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    !normalized ||
    normalized === "application/octet-stream" ||
    normalized === "binary/octet-stream"
  );
}

function detectImageContentType(bytes: Uint8Array): string | null {
  if (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  const prefix = new TextDecoder("ascii").decode(bytes.slice(0, 12));
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (prefix.startsWith("BM")) {
    return "image/bmp";
  }
  if (
    (bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x2a &&
      bytes[3] === 0x00) ||
    (bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x2a)
  ) {
    return "image/tiff";
  }
  if (prefix.slice(4, 8) === "ftyp") {
    const brand = prefix.slice(8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "heic" || brand === "heix") return "image/heic";
  }
  return null;
}

function mergeCreativeImageCandidates(
  persistedFallback: string | null | undefined,
  discovered: string[],
) {
  const candidates = persistedFallback?.trim()
    ? [...discovered, persistedFallback.trim()]
    : discovered;
  return [...new Set(candidates)];
}

function withCreativeSourceFingerprint(
  result: CreativeTextCaptureResult | null,
  ad: KnownAdText,
) {
  const requestedSourceFingerprint = creativeCaptureSourceFingerprint(ad);
  const sourceFingerprint = creativeCaptureSourceFingerprint(
    {
      ...ad,
      creativeImageUrl: result?.imageUrl ?? ad.creativeImageUrl,
    },
  );
  if (!result || !sourceFingerprint) return result;
  return {
    ...result,
    metadata: {
      ...result.metadata,
      creativeSourceFingerprint: sourceFingerprint,
      ...(requestedSourceFingerprint
        ? { creativeRequestedSourceFingerprint: requestedSourceFingerprint }
        : {}),
    },
  };
}

function buildOcrCaptureResult(
  ocr: CreativeOcrResult,
  input: {
    capturedAt: string;
    extractionPath: "direct_image_ocr" | "snapshot_image_ocr";
    fallbackImageUrl: string | null;
    fetchStatus: number;
  },
): CreativeTextCaptureResult {
  const ocrImageUrl =
    ocr.imageUrl === "data:image"
      ? null
      : ocr.imageUrl;
  return {
    text: ocr.text,
    captureMethod: "ad_snapshot_fetch",
    extractorVersion: CREATIVE_TEXT_EXTRACTOR_VERSION,
    imageUrl: ocrImageUrl ?? input.fallbackImageUrl,
    metadata: {
      capturedAt: input.capturedAt,
      fetchStatus: input.fetchStatus,
      extractionPath: input.extractionPath,
      extractionStatus: ocr.text ? "readable" : "unreadable",
      ...(ocr.reasonCode ? { unreadableReasonCode: ocr.reasonCode } : {}),
      ...ocr.metadata,
    },
  };
}

function buildUnreadableCreativeResult(
  reasonCode: CreativeUnreadableReasonCode,
  imageUrl: string | null,
  capturedAt: string | null,
  metadata: Record<string, unknown> = {},
): CreativeTextCaptureResult {
  return {
    text: null,
    captureMethod: "ad_snapshot_fetch",
    extractorVersion: CREATIVE_TEXT_EXTRACTOR_VERSION,
    imageUrl,
    metadata: {
      ...(capturedAt ? { capturedAt } : {}),
      extractionStatus: "unreadable",
      unreadableReasonCode: reasonCode,
      ...metadata,
    },
  };
}

function buildOcrMetadata(image: CreativeImagePayload, ocrAttemptCount: number) {
  return {
    imageUrl: image.imageUrl,
    imageFetchStatus: image.imageFetchStatus,
    imageContentType: image.contentType,
    ocrProvider: "workers_ai",
    ocrModel: CREATIVE_TEXT_OCR_MODEL,
    ocrAttemptCount,
  };
}

function isTransientOcrError(error: unknown) {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number(error.status)
      : Number.NaN;
  if (status === 408 || status === 429 || status >= 500) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:3007|3008|3036|3040)\b|timeout|timed out|capacity|rate.?limit|temporar/i.test(
    message,
  );
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function logCreativeCaptureWarning(
  reasonCode: CreativeUnreadableReasonCode,
  error: unknown,
  attempt?: number,
) {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number(error.status)
      : null;
  console.warn(
    JSON.stringify({
      event: "creative_text_capture_warning",
      reasonCode,
      ocrModel: reasonCode.startsWith("ocr_") ? CREATIVE_TEXT_OCR_MODEL : undefined,
      attempt,
      status: Number.isFinite(status) ? status : undefined,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }),
  );
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
    "user-agent": "0509-bot/1.0 (+https://0509.io)",
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    referer: snapshotUrl,
  });
  if (!response?.ok) {
    if (response) releaseFetchTimeout(response);
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("image/")) {
    releaseFetchTimeout(response);
    return null;
  }

  if (contentLengthExceeds(response.headers, MAX_CREATIVE_IMAGE_BYTES)) {
    releaseFetchTimeout(response);
    return null;
  }

  const bytes = await readResponseBytesWithinLimit(response, MAX_CREATIVE_IMAGE_BYTES);
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }

  return {
    bytes,
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
  if (base64DecodedLengthExceeds(match[2], MAX_CREATIVE_IMAGE_BYTES)) {
    return null;
  }

  const bytes = Uint8Array.from(atob(match[2]), (character) =>
    character.charCodeAt(0),
  );
  if (bytes.byteLength > MAX_CREATIVE_IMAGE_BYTES) {
    return null;
  }

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
    // Accept any script family covered by language-classifier (Latin, Indic,
    // Arabic, CJK, Cyrillic, Hangul, Thai, Hebrew, Greek, Ethiopic, …).
    if (!hasClassifierScriptChar(normalized)) {
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

function normalizeLine(value: string | null | undefined) {
  return decodeHtml(value ?? "").replace(/\s+/g, " ").trim();
}

function stripTags(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .trim();
}
