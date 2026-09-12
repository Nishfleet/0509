/**
 * Mention match — pure, side-effect-free matcher for the RSS mention
 * backbone (Nishfleet/0509#3250, epic #3171).
 *
 * For a publication feed (publisher RSS, Substack, Medium, YouTube channel
 * feed), every item is a *candidate* — the question is whether it actually
 * names the tracked entity. This module answers that question by walking a
 * small set of derived phrases (label, registrable domain, aliases parsed
 * from `notes`) and reporting which phrase (if any) appears in which item
 * field. Pure: no network, no D1, no fetch.
 *
 * For a query feed (e.g. Google News `/rss/search?q=...`), the upstream
 * surface has already pre-filtered to the query — every item is, by
 * construction, a mention of the query phrase. `isQueryFeedUrl` /
 * `queryPhraseForFeed` expose that contract so callers can stamp the marker
 * without re-running the matcher.
 *
 * The match metadata (which phrase matched, which field) is stamped into
 * `presence_item.raw_json` by `upsertPresenceItems`; a `null` `matched_phrase`
 * for a publication feed is the signal "filter this out — it does not name
 * the entity". The match field order is fixed: title before excerpt before
 * author, so a stronger evidence signal (a phrase in the headline) wins over
 * a weaker one (a phrase buried in the author byline).
 */

export type MentionMatchField = "title" | "bodyExcerpt" | "author" | "query";

export interface MentionMatchInput {
  title: string | null;
  bodyExcerpt: string | null;
  author: string | null;
}

export interface MentionEntityPhrases {
  /** The tracked entity label exactly as stored (e.g. "Acme"). */
  label: string | null;
  /** Registrable domain derived from `tracked_entity.canonical_url` (e.g. "acme.test"). */
  canonicalDomain: string | null;
  /** Free-form aliases parsed from `tracked_entity.notes` (newline-separated). */
  aliases: string[];
}

export interface MentionMatchResult {
  matched: boolean;
  /** The exact phrase that matched (post-normalization: trimmed, original casing). `null` when no match. */
  matchedPhrase: string | null;
  /** Which item field produced the first match. `null` when no match. `"query"` is reserved for query feeds. */
  matchField: MentionMatchField | null;
}

const FIELD_ORDER: ReadonlyArray<Exclude<MentionMatchField, "query">> = [
  "title",
  "bodyExcerpt",
  "author",
];

const QUERY_FEED_HOST = "news.google.com";
const QUERY_FEED_PATH = "/rss/search";

/**
 * A feed URL is a *query feed* when it matches the Google News
 * `/rss/search?q=...` URL shape (the surface's own search has already
 * pre-filtered to the query). The shape is the contract — other surfaces
 * (GDELT, Bluesky, HN) are separate connectors and have their own query
 * wiring. Source: docs/mentions/PLAN.md §2 (Google News RSS row).
 */
export function isQueryFeedUrl(feedUrl: string | null | undefined): boolean {
  if (!feedUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(feedUrl);
  } catch {
    return false;
  }
  if (parsed.hostname.toLowerCase() !== QUERY_FEED_HOST) return false;
  if (!parsed.pathname.startsWith(QUERY_FEED_PATH)) return false;
  return parsed.searchParams.has("q");
}

/** Returns the `?q=...` phrase from a Google News query feed URL, trimmed. */
export function queryPhraseForFeed(feedUrl: string | null | undefined): string | null {
  if (!feedUrl || !isQueryFeedUrl(feedUrl)) return null;
  try {
    const parsed = new URL(feedUrl);
    const q = parsed.searchParams.get("q")?.trim();
    return q && q.length > 0 ? q : null;
  } catch {
    return null;
  }
}

/**
 * Build the phrase set used by `mentionMatch`. Order matters: label first,
 * canonical domain second, aliases last. Duplicates are dropped after
 * case-folding so "Acme" and "acme" do not both appear in the candidate set.
 */
export function buildMentionPhrases(entity: MentionEntityPhrases): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [entity.label, entity.canonicalDomain, ...entity.aliases]) {
    const phrase = raw?.trim();
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
  }
  return out;
}

