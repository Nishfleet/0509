/**
 * Text-shaping helpers that keep user-visible copy valid Unicode.
 *
 * The U+FFFD replacement character ("�") on the public /search page traced
 * back to code-unit truncation of ad copy: `String.prototype.slice` counts
 * UTF-16 code units, so a cut at the boundary of an emoji (a surrogate pair)
 * leaves a lone surrogate behind. A lone surrogate cannot be encoded as
 * UTF-8, so the moment the string is persisted to D1 or serialized into the
 * page it silently becomes U+FFFD — the emoji renders as "�".
 *
 * `truncateTextSafe` is the capture-side fix: truncate without ever splitting
 * a pair. `scrubBrokenUnicode` is the display-side guard: drop already
 * corrupted characters (U+FFFD and any lone surrogates) from rendered ad copy
 * so stale cached entries can never show the replacement glyph. Well-formed
 * surrogate pairs (real emoji) always pass through untouched.
 */

/**
 * Cut a string to at most `maxChars` UTF-16 code units without splitting a
 * surrogate pair. When the boundary falls inside a pair, the dangling high
 * surrogate half is dropped so the result is always valid Unicode.
 */
export function truncateTextSafe(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const sliced = value.slice(0, maxChars);
  const lastUnit = sliced.charCodeAt(sliced.length - 1);
  // A high surrogate at the end of the slice is the orphaned first half of a
  // split emoji. Dropping it keeps the string well-formed.
  return lastUnit >= 0xd800 && lastUnit <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

/**
 * Remove characters that can never be legitimate ad copy: the U+FFFD
 * replacement character (persisted corruption from a split surrogate pair)
 * and lone surrogates (which render as U+FFFD in the browser). Well-formed
 * surrogate pairs — real emoji — are preserved exactly.
 */
export function scrubBrokenUnicode(value: string): string {
  return value
    // High surrogate not followed by its low half.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    // Low surrogate not preceded by its high half.
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/\uFFFD/g, "");
}
