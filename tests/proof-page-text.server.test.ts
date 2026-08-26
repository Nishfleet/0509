import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  isValidProofPageTextKey,
  parseProofPageTextPathname,
  proofPageTextSrc,
} from "~/lib/proof-page-text";
import { serveProofPageText } from "~/lib/proof-page-text.server";

const SAMPLE_KEY = "landing-pages/2026-08-11/3f2a1c0e9d3b4f5e8a7b6c5d4e3f2a10.html";

describe("proof page-text keys and paths", () => {
  it("accepts the producer's landing-pages HTML key shape", () => {
    expect(isValidProofPageTextKey(SAMPLE_KEY)).toBe(true);
  });

  it("rejects traversal, non-html, and wrong prefixes", () => {
    expect(isValidProofPageTextKey("../etc/passwd")).toBe(false);
    expect(isValidProofPageTextKey("landing-pages/2026-08-11/../../x.html")).toBe(false);
    expect(isValidProofPageTextKey("creatives/2026-08-11/x.html")).toBe(false);
    expect(isValidProofPageTextKey("landing-pages/2026-08-11/x.jpeg")).toBe(false);
    expect(isValidProofPageTextKey("")).toBe(false);
  });

  it("builds an app-relative href and round-trips through the pathname parser", () => {
    const src = proofPageTextSrc(SAMPLE_KEY);
    expect(src).toBe(`/artifacts/page-text/${encodeURIComponent(SAMPLE_KEY)}`);
    expect(parseProofPageTextPathname(src!)).toBe(SAMPLE_KEY);
  });
});

describe("serveProofPageText", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when R2 is missing so the caller's fallback runs", async () => {
    const response = await serveProofPageText({} as never, new Request("https://0509.io/x"), SAMPLE_KEY);
    expect(response).toBeNull();
  });

  it("serves stored HTML as text/plain so it cannot execute", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<script>alert(1)</script><h1>Sale</h1>"));
        controller.close();
      },
    });
    const get = vi.fn().mockResolvedValue({
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      etag: '"html-1"',
      body,
    });
    const response = await serveProofPageText(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request(`https://0509.io/artifacts/page-text/${encodeURIComponent(SAMPLE_KEY)}`),
      SAMPLE_KEY,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response?.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(response?.headers.get("etag")).toBe('"html-1"');
  });

  it("returns 404 for a missing object", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const response = await serveProofPageText(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request("https://0509.io/artifacts/page-text/x"),
      SAMPLE_KEY,
    );
    expect(response?.status).toBe(404);
  });

  it("refuses methods other than GET and HEAD", async () => {
    const get = vi.fn();
    const response = await serveProofPageText(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request("https://0509.io/artifacts/page-text/x", { method: "POST" }),
      SAMPLE_KEY,
    );
    expect(response?.status).toBe(405);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("worker wiring", () => {
  it("serves page-text artifacts next to proof screenshots", () => {
    const source = readFileSync("workers/app.ts", "utf8");
    expect(source).toContain("parseProofPageTextPathname");
    expect(source).toContain("serveProofPageText");
  });
});