/**
 * Pull a registrable domain (e.g. `acme.test` from `https://www.acme.test/blog`)
 * out of a tracked entity's `canonical_url`. Falls back to the full hostname
 * for IPs; returns `null` for empty / non-HTTP inputs.
 */
export function canonicalDomainFromUrl(canonicalUrl: string | null | undefined): string | null {
  if (!canonicalUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(canonicalUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.trim().toLowerCase();
  return host || null;
}

/**
 * Parse `tracked_entity.notes` into a flat alias list. Newline-separated for
 * v1; brackets, quotes and leading list markers are stripped so a notes
 * block of `Aliases:\n- "Acme Co"\n- acme.io` collapses to `["Acme Co",
 * "acme.io"]`. Returns `[]` when notes is empty / null / whitespace.
 */
export function parseAliasNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    // Strip a "Aliases:" / "Also known as:" header line if present.
    const withoutHeader = line.replace(/^[A-Za-z][A-Za-z ]{0,40}:\s*/, "").trim();
    // Strip list markers, leading quote, trailing comma.
    const cleaned = withoutHeader
      .replace(/^[-*•·]\s*/, "")
      .replace(/^["'`]+|["'`,]+$/g, "")
      .trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/**
 * Convenience: derive the phrase inputs from a tracked entity record shape.
 * Caller passes the raw `label` / `canonical_url` / `notes` from the
 * `tracked_entity` row; this collapses them into the matcher input.
 */
export function entityPhrasesFromRecord(record: {
  label: string;
  canonicalUrl: string | null;
  notes: string | null;
}): MentionEntityPhrases {
  return {
    label: record.label?.trim() || null,
    canonicalDomain: canonicalDomainFromUrl(record.canonicalUrl),
    aliases: parseAliasNotes(record.notes),
  };
}

/**
 * Run the matcher against one item. Returns `{ matched: false, ... }` when
 * no candidate phrase appears in any field. Field order is fixed
 * (title > excerpt > author) so the strongest evidence wins.
 */
export function mentionMatch(
  item: MentionMatchInput,
  entity: MentionEntityPhrases,
): MentionMatchResult {
  const phrases = buildMentionPhrases(entity);
  if (phrases.length === 0) {
    return { matched: false, matchedPhrase: null, matchField: null };
  }
  for (const field of FIELD_ORDER) {
    const haystack = item[field];
    if (!haystack) continue;
    const hit = firstPhraseMatch(haystack, phrases);
    if (hit) {
      return { matched: true, matchedPhrase: hit, matchField: field };
    }
  }
  return { matched: false, matchedPhrase: null, matchField: null };
}

/**
 * Return the first phrase (in candidate order) found in `haystack`, using a
 * case-insensitive whole-token match when the phrase is a bare alphanumeric
 * token and a case-insensitive substring match when the phrase contains
 * non-word characters (so "acme.io" still matches "see acme.io today").
 * Returns `null` when no phrase hits.
 */
function firstPhraseMatch(haystack: string, phrases: string[]): string | null {
  for (const phrase of phrases) {
    if (matchesPhrase(haystack, phrase)) {
      return phrase;
    }
  }
  return null;
}

function matchesPhrase(haystack: string, phrase: string): boolean {
  const haystackLower = haystack.toLowerCase();
  const phraseLower = phrase.toLowerCase();
  const index = haystackLower.indexOf(phraseLower);
  if (index < 0) return false;
  // Bare alphanumeric / dot-only phrases (e.g. "Acme", "acme.io", "Acme Co"):
  // require word boundaries so "Acme" does NOT match "AcmeApp" but DOES match
  // "(Acme)" or "Acme.".
  if (/^[A-Za-z0-9.]+(?:\s+[A-Za-z0-9.]+)*$/.test(phrase)) {
    const before = index === 0 ? "" : haystackLower.charAt(index - 1);
    const afterIndex = index + phraseLower.length;
    const after = afterIndex >= haystackLower.length ? "" : haystackLower.charAt(afterIndex);
    const isWordChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);
    if (before && isWordChar(before)) return false;
    if (after && isWordChar(after)) return false;
  }
  return true;
}
