import { decodeHtmlEntities as decodeXml } from "~/lib/decode-html.server";
import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { presenceSafeFetch, PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";
import { resolvePublicHttpUrl } from "~/lib/public-url.server";

/**
 * Podcast show-mention connector (Nishfleet/0509#3208, epic #3171).
 *
 * The target is the show's own public RSS 2.0 feed — the same syndication
 * feed the publisher submits to Apple/Spotify/everwhere else, hosted by the
 * publisher themselves. Zero credentials, zero key, no platform mediation.
 * This is the `feed target` shape from docs/mentions/PLAN.md §2: the
 * connector emits every episode as a *candidate*, and the publication-feed
 * mention-match step (presence-data `buildMentionStampPlan`, which now
 * knows about `podcast` targets) stamps which entity phrase each episode
 * names and filters the rest — the same split the rss publication feeds use.
 *
 * Transcripts where public: an episode's `<podcast:transcript>` tag (the
 * Podcasting 2.0 podcast-namespace transcript tag — item-level, `url` +
 * `type` required) links the show's own transcript. When the episode
 * exposes one in the JSON transcript shape, the connector bounds-one-extra-
 * fetches it and lets its head extend the 280-char excerpt window, so a
 * phrase that only appears in the transcript still matches. Other transcript
 * formats (text/vtt, application/x-subrip, text/html, text/plain) are
 * recorded in `raw_json.transcriptUrl` but not yet fetched — the honest
 * documented limit, not a silent gap.
 *
 * Every network hop goes through `presenceSafeFetch`, which re-validates the
 * URL via `resolvePublicHttpUrl` (SSRF hardening) on every request. A raw
 * `fetch` to a show feed is a regression.
 *
 * The connector is wired into the registry but gated behind
 * `PRESENCE_PODCAST_ROLLOUT` (off by default); activation requires the
 * rollout flag (and, before migration 0101, the `source_target.connector_id`
 * CHECK widened to accept 'podcast'), not a code change in this connector.
 */
const MAX_PODCAST_FEED_BYTES = 750_000;
const MAX_TRANSCRIPT_BYTES = 250_000;
/** Politeness budget: at most this many transcript fetches per poll, spent on the newest episodes that expose a JSON transcript. */
export const MAX_TRANSCRIPTS_PER_POLL = 5;
/** Newest-episodes window per poll. Show feeds list newest-first; this mirrors the rss connector's per-poll item cap. */
const MAX_EPISODES = 25;
/** Bounded excerpt size for an episode. Same convention every presence connector uses. */
const MAX_EXCERPT_CHARS = 280;

export const podcastConnector = {
  id: "podcast" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return {
      units: 1,
      description:
        "One public HTTP fetch of the show's RSS feed (conditional-GET) plus at most 5 bounded transcript fetches",
    };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const raw = input.targetUrl?.trim();
    if (!raw) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_url",
        errorMessage: "Enter the podcast show's RSS feed URL.",
      };
    }

    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const safeUrl = await resolvePublicHttpUrl(candidate);
    if (!safeUrl) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "ssrf_blocked",
        errorMessage: "That URL is not reachable from the public internet.",
      };
    }

    const normalized = safeUrl.toString().replace(/\/$/, "") || safeUrl.toString();
    // Feed host + path: podcast specialty hosts (libsyn, Fireside,分布) carry
    // many distinct shows on one hostname, so the host alone would collide
    // two different shows tracked by the same entity.
    const targetKey =
      safeUrl.pathname && safeUrl.pathname !== "/"
        ? `${safeUrl.hostname.toLowerCase()}${safeUrl.pathname}`
        : safeUrl.hostname.toLowerCase();

    // Podcast targets are direct: unlike rss there is no site-HTML feed
    // discovery. If the document is not a show feed right now, the target is
    // rejected — honest, because there is no pending-discovery promise to
    // keep at poll time.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(safeUrl.toString(), fetchImpl, {
      method: "GET",
      maxBytes: MAX_PODCAST_FEED_BYTES,
      accept: "application/rss+xml,application/atom+xml,application/xml,text+xml,application/xml+rss,*/*",
    });

    if (!response || !response.ok || !response.body) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "feed_unavailable",
        errorMessage: `Feed responded with HTTP ${response?.status ?? 0}.`,
      };
    }

    if (!looksLikeFeedDocument(response.body)) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "not_a_feed",
        errorMessage: "That URL did not return an RSS/Atom/RDF feed document.",
      };
    }

    if (!isPodcastShowFeed(response.body)) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "not_podcast_feed",
        errorMessage:
          "That feed carries no iTunes/podcast-namespace markers — it does not identify itself as a podcast show feed.",
      };
    }

    const showTitle = readChannelTitle(response.body);
    return {
      ok: true,
      targetKey,
      targetUrl: normalized,
      coverageLabel: "VERIFIED_PUBLIC_FEED",
      metadata: {
        feedUrl: normalized,
        feedFormat: "podcast_rss",
        ...(showTitle ? { showTitle } : {}),
      },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "podcast", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "Podcast show-mention tracking is not enabled yet.",
        errorCode: gate.reasonCode ?? "connector_disabled",
      };
    }
    return {
      ok: true,
      status: "healthy",
      summary: "Podcast show-RSS polling is available — no credentials required.",
    };
  },

  async poll(
    ctx: PresenceConnectorContext,
    target: { targetUrl: string | null; metadata: Record<string, unknown> },
    cursor?: { etag?: string | null; lastModified?: string | null },
  ): Promise<PollResult> {
    // Self-gate exactly like the threads/hn connectors: the rollout kill flag
    // stops the poll before any network hop.
    const gate = await evaluateConnectorAccessGate(ctx.env, "podcast", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Podcast presence tracking is not enabled yet.",
      };
    }

    if (!target.targetUrl) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_target_url",
        errorMessage: "Podcast target URL is missing.",
      };
    }

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const storedFeedUrl =
      typeof target.metadata.feedUrl === "string" && target.metadata.feedUrl
        ? target.metadata.feedUrl
        : null;
    const feedUrl = storedFeedUrl ?? target.targetUrl;

    const response = await presenceSafeFetch(feedUrl, fetchImpl, {
      method: "GET",
      maxBytes: MAX_PODCAST_FEED_BYTES,
      etag: cursor?.etag,
      lastModified: cursor?.lastModified,
      accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*",
    });

    if (!response) {
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not fetch the podcast show feed.",
      };
    }

    if (response.notModified) {
      return {
        ok: true,
        items: [],
        etag: response.etag,
        lastModified: response.lastModified,
        coverageLabel: "VERIFIED_PUBLIC_FEED",
        costUnits: 0,
        cursor: { feedUrl },
      };
    }

    if (!response.ok || !response.body) {
      return {
        ok: false,
        items: [],
        errorCode: "feed_unavailable",
        errorMessage: `Feed responded with HTTP ${response.status}.`,
      };
    }

    const body = response.body;
    const showTitle = readChannelTitle(body);
    const plans = parseEpisodePlans(body, feedUrl, showTitle);

    // A valid feed document that simply has zero <item> entries is an honest
    // empty result. Only a document that is not a feed at all is a parse
    // failure (same honesty eval as the rss connector).
    if (plans.length === 0 && !looksLikeFeedDocument(body)) {
      return {
        ok: false,
        items: [],
        errorCode: "feed_parse_failed",
        errorMessage: "Feed did not contain valid RSS <item> entries.",
        etag: response.etag,
        lastModified: response.lastModified,
      };
    }

    // Transcripts where public: at most MAX_TRANSCRIPTS_PER_POLL bounded
    // extra fetches per poll, spent in feed order (newest first) on episodes
    // whose podcast:transcript tag exposes a JSON transcript. A failed or
    // unparseable transcript never fails the poll — the episode still lands
    // from its shownotes.
    let transcriptBudget = MAX_TRANSCRIPTS_PER_POLL;
    for (const plan of plans) {
      const transcript = plan.transcript;
      if (!transcript || !transcript.isJson) continue;
      if (transcriptBudget <= 0) break;
      transcriptBudget -= 1;

      const transcriptResponse = await presenceSafeFetch(transcript.url, fetchImpl, {
        method: "GET",
        maxBytes: MAX_TRANSCRIPT_BYTES,
        accept: "application/json,application/podcast+json,*/*",
      });
      if (!transcriptResponse || !transcriptResponse.ok || !transcriptResponse.body) {
        continue;
      }
      const text = extractJsonTranscriptHead(transcriptResponse.body);
      if (!text) continue;
      const base = plan.item.bodyExcerpt ?? "";
      const glue = base ? " — " : "";
      const room = MAX_EXCERPT_CHARS - (base + glue).length;
      if (room <= 10) continue;
      plan.item.bodyExcerpt = (base + glue + text.slice(0, room)).slice(0, MAX_EXCERPT_CHARS) || null;
      plan.item.raw = { ...(plan.item.raw ?? {}), transcriptFetched: true };
    }

    const items = plans.map((plan) => plan.item);
    // contentHash covers (title, bodyExcerpt, author, publishedAt) — it is
    // derived AFTER the transcript pass so the enriched excerpt hashes what
    // the row will actually carry.
    for (const item of items) {
      item.contentHash = await presenceContentHash({
        title: item.title,
        bodyExcerpt: item.bodyExcerpt,
        author: item.author,
        publishedAt: item.publishedAt,
      });
    }

    return {
      ok: true,
      items,
      etag: response.etag,
      lastModified: response.lastModified,
      coverageLabel: "VERIFIED_PUBLIC_FEED",
      costUnits: 1,
      // completeSnapshot: episodes removed from the show feed are tombstoned
      // by the reconcile step on the next poll (same contract as rss).
      cursor: { feedUrl, completeSnapshot: items.length > 0 },
    };
  },
};

