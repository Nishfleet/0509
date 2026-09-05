/**
 * Ticker belt body dedup — shared by the `/ads/:domain` `ld-ticker-belt` and
 * the home `f9-ads-ticker` marquee.
 *
 * Why this exists (issue #1496): the `/ads/:domain` ticker sliced the first
 * `TICKER_MAX_ITEMS` cached ads in recency order without dropping duplicate
 * bodies. When the same body has multiple ad variants in the wall, a
 * first-time visitor read the same line 3–4 times in a 6-slot strip and
 * concluded the wall was shorter than the by-the-numbers header claimed. The
 * home belt is masked by a deterministic 3-message loop, but the same helper
 * runs there so the home belt stays deduped if it ever sources ad bodies.
 *
 * Contract: drop any second occurrence of an ad body within one ticker cycle.
 * Comparison is on NORMALIZED body text — lowercase, collapse whitespace,
 * strip trailing punctuation — and the longest raw variant wins when two
 * items normalize to the same key (a fuller headline is better evidence than
 * a truncated one). Insertion order is preserved, so the first-seen position
 * of each distinct body is kept.
 */

/** Trailing punctuation stripped before comparison. */
const TRAILING_PUNCT = /[.,!?;:'"\u201d\u2019]+$/u;

/**
 * Normalize a body for duplicate comparison: lowercase, collapse whitespace,
 * strip trailing punctuation. Pure and deterministic so the same body always
 * produces the same key regardless of source-link tag or surrounding markup.
 */
export function normalizeTickerBody(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(TRAILING_PUNCT, "")
    .trim();
}

/**
 * Drop any second occurrence of an item whose body normalizes to the same key
 * as an earlier item. When two items share a key, the one with the longer raw
 * body wins (a fuller headline reads as stronger evidence). Insertion order is
 * preserved — the kept item stays at the position of its first occurrence.
 *
 * `getBody` extracts the comparison text from each item (the visible body,
 * never the timestamp or source tag).
 */
export function dedupeTickerBodies<T>(
  items: readonly T[],
  getBody: (item: T) => string,
): T[] {
  const kept = new Map<string, T>();
  for (const item of items) {
    const body = getBody(item);
    const key = normalizeTickerBody(body);
    if (key === "") continue; // an empty body contributes nothing to the belt
    const existing = kept.get(key);
    if (!existing) {
      kept.set(key, item);
      continue;
    }
    // Prefer the longest raw variant — a fuller headline is better evidence.
    if (body.length > getBody(existing).length) {
      kept.set(key, item);
    }
  }
  return Array.from(kept.values());
}
