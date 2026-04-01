import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureCreativeText,
  CREATIVE_TEXT_EXTRACTOR_VERSION,
  extractCreativeTextFromSnapshotHtml,
} from "~/lib/creative-text.server";

afterEach(() => {
  vi.restoreAllMocks();
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
});

describe("captureCreativeText", () => {
  it("fetches the ad snapshot and returns best-effort creative text metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
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

  it("falls back to Workers AI OCR when the snapshot HTML has no distinct creative text", async () => {
    const aiRun = vi.fn().mockResolvedValue({
      description: "Launch Sale\nFlat ₹400 Off",
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
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
        ),
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([255, 216, 255, 217]), {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
          },
        }),
      );

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
});