interface PodcastTranscriptRef {
  url: string;
  type: string | null;
  isJson: boolean;
}

interface PodcastEpisodePlan {
  item: NormalizedPresenceItem;
  transcript: PodcastTranscriptRef | null;
}

function looksLikeFeedDocument(xml: string): boolean {
  return /<(rss|feed|rdf:RDF)\b/i.test(xml);
}

/** A podcast show feed = RSS 2.0 + at least one iTunes/podcast-namespace marker. */
function isPodcastShowFeed(xml: string): boolean {
  return (
    /<rss\b/i.test(xml) &&
    /xmlns:itunes|<itunes:|xmlns:podcast|<podcast:/i.test(xml)
  );
}

/**
 * Everything before the first <item> — the <channel> preamble, where the
 * show-level <title> and <itunes:author> live.
 */
function channelPreamble(xml: string): string {
  const firstItem = xml.search(/<item[\s>]/i);
  return firstItem === -1 ? xml : xml.slice(0, firstItem);
}

function readChannelTitle(xml: string): string | null {
  const title = decodeXml(extractTag(channelPreamble(xml), "title") ?? "").trim();
  return title || null;
}

function readChannelAuthor(xml: string): string | null {
  const author = decodeXml(extractTag(channelPreamble(xml), "itunes:author") ?? "").trim();
  return author || null;
}

