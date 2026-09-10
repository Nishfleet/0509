import { releaseFetchTimeout } from "~/lib/fetch-timeout.server";

export async function readResponseTextWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const bytes = await readResponseBytesWithinLimit(response, maxBytes);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

export async function readResponseJsonWithinLimit<T = unknown>(
  response: Response,
  maxBytes: number,
): Promise<T | null> {
  let text: string | null;
  try {
    text = await readResponseTextWithinLimit(response, maxBytes);
  } catch {
    return null;
  }
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function readResponseBytesWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (contentLengthExceeds(response.headers, maxBytes)) {
    releaseFetchTimeout(response);
    return null;
  }

  if (!response.body) {
    try {
      const buffer = await response.arrayBuffer();
      return buffer.byteLength <= maxBytes ? new Uint8Array(buffer) : null;
    } finally {
      releaseFetchTimeout(response);
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    releaseFetchTimeout(response);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

/**
 * Read a response body up to `maxBytes`, KEEPING the head of the body when
 * the stream overflows instead of discarding it (issue #1538). The landing
 * extractor's signals — title, OG tags, CTA anchors, price — sit near the
 * top of real pages, so the first `maxBytes` of an oversized page is still
 * worth parsing; bailing on size alone discarded real pages whole.
 *
 * Returns `null` only when the body is genuinely empty (0 bytes). When the
 * body exceeded the cap the result is `{ text, truncated: true }` — the
 * caller decides whether a truncated document is usable.
 */
export async function readResponseTextCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean } | null> {
  if (!response.body) {
    if (contentLengthExceeds(response.headers, maxBytes)) {
      // No stream to bound the read against — report the overflow honestly
      // without buffering an unbounded body into memory.
      releaseFetchTimeout(response);
      return { text: "", truncated: true };
    }
    try {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0) return null;
      const truncated = buffer.byteLength > maxBytes;
      const bytes = new Uint8Array(
        buffer,
        0,
        Math.min(buffer.byteLength, maxBytes),
      );
      return { text: new TextDecoder().decode(bytes), truncated };
    } finally {
      releaseFetchTimeout(response);
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      if (totalBytes + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - totalBytes));
        totalBytes = maxBytes;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
    releaseFetchTimeout(response);
  }

  if (totalBytes === 0) return null;

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { text: new TextDecoder().decode(bytes), truncated };
}

export async function readRequestTextWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const bytes = await readRequestBytesWithinLimit(request, maxBytes);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

export async function readRequestBytesWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (contentLengthExceeds(request.headers, maxBytes)) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }

  if (!request.body) {
    const text = await request.text();
    return utf8ByteLength(text) <= maxBytes ? new TextEncoder().encode(text) : null;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function contentLengthExceeds(headers: Headers, maxBytes: number) {
  const raw = headers.get("content-length");
  if (!raw) return false;

  const length = Number.parseInt(raw, 10);
  return Number.isFinite(length) && length > maxBytes;
}

const DATA_URL_BASE64_PREFIX = /^data:[^;,]*(?:;[^;,]*)*;base64,/i;

/**
 * Browserless and other screenshot providers wrap base64 at 76 columns,
 * prefix a data URL, or emit URL-safe alphabet. `atob` throws
 * InvalidCharacterError on any of those, which used to look like a missing
 * screenshot (`screenshot_decode_failed`) even when the bytes were valid.
 */
export function normalizeBase64Payload(value: string) {
  let normalized = value.trim();
  const dataUrl = DATA_URL_BASE64_PREFIX.exec(normalized);
  if (dataUrl) {
    normalized = normalized.slice(dataUrl[0].length);
  }
  normalized = normalized.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  if (pad) {
    normalized += "=".repeat(4 - pad);
  }
  return normalized;
}

export function decodeBase64ToUint8Array(value: string) {
  const binary = atob(normalizeBase64Payload(value));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64DecodedLengthExceeds(value: string, maxBytes: number) {
  const normalizedLength = normalizeBase64Payload(value).replace(/=+$/, "").length;
  return Math.floor((normalizedLength * 3) / 4) > maxBytes;
}
