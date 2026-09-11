import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression: per-chunk `new TextDecoder()` corrupts multi-byte UTF-8.
 *
 * `safeFetchDocument` used to decode every stream chunk with a fresh
 * `TextDecoder` and no `{ stream: true }`. TCP chunk boundaries routinely fall
 * inside a multi-byte UTF-8 sequence (e.g. "₹" = E2 82 B9 split 2+1). Each
 * half then decodes to U+FFFD replacement chars, and because the split point
 * varies run to run the same unchanged page produces a different
 * `visibleTextHash` — phantom `website_page_changed` alerts that never
 * converge.
 *
 * The fix accumulates raw bytes and decodes once over the whole stream, which
 * makes the result chunk-boundary-independent (and makes the byte cap honest:
 * it now counts bytes, not UTF-16 code units).
 */

const { mockFetch, releaseSpy } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  releaseSpy: vi.fn(),
}));

vi.mock("~/lib/fetch-timeout.server", () => ({
  fetchWithTimeout: mockFetch,
  releaseFetchTimeout: releaseSpy,
}));

// Bypass DNS / public-address resolution so the fetch path is deterministic.
vi.mock("~/lib/public-url.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/public-url.server")>();
  return {
    ...actual,
    normalizePublicHttpUrl: (value: string | URL) => {
      try {
        return new URL(value.toString());
      } catch {
        return null;
      }
    },
    resolvePublicHttpUrl: async (value: string | URL) =>
      new URL(value.toString()),
  };
});

import { safeFetchDocument } from "~/lib/competitor-site-monitor.server";

/** Build a Response whose body streams the given byte chunks verbatim, so the
 * test controls exactly where chunk boundaries fall. */
function responseFromChunks(
  chunks: Uint8Array[],
  init: ResponseInit = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

const encoder = new TextEncoder();

/** Split a UTF-8 string's bytes at the given absolute byte offsets. */
function splitBytes(text: string, offsets: number[]): Uint8Array[] {
  const bytes = encoder.encode(text);
  const chunks: Uint8Array[] = [];
  let prev = 0;
  for (const offset of offsets) {
    chunks.push(bytes.slice(prev, offset));
    prev = offset;
  }
  chunks.push(bytes.slice(prev));
  return chunks;
}

beforeEach(() => {
  mockFetch.mockReset();
  releaseSpy.mockReset();
});

describe("safeFetchDocument multi-byte UTF-8 chunk boundaries", () => {
  it("decodes a ₹ split across two chunks without replacement chars", async () => {
    // "₹" is E2 82 B9 — split after the first two bytes, exactly as the
    // finding's repro describes.
    mockFetch.mockResolvedValue(
      responseFromChunks([
        new Uint8Array([0xe2, 0x82]),
        new Uint8Array([0xb9]),
        encoder.encode("1,999"),
      ]),
    );

    const result = await safeFetchDocument("https://competitor.example/price");

    expect(result.ok).toBe(true);
    expect(result.body).toContain("₹");
    expect(result.body).not.toContain("\uFFFD");
    expect(result.body).toBe("₹1,999");
  });

  it("produces identical output for every chunk boundary in a multi-byte page", async () => {
    // Core market content: Devanagari + CJK + the rupee sign, all multi-byte.
    const page = "<html><body><h1>कीमत</h1><p>₹1,999 割引</p></body></html>";
    const totalBytes = encoder.encode(page).byteLength;

    const results: string[] = [];
    // Every possible split point of this page's byte stream.
    for (let offset = 1; offset < totalBytes; offset += 1) {
      mockFetch.mockResolvedValue(
        responseFromChunks(splitBytes(page, [offset])),
      );
      const result = await safeFetchDocument("https://competitor.example/hi");
      expect(result.ok, `offset ${offset}`).toBe(true);
      results.push(result.body as string);
    }

    // Chunk-boundary independence: one stable decoded string for all splits.
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(page);
    expect(results[0]).not.toContain("\uFFFD");
  });

  it("enforces maxBytes on bytes, not UTF-16 code units", async () => {
    // 40 CJK chars = 120 UTF-8 bytes but only 40 UTF-16 code units. With the
    // old string-length check a 120-byte page slipped under a 100-byte cap.
    const cjk = "漢".repeat(40);
    expect(encoder.encode(cjk).byteLength).toBe(120);
    expect(cjk.length).toBe(40);

    mockFetch.mockResolvedValue(responseFromChunks([encoder.encode(cjk)]));
    const overCap = await safeFetchDocument("https://competitor.example/cjk", {
      maxBytes: 100,
    });
    expect(overCap.ok).toBe(false);
    expect(overCap.refusedReason).toBe("body_too_large");

    // The same bytes under a cap that genuinely admits them still decode.
    mockFetch.mockResolvedValue(responseFromChunks([encoder.encode(cjk)]));
    const underCap = await safeFetchDocument("https://competitor.example/cjk", {
      maxBytes: 120,
    });
    expect(underCap.ok).toBe(true);
    expect(underCap.body).toBe(cjk);
  });

  it("counts the byte cap across chunk boundaries", async () => {
    // Three 50-byte chunks = 150 bytes; a 100-byte cap must trip even though
    // no single chunk exceeds it.
    const chunk = new Uint8Array(50).fill(0x61);
    mockFetch.mockResolvedValue(responseFromChunks([chunk, chunk, chunk]));

    const result = await safeFetchDocument("https://competitor.example/big", {
      maxBytes: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.refusedReason).toBe("body_too_large");
  });
});