function parseEpisodePlans(
  body: string,
  feedUrl: string,
  showTitle: string | null,
): PodcastEpisodePlan[] {
  const channelAuthor = readChannelAuthor(body);
  const plans: PodcastEpisodePlan[] = [];

  for (const match of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    if (plans.length >= MAX_EPISODES) break;
    const block = match[1] ?? "";
    const observedAt = new Date().toISOString();

    const title = decodeXml(extractTag(block, "title") ?? "Untitled episode").trim() || "Untitled episode";
    const publishedRaw = extractTag(block, "pubDate");
    const publishedAt = publishedRaw ? safeIsoDate(publishedRaw) ?? observedAt : observedAt;
    const author = decodeXml(extractTag(block, "itunes:author") ?? "").trim() || null;
    const descriptionRaw =
      extractTag(block, "itunes:summary") ??
      extractTag(block, "description") ??
      extractTag(block, "content:encoded") ??
      "";
    const excerpt = decodeXml(stripHtml(descriptionRaw)).slice(0, MAX_EXCERPT_CHARS);

    const link = extractTag(block, "link");
    const guid = extractTag(block, "guid");
    const enclosureUrl = readEnclosureUrl(block);
    // canonicalUrl precedence: the episode <link>, then a guid that itself is
    // an http(s) permalink, then the audio enclosure. A feed can rely on any
    // one of them; an episode with none of the three is skipped, never
    // fabricated — and never collapsed onto the feed URL the way rss does,
    // because here that would collide every episode onto one url_hash.
    let canonicalUrl: string | null = null;
    for (const candidate of [link, /^https?:\/\//i.test(guid ?? "") ? guid : null, enclosureUrl]) {
      if (!candidate) continue;
      const normalized = normalizeEpisodeUrl(candidate);
      if (normalized) {
        canonicalUrl = normalized;
        break;
      }
    }
    if (!canonicalUrl) continue;

    plans.push({
      item: {
        externalId: (guid ?? canonicalUrl).trim() || canonicalUrl,
        canonicalUrl,
        title,
        bodyExcerpt: excerpt || null,
        author,
        publishedAt,
        observedAt,
        contentHash: "",
        raw: {
          kind: "podcast_episode",
          showFeed: feedUrl,
          ...(showTitle ? { showTitle } : {}),
          // Provenance, not match fuel: the show's own attribution rides the
          // raw record so the channel-level itunes:author stays inspectable
          // without silently making every episode of the show match the
          // tracked phrase through the author field (the publication-feed
          // mention-match also matches against author).
          ...(channelAuthor ? { showAuthor: channelAuthor } : {}),
          ...(chosenTranscriptOf(block) ?? {}),
        },
      },
      transcript: podcastTranscriptOf(block),
    });
  }

  return plans;
}

/**
 * Podcasting 2.0 `<podcast:transcript>` (item-level; the namespace docs give
 * Parent: <item>, Count: Multiple, url+type required). Prefer a JSON transcript
 * (type application/json — and application/podcast+json, the Apple-adopted
 * shape, matches the same includes("json") test); otherwise record the first
 * transcript offered. VTT/SRT/HTML/plain transcripts are recorded, not yet
 * fetched — the honest documented limit.
 */
function podcastTranscriptOf(block: string): PodcastTranscriptRef | null {
  const refs: PodcastTranscriptRef[] = [];
  for (const match of block.matchAll(/<(?:podcast:)?transcript\b([^>]*?)(?:\/>|><\/(?:podcast:)?transcript\s*>)/gi)) {
    const attrs = match[1] ?? "";
    const url = attrs.match(/\burl\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!url) continue;
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
    refs.push({ url: url.trim(), type: type?.trim() ?? null, isJson: (type ?? "").toLowerCase().includes("json") });
  }
  if (refs.length === 0) return null;
  return refs.find((ref) => ref.isJson) ?? refs[0] ?? null;
}

/** The raw_json transcript keys stamped at parse time (transcriptFetched upgraded to true after a successful read). */
function chosenTranscriptOf(block: string): Record<string, unknown> | null {
  const transcript = podcastTranscriptOf(block);
  if (!transcript) return null;
  return {
    transcriptUrl: transcript.url,
    ...(transcript.type ? { transcriptType: transcript.type } : {}),
    transcriptFetched: false,
  };
}

/**
 * The documented Podcasting 2.0 JSON transcript shape: top-level
 * `segments[]`, each with a `text` string. Returns the head of the joined
 * text (whitespace-collapsed), or null when the file does not carry that
 * shape — never an exception.
 */
function extractJsonTranscriptHead(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { segments?: Array<{ text?: unknown }> };
    const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
    const texts: string[] = [];
    for (const segment of segments) {
      if (typeof segment?.text === "string" && segment.text.trim()) {
        texts.push(segment.text.trim());
      }
    }
    const joined = texts.join(" ").replace(/\s+/g, " ").trim();
    return joined || null;
  } catch {
    return null;
  }
}

