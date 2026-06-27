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

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function contentLengthExceeds(headers: Headers, maxBytes: number) {
  const raw = headers.get("content-length");
  if (!raw) return false;

  const length = Number.parseInt(raw, 10);
  return Number.isFinite(length) && length > maxBytes;
}

export function base64DecodedLengthExceeds(value: string, maxBytes: number) {
  const normalizedLength = value.trim().replace(/=+$/, "").length;
  return Math.floor((normalizedLength * 3) / 4) > maxBytes;
}
