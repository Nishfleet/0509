import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureCreativeText,
  CREATIVE_TEXT_EXTRACTOR_VERSION,
  extractCreativeTextFromSnapshotHtml,
} from "~/lib/creative-text.server";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

// The SSRF guard resolves every hostname through DNS-over-HTTPS before
// fetching, so fetch mocks must answer DNS queries with a public address.
function mockFetchWithDns(handler: (url: string) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith(DNS_JSON_ENDPOINT)) {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
      const addresses = type === "A" ? ["93.184.216.34"] : [];
      return new Response(
        JSON.stringify({
          Answer: addresses.map((address) => ({ data: address, type: type === "A" ? 1 : 28 })),
        }),
        { status: 200, headers: { "content-type": "application/dns-json" } },
      );
    }
    return handler(url);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("extractCreativeTextFromSnapshotHtml", () => {
  it("extracts likely creative-overlay copy while dropping known ad text and chrome", () => {
    const html = `
      <html>
        <body>
          <div>Sponsored</div>
          <div>boAt</div>
          <div>Bass bhi. Battery bhi.</div>
          <div>Learn more</div>
          <div>60 Hours Playback</div>
          <div>Only ₹999</div>
          <button>Shop now</button>
        </body>
      </html>
    `;

    const creativeText = extractCreativeTextFromSnapshotHtml(html, {
      advertiser: "boAt",
      body: "Bass bhi, battery bhi.",
      previewHeadline: "Bass bhi. Battery bhi.",
      previewSubhead: "Launch pricing",
      cta: "Shop now",
    });

    expect(creativeText).toBe("60 Hours Playback\nOnly ₹999");
  });

  it("returns null when no distinct creative text remains after filtering", () => {
    const html = `
      <html>
        <body>
          <div>Sponsored</div>
          <div>boAt</div>
          <div>Bass bhi. Battery bhi.</div>
          <button>Shop now</button>
        </body>
      </html>
    `;

    const creativeText = extractCreativeTextFromSnapshotHtml(html, {
      advertiser: "boAt",
      body: "Bass bhi, battery bhi.",
      previewHeadline: "Bass bhi. Battery bhi.",
      previewSubhead: "Launch pricing",
      cta: "Shop now",
    });

    expect(creativeText).toBeNull();
  });

  it("keeps Arabic creative-overlay lines (classifier global script)", () => {
    const html = `
      <html>
        <body>
          <div>Sponsored</div>
          <div>خصم حصري اليوم</div>
          <div>وفر 50٪ الآن</div>
          <button>تسوق الآن</button>
        </body>
      </html>
    `;

    const creativeText = extractCreativeTextFromSnapshotHtml(html, {
      advertiser: "Brand",
      body: "عرض خاص",
      previewHeadline: "عرض خاص",
      previewSubhead: "",
      cta: "تسوق الآن",
    });

    expect(creativeText).toContain("خصم حصري اليوم");
    expect(creativeText).toContain("وفر 50٪ الآن");
  });

  it("keeps CJK creative-overlay lines (Han)", () => {
    const html = `
      <html>
        <body>
          <div>Sponsored</div>
          <div>限时特惠优惠活动中</div>
          <div>全场立减50元</div>
          <button>立即购买</button>
        </body>
      </html>
    `;

    const creativeText = extractCreativeTextFromSnapshotHtml(html, {
      advertiser: "Brand",
      body: "新品上市",
      previewHeadline: "新品上市",
      previewSubhead: "",
      cta: "立即购买",
    });

    expect(creativeText).toContain("限时特惠优惠活动中");
    expect(creativeText).toContain("全场立减50元");
  });

  it("keeps Cyrillic creative-overlay lines", () => {
    const html = `
      <html>
        <body>
          <div>Sponsored</div>
          <div>Скидка 50% сегодня</div>
          <div>Бесплатная доставка</div>
          <button>Купить</button>
        </body>
      </html>
    `;

    const creativeText = extractCreativeTextFromSnapshotHtml(html, {
      advertiser: "Brand",
      body: "Новая коллекция",
      previewHeadline: "Новая коллекция",
      previewSubhead: "",
      cta: "Купить",
    });

    expect(creativeText).toContain("Скидка 50% сегодня");
    expect(creativeText).toContain("Бесплатная доставка");
  });
});

