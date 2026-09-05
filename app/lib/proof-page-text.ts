/**
 * Stored landing-page HTML (the "page text" half of an offer snapshot).
 *
 * Screenshots already have `/artifacts/proof/<key>`. Page text lives in the
 * same R2 prefix as `*.html`. URLs are unguessable (UUID in the key) but not
 * authenticated — same model as proof screenshots. The key-shape gate keeps
 * the route from addressing anything outside `landing-pages/YYYY-MM-DD/`.
 *
 * Served as `text/plain` so competitor HTML cannot execute in the browser.
 */

export const PROOF_PAGE_TEXT_PATH_PREFIX = "/artifacts/page-text/";

/** R2 keys are written as `landing-pages/YYYY-MM-DD/<hex>.html`. */
const PROOF_PAGE_TEXT_KEY_PATTERN =
  /^landing-pages\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.html$/;

const PROOF_PAGE_TEXT_PATHNAME_PATTERN = /^\/artifacts\/page-text\/([^/]+)$/;

export function isValidProofPageTextKey(key: string): boolean {
  if (!key || key.includes("..") || key.includes("\\") || key.includes("\0")) {
    return false;
  }
  return PROOF_PAGE_TEXT_KEY_PATTERN.test(key);
}

export function proofPageTextSrc(artifactKey: string | null | undefined): string | null {
  const key = artifactKey?.trim();
  if (!key || !isValidProofPageTextKey(key)) {
    return null;
  }
  return `${PROOF_PAGE_TEXT_PATH_PREFIX}${encodeURIComponent(key)}`;
}

export function parseProofPageTextPathname(pathname: string): string | null {
  const match = pathname.match(PROOF_PAGE_TEXT_PATHNAME_PATTERN);
  if (!match) {
    return null;
  }
  try {
    const key = decodeURIComponent(match[1]);
    return isValidProofPageTextKey(key) ? key : null;
  } catch {
    return null;
  }
}
