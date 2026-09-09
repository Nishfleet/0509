/**
 * Rasterize the per-route social-card SVG to PNG (issue #2089).
 *
 * The /ads/:domain and /timeline/:domain cards are served as PNG so social
 * scrapers (Facebook, X, LinkedIn) render them — they refuse SVG og:images.
 * This module wraps `@resvg/resvg-wasm` (the WebAssembly build of resvg) and
 * is imported ONLY by the worker (`workers/app.ts`), never by the node test
 * suites: the wasm-bindgen glue's `wbg` import is not resolvable in the node
 * vitest environment, so keeping the rasterizer out of `social-cards.server.ts`
 * lets the SVG-generation unit tests run in node while the worker serves PNG.
 *
 * The wasm module is instantiated once per isolate (module-level promise) and
 * the rasterized PNG is cached per card URL so repeat requests for the same
 * brand/score card don't re-render on every hit. The HTTP `cache-control` on
 * the card (max-age=3600) already absorbs most repeat traffic at the edge;
 * this in-isolate cache just avoids re-rasterizing within a single isolate's
 * lifetime.
 */
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import interBoldRaw from "../assets/fonts/Inter-Bold.ttf?raw";
import interSemiBoldRaw from "../assets/fonts/Inter-SemiBold.ttf?raw";

let resvgReady: Promise<void> | null = null;

/**
 * Embedded Inter fonts for the card text. The card SVG uses
 * `font-family="Inter, Arial, sans-serif"` with font-weight 800 (wordmark +
 * headline) and 600 (subline). Workerd has no system fonts, so resvg would
 * silently skip every `<text>` node and ship a blank gradient card; embedding
 * the two weights via `fontBuffers` (with `loadSystemFonts: false`) makes the
 * brand name and headline actually render.
 *
 * The fonts are imported with Vite's `?raw` (the raw file bytes as a string)
 * because `?arraybuffer` is not honoured for `.ttf` in the workerd test
 * environment — it returns the asset URL string instead. `?raw` yields the
 * exact TTF bytes, which we convert to a `Uint8Array` once at module load.
 */
function rawToBytes(raw: string): Uint8Array {
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i) & 0xff;
  return bytes;
}

const CARD_FONT_BUFFERS: Uint8Array[] = [
  rawToBytes(interBoldRaw),
  rawToBytes(interSemiBoldRaw),
];

export { CARD_FONT_BUFFERS };

/** Initialize the wasm once; reset the promise on failure so a retry is possible. */
function ensureResvg(): Promise<void> {
  if (!resvgReady) {
    resvgReady = initWasm(resvgWasm).catch((error) => {
      resvgReady = null;
      throw error;
    });
  }
  return resvgReady;
}

/** Bounded in-isolate cache of rasterized PNGs, keyed by the card URL. */
const PNG_CACHE = new Map<string, Uint8Array>();
const PNG_CACHE_MAX = 256;

/**
 * Rasterize an SVG card body to PNG bytes. The SVG is already 1200×630, so we
 * render at original size and return the PNG buffer.
 */
export async function rasterizeSocialCardPng(svg: string): Promise<Uint8Array> {
  await ensureResvg();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      fontBuffers: CARD_FONT_BUFFERS,
      loadSystemFonts: false,
      defaultFontFamily: "Inter",
      sansSerifFamily: "Inter",
    },
  });
  return resvg.render().asPng();
}

/**
 * Rasterize and cache a card by its full request URL. Returns the PNG bytes.
 * The cache is bounded (PNG_CACHE_MAX entries, evicting the oldest) so a
 * long-lived isolate with many distinct brand cards can't grow unbounded.
 */
export async function rasterizeSocialCardPngCached(url: string, svg: string): Promise<Uint8Array> {
  const cached = PNG_CACHE.get(url);
  if (cached) return cached;
  const png = await rasterizeSocialCardPng(svg);
  if (PNG_CACHE.size >= PNG_CACHE_MAX) {
    const oldest = PNG_CACHE.keys().next().value;
    if (oldest !== undefined) PNG_CACHE.delete(oldest);
  }
  PNG_CACHE.set(url, png);
  return png;
}