describe("captureCreativeText", () => {
  it("records an unreadable reason when the stored capture URL is invalid", async () => {
    const result = await captureCreativeText(
      {
        AI: undefined,
      } as never,
      "not-a-public-http-url",
      {
        advertiser: "Nykaa",
        body: "",
        previewHeadline: "",
        previewSubhead: "",
        cta: "",
      },
    );

    expect(result).toMatchObject({
      text: null,
      metadata: {
        extractionStatus: "unreadable",
        unreadableReasonCode: "creative_capture_url_invalid",
      },
    });
  });

  it("fetches the ad snapshot and returns best-effort creative text metadata", async () => {
    mockFetchWithDns(
      () =>
        new Response(
          `
          <html>
            <body>
              <div>Sponsored</div>
              <div>Launch Sale</div>
              <div>Flat ₹400 Off</div>
              <button>Buy now</button>
            </body>
          </html>
        `,
          { status: 200 },
        ),
    );

    const result = await captureCreativeText(
      {
        AI: undefined,
      } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "Glow Days are live.",
        previewHeadline: "Festive glow, without the guesswork.",
        previewSubhead: "Upto 50% off.",
        cta: "Shop now",
      },
    );

    expect(result).toMatchObject({
      text: "Launch Sale\nFlat ₹400 Off",
      captureMethod: "ad_snapshot_fetch",
      extractorVersion: CREATIVE_TEXT_EXTRACTOR_VERSION,
      metadata: {
        fetchStatus: 200,
      },
    });
  });

  it("falls back to the stored creative image when the snapshot fetch fails", async () => {
    const aiRun = vi.fn().mockResolvedValue({
      description: "Fallback Creative\n40% OFF",
    });
    mockFetchWithDns((url) => {
      if (url.includes("facebook.example.com")) {
        return new Response("expired snapshot", { status: 404 });
      }
      return new Response(Uint8Array.from([255, 216, 255, 217]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });

    const result = await captureCreativeText(
      { AI: { run: aiRun } } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "",
        previewHeadline: "",
        previewSubhead: "",
        cta: "",
        creativeImageUrl: "https://cdn.example.com/creative.jpg",
      },
    );

    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      text: "Fallback Creative\n40% OFF",
      imageUrl: "https://cdn.example.com/creative.jpg",
      metadata: {
        extractionStatus: "readable",
        extractionPath: "direct_image_ocr",
        sourceFallbackAttempted: true,
        sourceFallbackFromReasonCode: "creative_snapshot_http_error",
      },
    });
  });

  it("does not re-OCR the stored creative image after snapshot OCR already tried it", async () => {
    const aiRun = vi.fn().mockResolvedValue({ description: "" });
    mockFetchWithDns((url) => {
      if (url.includes("cdn.example.com")) {
        return new Response(Uint8Array.from([255, 216, 255, 217]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      return new Response("<html><body><div>Nykaa</div></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });

    const result = await captureCreativeText(
      { AI: { run: aiRun } } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "",
        previewHeadline: "",
        previewSubhead: "",
        cta: "",
        creativeImageUrl: "https://cdn.example.com/creative.jpg",
      },
    );

    expect(aiRun).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      text: null,
      imageUrl: "https://cdn.example.com/creative.jpg",
      metadata: {
        extractionPath: "snapshot_image_ocr",
        ocrAttemptCount: 2,
        unreadableReasonCode: "ocr_empty_result",
      },
    });
    expect(result?.metadata).not.toHaveProperty("sourceFallbackAttempted");
  });

  it("falls back to Workers AI OCR when the snapshot HTML has no distinct creative text", async () => {
    const aiRun = vi.fn().mockResolvedValue({
      description: "Launch Sale\nFlat ₹400 Off",
    });

    mockFetchWithDns((url) => {
      if (url.includes("cdn.example.com")) {
        return new Response(Uint8Array.from([255, 216, 255, 217]), {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
          },
        });
      }

      return new Response(
        `
            <html>
              <head>
                <meta property="og:image" content="https://cdn.example.com/creative.jpg" />
              </head>
              <body>
                <div>Sponsored</div>
                <div>Nykaa</div>
                <button>Shop now</button>
              </body>
            </html>
          `,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    });

    const result = await captureCreativeText(
      {
        AI: {
          run: aiRun,
        },
      } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "Glow Days are live.",
        previewHeadline: "Festive glow, without the guesswork.",
        previewSubhead: "Upto 50% off.",
        cta: "Shop now",
      },
    );

    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/llava-hf/llava-1.5-7b-hf",
      expect.objectContaining({
        max_tokens: 256,
        prompt: expect.stringContaining("Extract only the ad creative text"),
        image: [255, 216, 255, 217],
      }),
    );
    expect(result).toMatchObject({
      text: "Launch Sale\nFlat ₹400 Off",
      captureMethod: "ad_snapshot_fetch",
      extractorVersion: CREATIVE_TEXT_EXTRACTOR_VERSION,
      metadata: {
        fetchStatus: 200,
        imageUrl: "https://cdn.example.com/creative.jpg",
        ocrModel: "@cf/llava-hf/llava-1.5-7b-hf",
        ocrProvider: "workers_ai",
      },
    });
  });

  it("retries one transient Workers AI failure before declaring the image unreadable", async () => {
    const transient = Object.assign(new Error("Workers AI request timeout (3007)"), {
      status: 408,
    });
    const aiRun = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({
        description: "Launch Sale\nFlat ₹400 Off",
      });

    mockFetchWithDns((url) => {
      if (url.includes("cdn.example.com")) {
        return new Response(Uint8Array.from([255, 216, 255, 217]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      return new Response(
        '<meta property="og:image" content="https://cdn.example.com/creative.jpg"><div>Nykaa</div>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    const result = await captureCreativeText(
      { AI: { run: aiRun } } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "Glow Days are live.",
        previewHeadline: "Festive glow",
        previewSubhead: "",
        cta: "Shop now",
      },
    );

    expect(aiRun).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      text: "Launch Sale\nFlat ₹400 Off",
      metadata: {
        extractionStatus: "readable",
        ocrAttemptCount: 2,
      },
    });
  });

  it("OCRs a direct image-only creative instead of treating the bytes as snapshot HTML", async () => {
    const aiRun = vi.fn().mockResolvedValue({
      description: "Summer Drop\n30% OFF",
    });
    mockFetchWithDns(
      () =>
        new Response(Uint8Array.from([255, 216, 255, 217]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );

    const result = await captureCreativeText(
      { AI: { run: aiRun } } as never,
      "https://cdn.example.com/creative.jpg",
      {
        advertiser: "Nykaa",
        body: "",
        previewHeadline: "",
        previewSubhead: "",
        cta: "",
      },
    );

    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      text: "Summer Drop\n30% OFF",
      imageUrl: "https://cdn.example.com/creative.jpg",
      metadata: {
        extractionPath: "direct_image_ocr",
        extractionStatus: "readable",
      },
    });
  });

  it("retains the creative image and a persisted reason when the AI binding is missing", async () => {
    mockFetchWithDns((url) => {
      if (url.includes("cdn.example.com")) {
        return new Response(Uint8Array.from([255, 216, 255, 217]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      return new Response(
        '<meta property="og:image" content="https://cdn.example.com/creative.jpg"><div>Nykaa</div>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    const result = await captureCreativeText(
      { AI: undefined } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "",
        previewHeadline: "",
        previewSubhead: "",
        cta: "",
      },
    );

    expect(result).toMatchObject({
      text: null,
      imageUrl: "https://cdn.example.com/creative.jpg",
      metadata: {
        extractionStatus: "unreadable",
        unreadableReasonCode: "ocr_binding_missing",
        capturedAt: expect.any(String),
      },
    });
  });

  it("refuses oversized snapshot HTML before OCR", async () => {
    const aiRun = vi.fn();
    mockFetchWithDns(
      () =>
        new Response("<html></html>", {
          status: 200,
          headers: {
            "content-length": "750001",
          },
        }),
    );

    const result = await captureCreativeText(
      { AI: { run: aiRun } } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "Glow Days are live.",
        previewHeadline: "Festive glow",
        previewSubhead: "Upto 50% off.",
        cta: "Shop now",
      },
    );

    expect(result).toMatchObject({
      text: null,
      metadata: {
        extractionStatus: "unreadable",
        unreadableReasonCode: "creative_snapshot_empty_or_oversized",
      },
    });
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("refuses oversized OCR image payloads", async () => {
    vi.useFakeTimers();
    const aiRun = vi.fn();
    mockFetchWithDns((url) => {
      if (url.includes("cdn.example.com")) {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": "2000001",
          },
        });
      }

      return new Response(
        `
          <html>
            <head>
              <meta property="og:image" content="https://cdn.example.com/creative.jpg" />
            </head>
            <body><div>Nykaa</div><button>Shop now</button></body>
          </html>
        `,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    });

    const result = await captureCreativeText(
      { AI: { run: aiRun } } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "Glow Days are live.",
        previewHeadline: "Festive glow",
        previewSubhead: "Upto 50% off.",
        cta: "Shop now",
      },
    );

    expect(result).toMatchObject({
      text: null,
      imageUrl: "https://cdn.example.com/creative.jpg",
      metadata: {
        unreadableReasonCode: "creative_image_invalid_or_oversized",
      },
    });
    expect(aiRun).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases fetch timeout timers on redirected creative resources without a usable location", async () => {
    vi.useFakeTimers();
    const aiRun = vi.fn();
    mockFetchWithDns(
      () =>
        new Response(null, {
          status: 302,
        }),
    );

    const result = await captureCreativeText(
      { AI: { run: aiRun } } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "Glow Days are live.",
        previewHeadline: "Festive glow",
        previewSubhead: "Upto 50% off.",
        cta: "Shop now",
      },
    );

    expect(result).toMatchObject({
      text: null,
      metadata: {
        unreadableReasonCode: "creative_snapshot_fetch_failed",
      },
    });
    expect(aiRun).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases fetch timeout timers on non-image OCR candidates", async () => {
    vi.useFakeTimers();
    const aiRun = vi.fn();
    mockFetchWithDns((url) => {
      if (url.includes("cdn.example.com")) {
        return new Response("<html></html>", {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        });
      }

      return new Response(
        `
          <html>
            <head>
              <meta property="og:image" content="https://cdn.example.com/creative.jpg" />
            </head>
            <body><div>Nykaa</div><button>Shop now</button></body>
          </html>
        `,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    });

    const result = await captureCreativeText(
      { AI: { run: aiRun } } as never,
      "https://facebook.example.com/ad-snapshot",
      {
        advertiser: "Nykaa",
        body: "Glow Days are live.",
        previewHeadline: "Festive glow",
        previewSubhead: "Upto 50% off.",
        cta: "Shop now",
      },
    );

    expect(result).toMatchObject({
      text: null,
      imageUrl: "https://cdn.example.com/creative.jpg",
      metadata: {
        unreadableReasonCode: "creative_image_invalid_or_oversized",
      },
    });
    expect(aiRun).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