function readEnclosureUrl(block: string): string | null {
  return block.match(/<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ?? null;
}

/**
 * Deterministic episode-URL canonicalization — the dedupe-by-canonical-URL
 * contract. presenceUrlHash hashes the verbatim trimmed-lowercased string, so
 * the connector must strip the volatile decoration itself: the fragment, and the
 * tracking params (utm_*, fbclid, gclid) that podtrac/utm-ified feeds
 * sprinkle into show notes links. Everything else (path, other query params,
 * trailing slash) stays verbatim — the hash must survive a re-poll byte-for-
 * byte, and it must not invent a different URL than the feed published.
 */
export function normalizeEpisodeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^utm_/i.test(key) || key === "fbclid" || key === "gclid") {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

// Matches `<tag ...>inner</tag>` for any tag name; the caller checks the name.
// A single precompiled regex avoids `new RegExp(userInput)` (ReDoS) and is
// faster than rebuilding per call. `tag` is always a hardcoded literal here.
const ANY_TAG_RE = /<([a-zA-Z][a-zA-Z0-9:_-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;

function extractTag(block: string, tag: string): string | null {
  const lower = tag.toLowerCase();
  for (const match of block.matchAll(ANY_TAG_RE)) {
    if (match[1]?.toLowerCase() === lower) {
      return match[2]?.trim() ?? null;
    }
  }
  return null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function safeIsoDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

// Unused-import guard: PRESENCE_USER_AGENT rides every presenceSafeFetch call
// via its own header composition; keep the module-visibility reference honest
// for the type-level import the connector shares with the other connectors.
export const PODCAST_CONNECTOR_USER_AGENT = PRESENCE_USER_AGENT;
