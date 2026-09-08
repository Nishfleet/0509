/**
 * Visual diff screenshots (before/after) for watchlist change events.
 *
 * The watchlist change feed stores one screenshot per proof capture in R2
 * (`proof_capture.screenshot_artifact_key`, written by browser-run). The
 * event plate shows the CURRENT capture's screenshot next to the PREVIOUS
 * capture's screenshot, side by side, as the visual half of a change event.
 *
 * This module is isomorphic (no env, no fetch): it builds the app-relative
 * artifact URL a client <img> can request, and validates/parses the same
 * path back on the Worker edge. The R2 read itself lives in
 * `proof-screenshot.server.ts` and is wired into `workers/app.ts`.
 *
 * URLs are unguessable (the R2 keys embed a UUID) but not authenticated —
 * the same model the creative-thumbnail artifacts use. The raster-only and
 * key-shape gates below keep the route from serving anything else.
 */

export const PROOF_SCREENSHOT_PATH_PREFIX = "/artifacts/proof/";

/** R2 keys are written as `landing-pages/YYYY-MM-DD/<uuid>.jpeg`. */
const PROOF_SCREENSHOT_KEY_PATTERN = /^landing-pages\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.(jpeg|jpg|png|webp)$/;

const PROOF_SCREENSHOT_PATHNAME_PATTERN = /^\/artifacts\/proof\/([^/]+)$/;

/** Only raster types are ever served — never SVG (scriptable). */
export const PROOF_SCREENSHOT_SERVED_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export function isValidProofScreenshotKey(key: string): boolean {
  if (!key || key.includes("..") || key.includes("\\") || key.includes("\0")) {
    return false;
  }
  return PROOF_SCREENSHOT_KEY_PATTERN.test(key);
}

/**
 * The app-relative src for a stored screenshot. Returns null for a missing
 * or malformed key so callers can degrade honestly instead of rendering a
 * broken image.
 */
export function proofScreenshotSrc(artifactKey: string | null | undefined): string | null {
  const key = artifactKey?.trim();
  if (!key || !isValidProofScreenshotKey(key)) {
    return null;
  }
  return `${PROOF_SCREENSHOT_PATH_PREFIX}${encodeURIComponent(key)}`;
}

/**
 * Reverse of `proofScreenshotSrc`: the encoded single segment back to a
 * validated R2 key. Returns null for anything that is not a proof-screenshot
 * artifact path.
 */
export function parseProofScreenshotPathname(pathname: string): string | null {
  const match = pathname.match(PROOF_SCREENSHOT_PATHNAME_PATTERN);
  if (!match) {
    return null;
  }
  try {
    const key = decodeURIComponent(match[1]);
    return isValidProofScreenshotKey(key) ? key : null;
  } catch {
    return null;
  }
}
