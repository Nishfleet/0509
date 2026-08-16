import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isValidProofScreenshotKey,
  parseProofScreenshotPathname,
  proofScreenshotSrc,
} from "~/lib/proof-screenshot";
import { serveProofScreenshot } from "~/lib/proof-screenshot.server";

const SAMPLE_KEY = "landing-pages/2026-08-11/3f2a1c0e-9d3b-4f5e-8a7b-6c5d4e3f2a10.jpeg";

describe("proof screenshot keys and paths", () => {
  it("accepts the producer's landing-pages R2 key shape", () => {
    expect(isValidProofScreenshotKey(SAMPLE_KEY)).toBe(true);
  });

  it("rejects traversal, non-landing-pages prefixes and wrong extensions", () => {
    expect(isValidProofScreenshotKey("../etc/passwd")).toBe(false);
    expect(isValidProofScreenshotKey("landing-pages/2026-08-11/../../x.jpeg")).toBe(false);
    expect(isValidProofScreenshotKey("creatives/2026-08-11/x.jpeg")).toBe(false);
    expect(isValidProofScreenshotKey("landing-pages/2026-08-11/x.svg")).toBe(false);
    expect(isValidProofScreenshotKey("landing-pages/not-a-date/x.jpeg")).toBe(false);
    expect(isValidProofScreenshotKey("")).toBe(false);
  });

  it("builds an app-relative src and round-trips through the pathname parser", () => {
    const src = proofScreenshotSrc(SAMPLE_KEY);
    expect(src).toBe(`/artifacts/proof/${encodeURIComponent(SAMPLE_KEY)}`);

    const parsed = parseProofScreenshotPathname(src!);
    expect(parsed).toBe(SAMPLE_KEY);
  });

  it("returns null for missing or malformed keys instead of a broken image", () => {
    expect(proofScreenshotSrc(null)).toBeNull();
    expect(proofScreenshotSrc(undefined)).toBeNull();
    expect(proofScreenshotSrc("../etc/passwd")).toBeNull();
    expect(proofScreenshotSrc("landing-pages/2026-08-11/x.svg")).toBeNull();
  });

  it("only parses the proof artifact route", () => {
    expect(parseProofScreenshotPathname("/artifacts/creatives/ad_1")).toBeNull();
    expect(parseProofScreenshotPathname("/app/watchlists")).toBeNull();
    expect(parseProofScreenshotPathname("/artifacts/proof/")).toBeNull();
  });
});

describe("serveProofScreenshot", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when R2 is missing so the caller's fallback runs", async () => {
    const response = await serveProofScreenshot({} as never, new Request("https://0509.io/x"), SAMPLE_KEY);
    expect(response).toBeNull();
  });

  it("rejects non-raster stored types", async () => {
    const get = vi.fn().mockResolvedValue({
      httpMetadata: { contentType: "text/html" },
      etag: null,
      body: null,
    });
    const response = await serveProofScreenshot(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request(`https://0509.io/artifacts/proof/${encodeURIComponent(SAMPLE_KEY)}`),
      SAMPLE_KEY,
    );
    expect(response?.status).toBe(415);
    expect(get).toHaveBeenCalledWith(SAMPLE_KEY);
  });

  it("serves a raster screenshot with immutable caching and etag", async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });
    const get = vi.fn().mockResolvedValue({
      httpMetadata: { contentType: "image/jpeg", cacheControl: undefined },
      etag: '"abc123"',
      body,
    });
    const response = await serveProofScreenshot(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request(`https://0509.io/artifacts/proof/${encodeURIComponent(SAMPLE_KEY)}`),
      SAMPLE_KEY,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/jpeg");
    expect(response?.headers.get("cache-control")).toContain("max-age=31536000");
    expect(response?.headers.get("etag")).toBe('"abc123"');
  });

  it("returns 404 for a missing object", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const response = await serveProofScreenshot(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request("https://0509.io/artifacts/proof/x"),
      SAMPLE_KEY,
    );
    expect(response?.status).toBe(404);
  });

  it("supports HEAD without a body", async () => {
    const get = vi.fn().mockResolvedValue({
      httpMetadata: { contentType: "image/jpeg" },
      etag: null,
      body: null,
    });
    const response = await serveProofScreenshot(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request(`https://0509.io/artifacts/proof/${encodeURIComponent(SAMPLE_KEY)}`, { method: "HEAD" }),
      SAMPLE_KEY,
    );
    expect(response?.status).toBe(200);
    expect(response?.body).toBeNull();
  });

  it("refuses methods other than GET and HEAD", async () => {
    const get = vi.fn();
    const response = await serveProofScreenshot(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request("https://0509.io/artifacts/proof/x", { method: "POST" }),
      SAMPLE_KEY,
    );
    expect(response?.status).toBe(405);
    expect(get).not.toHaveBeenCalled();
  });

  it("returns null for an invalid key without touching R2", async () => {
    const get = vi.fn();
    const response = await serveProofScreenshot(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request("https://0509.io/artifacts/proof/x"),
      "../etc/passwd",
    );
    expect(response).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
