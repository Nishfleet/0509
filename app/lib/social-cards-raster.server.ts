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
 * the Cache API entry (issue #3782 — previously an in-isolate Map) avoids
 * re-rasterizing when a request lands on a cold isolate.
 */
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
// @ts-ignore — Vite inlines the .ttf as a base64 data URI with ?inline.
import interBoldDataUri from "../assets/fonts/Inter-Bold.ttf?inline";
// @ts-ignore — Vite inlines the .ttf as a base64 data URI with ?inline.
import interSemiBoldDataUri from "../assets/fonts/Inter-SemiBold.ttf?inline";
import {
  readCachedBytes,
  writeCachedBytes,
} from "~/lib/edge-object-cache.server";

let resvgReady: Promise<void> | null = null;

/**
 * Embedded Inter fonts for the card text. The card SVG uses
 * `font-family="Inter, Arial, sans-serif"` with font-weight 800 (wordmark +
 * headline) and 600 (subline). Workerd has no system fonts, so resvg would
 * silently skip every `<text>` node and ship a blank gradient card; embedding
 * the two weights via `fontBuffers` makes the brand name and headline render.
 *
 * Vite's `?inline` query bundles the .ttf as a `data:font/ttf;base64,...`
 * string (the workerd runtime has no filesystem, so `?arraybuffer` cannot be
 * used and `?raw` corrupts binary bytes). We decode the base64 payload once
 * at module load and hand the raw TrueType bytes to resvg.
 */
function dataUriToBytes(dataUri: string): Uint8Array {
  const marker = ";base64,";
  const offset = dataUri.indexOf(marker);
  if (offset === -1) {
    throw new Error("Expected a base64 data URI for the embedded font");
  }
  const base64 = dataUri.slice(offset + marker.length);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
}

const CARD_FONT_BUFFERS: Uint8Array[] = [
  dataUriToBytes(interBoldDataUri as string),
  dataUriToBytes(interSemiBoldDataUri as string),
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

/**
 * Issue #3782: rasterized PNGs live in the Cache API (`social-card-raster-v1`),
 * not an in-isolate Map — a cold isolate no longer re-renders a card a
 * neighbour isolate just rasterized. The card's request URL is already a
 * valid cache key; `cache-control` on the stored response bounds the
 * lifetime and the runtime's own eviction bounds capacity (the old Map's
 * 256-entry cap).
 */
const PNG_CACHE_NAME = "social-card-raster-v1";
const PNG_CACHE_MAX_AGE_S = 30 * 24 * 60 * 60;

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
      defaultFontFamily: "Inter",
      sansSerifFamily: "Inter",
    },
  });
  return resvg.render().asPng();
}

/**
 * Rasterize and cache a card by its full request URL. Returns the PNG bytes.
 * `caches` is absent under plain node, in which case this just renders.
 */
export async function rasterizeSocialCardPngCached(url: string, svg: string): Promise<Uint8Array> {
  const cached = await readCachedBytes(PNG_CACHE_NAME, url);
  if (cached) return cached;
  const png = await rasterizeSocialCardPng(svg);
  await writeCachedBytes(PNG_CACHE_NAME, url, png, "image/png", PNG_CACHE_MAX_AGE_S);
  return png;
}
