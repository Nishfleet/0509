import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { normalizePublicHttpUrl } from "~/lib/public-url.server";
import { presenceSafeFetch } from "~/lib/presence-robots.server";
import { parseFeedItems, stripHtml } from "~/lib/presence-connectors/rss.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

// research: (issue #3201 — existing open-source collectors, searched +
// rejected, 2026-09-13): GitHub search "pinterest rss" by stars —
// iatek/jquery-socialist (626★, last pushed 2015-10; a browser-side jQuery
// widget, not a server-side collector), didats/DTSocialMedia (PHP, 2015,
// dead), pinLarge/pinLarge (Go→Heroku, 2019, dead), and the actively
// maintained xyonium/reach-mcp (Python, MCP server aggregating 33 sources) —
// rejected: a second language and a running sidecar for one public GET; this
// connector reuses the shared rss parser and the presenceSafeFetch
// SSRF/redirect path instead. Also verified: RSS-Bridge/RSS-Bridge (9,233★,
// active; bridges/PinterestBridge.php confirmed present 2026-09-13) —
// rejected: a PHP bridge-framework dependency that re-scrapes the HTML
// profile page when Pinterest itself publishes the first-party public
// feed.rss this connector reads. Adopted: none — the platform's own public
// surface, no new dependency.
// help-first: the deterministic test entry point is
// `npx vitest run --configLoader runner --project workers
// tests/integration/pinterest-mention-connector.integration.test.ts`.

/**
 * Pinterest presence connector (issue #3201 — mentions-epic split of #3171,
 * disjoint from #3178's shared interface: new connector + flag + tests +
 * coverage note, nothing else).
 *
 * Turns a tracked entity's Pinterest profile into its own public profile
 * feed — `GET https://www.pinterest.com/<handle>/feed.rss` — and emits
 * normalized `presence_item` rows whose `canonicalUrl` is the public
 * pinterest.com/pin/<id>/ page (the address a Pinterest mention is actually
 * read at; the feed's <guid> carries the same URL, so it doubles as the
 * external id).
 *
 * The surface: an UNDOCUMENTED public RSS 2.0 feed, verified live 2026-09-13
 * (HTTP 200, valid RSS, 25 items, no key, no auth, case-insensitive handle;
 * the apex domain 308s to www, which `presenceSafeFetch` already follows and
 * re-validates). Same honesty posture as the PLAN.md's Google News RSS row:
 * verified, community-documented, capable of changing without notice. The
 * API-v5 row in the plan stays as written — reads there are per-user OAuth
 * behind app review, which is why the feed, not the API, is the $0 surface.
 *
 * What the public surface covers (the coverage note says the same): the
 * tracked PROFILE's own most recent pins (~25) — the tracked brand or
 * PERSON's own Pinterest presence, self AND competitor (no auth, both modes).
 * It does NOT cover keyword-wide search across all of Pinterest, boards not
 * owned by the tracked profile, repin/comment activity, or engagement
 * counts — Pinterest has no lawful public surface for those; PLAN.md keeps
 * them under the parked API-v5 row.
 *
 * Rate budget: ONE serialized request per poll. No paging (the feed itself
 * IS the bounded window — 25 items, the same cap the shared parser applies),
 * no second fetch, no conditional-GET yet (a ~10 KB unnoticed re-read at
 * digest cadence is the cheapest honest posture; the 304 plumbing rides the
 * rss connector until this source needs it). Cadence stays with the poll
 * orchestrator (`runPresencePollingBatch` serializes polls upstream).
 *
 * Capture-validity: the one network hop goes through `presenceSafeFetch`
 * (SSRF hardening + redirects re-validated) — a raw `fetch` is a regression —
 * and every item's `canonicalUrl` must survive `normalizePublicHttpUrl`
 * (the #3339 article-URL validation precedent) or the item is dropped, not
 * stored under a compromise key.
 *
 * Mention story: every pin in a profile's feed IS the tracked profile's own
 * presence, so — like hn/bluesky/threads, whose match story their connectors
 * own — no publication-phrase filtering happens here (the store's mention
 * stamping applies to `rss`-connector targets only, by design).
 *
 * The connector ships dark behind `PRESENCE_PINTEREST_ROLLOUT` (off by
 * default); activation needs the flag and the 0101 CHECK widen for
 * `source_target.connector_id = 'pinterest'` — not a code change here.
 */
const PINTEREST_WWW_BASE = "https://www.pinterest.com";
const PINTEREST_MAX_BYTES = 750_000;
/** Connector-side cap on the handle; Pinterest itself tolerates less, but the
 * connector only promises not to blow up on long input (same posture as the
 * hn connector's phrase cap — the poll 404s honestly if Pinterest disagrees). */
const MAX_PINTEREST_HANDLE_CHARS = 64;
/** Stable probe handle for healthCheck — the official Pinterest account, whose
 * feed is guaranteed to exist on the public surface. */
const PRESENCE_PINTEREST_PROBE_HANDLE = "pinterest";

/**
 * Strips aPinterest handle to its path segment: a bare handle (optionally
 * @-prefixed) or any pinterest.com profile-ish URL. Returns the sanitized
 * segment (original case, no trailing/leading junk) or null when nothing
 * usable remains.
 */
export function sanitizePinterestHandle(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let segment = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname.toLowerCase() !== "www.pinterest.com" && parsed.hostname.toLowerCase() !== "pinterest.com") {
        return null;
      }
      segment = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    } catch {
      return null;
    }
  }
  segment = segment.replace(/^@/, "").replace(/^[./]+|[./]+$/g, "").trim();
  if (!segment || segment.length > MAX_PINTEREST_HANDLE_CHARS) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) return null;
  return segment;
}

/** The public profile feed URL for a sanitized handle (www-pinned — the apex 308s here anyway). */
export function pinterestProfileFeedUrl(handle: string): string {
  return `${PINTEREST_WWW_BASE}/${encodeURIComponent(handle)}/feed.rss`;
}

function normalizeHandle(raw: string): string | null {
  const segment = sanitizePinterestHandle(raw);
  if (!segment || segment.length > MAX_PINTEREST_HANDLE_CHARS) return null;
  return segment;
}

export const pinterestConnector = {
  id: "pinterest" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return {
      units: 1,
      description: "One serialized Pinterest profile-feed request (public RSS, no key, no auth)",
    };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "pinterest", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Pinterest connector is not available.",
      };
    }

    // The "target" for Pinterest is the tracked profile's handle — it arrives
    // as targetHandle/targetUrl (profile-URL convention, like the rss
    // connector's feed-URL target) or in metadata.handle.
    const raw = input.targetHandle ?? input.targetUrl ?? input.metadata?.handle;
    if (typeof raw !== "string" || !raw.trim()) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_pinterest_handle",
        errorMessage: "Enter the Pinterest profile handle (or profile URL) to track.",
      };
    }
    const handle = normalizeHandle(raw);
    if (!handle) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "pinterest_handle_invalid",
        errorMessage: `That does not look like a Pinterest profile handle (max ${MAX_PINTEREST_HANDLE_CHARS} characters; letters, numbers, dots, dashes, underscores).`,
      };
    }
    const profileUrl = `${PINTEREST_WWW_BASE}/${encodeURIComponent(handle)}/`;

    return {
      ok: true,
      targetKey: handle.toLowerCase(),
      targetUrl: profileUrl,
      targetHandle: handle,
      coverageLabel: "VERIFIED_PUBLIC_FEED",
      metadata: { handle },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "pinterest", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "Pinterest tracking is not enabled yet.",
        errorCode: gate.reasonCode,
      };
    }

    // The rollout is on: probe the public surface once — the official
    // account's profile feed is the cheapest honest liveness question (and a
    // single rate-budget request).
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      pinterestProfileFeedUrl(PRESENCE_PINTEREST_PROBE_HANDLE),
      fetchImpl,
      { method: "GET", maxBytes: PINTEREST_MAX_BYTES },
    );

    if (!response || !response.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: response
          ? `The Pinterest profile feed answered the health probe with HTTP ${response.status}.`
          : "The Pinterest profile feed did not answer the health probe.",
        errorCode: "pinterest_unreachable",
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary: "Pinterest profile-feed polling is available — no key, no credentials required.",
    };
  },

  async poll(
    ctx: PresenceConnectorContext,
    // Same structural target the registry passes every non-website connector
    // (the #3386 lesson: the dispatch hands the WHOLE target over — the
    // connector, not the registry, decides which field carries the handle).
    target: {
      id: string;
      userId: string;
      targetKey: string;
      targetUrl: string | null;
      targetHandle: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<PollResult> {
    const rawHandle =
      (typeof target.metadata.handle === "string" && target.metadata.handle.trim()
        ? target.metadata.handle
        : null) ??
      target.targetHandle ??
      target.targetKey;
    if (!rawHandle?.trim()) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_pinterest_handle",
        errorMessage: "Pinterest target has no profile handle to poll.",
      };
    }
    const handle = normalizeHandle(rawHandle);
    if (!handle) {
      return {
        ok: false,
        items: [],
        errorCode: "pinterest_handle_invalid",
        errorMessage: `Pinterest handle exceeds the connector limit (max ${MAX_PINTEREST_HANDLE_CHARS} characters).`,
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "pinterest", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Pinterest connector is not enabled.",
      };
    }

    const feedUrl = pinterestProfileFeedUrl(handle);
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(feedUrl, fetchImpl, {
      method: "GET",
      maxBytes: PINTEREST_MAX_BYTES,
    });

    if (!response) {
      return {
        ok: false,
        items: [],
        errorCode: "pinterest_unreachable",
        errorMessage: "The Pinterest profile feed did not answer the poll.",
      };
    }
    if (!response.ok || !response.body) {
      return {
        ok: false,
        items: [],
        errorCode: response.status === 429 ? "rate_limited" : "pinterest_feed_error",
        errorMessage: `The Pinterest profile feed answered with HTTP ${response.status}.`,
      };
    }

    // The shared RSS/Atom parser does the parsing (one parser, one job —
    // the rss connector's 25-item cap and this feed's 25-item window coincide).
    const parsed = await parseFeedItems(response.body, feedUrl);

    // Capture-validity: keep only items whose pin URL survives public-URL
    // normalization (the #3339 precedent). A pin without a valid public
    // canonical URL cannot be deduped by canonical URL — dropping it, not
    // keying it to the profile, is the honest alternative. The parser's
    // missing-link fallback (the feed URL itself) is skipped for the same
    // reason: it would dedup-collapse every linkless pin onto one row.
    const items: NormalizedPresenceItem[] = [];
    for (const item of parsed) {
      if (item.canonicalUrl === feedUrl) continue; // parser fallback → no real pin link
      const canonical = normalizePublicHttpUrl(item.canonicalUrl);
      if (!canonical) continue;
      // Pinterest double-escapes its description HTML: the shared parser's
      // one strip pass runs BEFORE the entities decode, so the <a>/<img>
      // shell survives it. The SECOND pass (below) runs after — store the
      // buyer-readable sentence, not the markup (issue #3201). Idempotent on
      // already-plain excerpts.
      const excerpt = item.bodyExcerpt ? stripHtml(item.bodyExcerpt) : null;
      // Hash honesty (issue #3201 review): the stored `content_hash` comes
      // from the shared parser (rss.server) hashing the MARKUP-SUFFUSED
      // pre-strip excerpt, while the STORED excerpt is this post-strip text.
      // Deterministic across polls — dedup/revision semantics are sound —
      // but any future code that recomputes the hash from the STORED columns
      // must hash the pre-strip text, or revisions bump spuriously.
      items.push({ ...item, canonicalUrl: canonical.toString(), bodyExcerpt: excerpt || null });
    }

    // The profile feed IS a bounded, source-authoritative window when it
    // returns items (same posture as the rss/website connectors; search-
    // shaped connectors — hn/threads — opt out because their windows are
    // ranked, not complete). Empty feeds stay un-anchored: an empty public
    // feed can be transient, so reconcile never mass-tombstones on it.
    return {
      ok: true,
      items,
      coverageLabel: "VERIFIED_PUBLIC_FEED",
      costUnits: 1,
      cursor: { profileFeedUrl: feedUrl, completeSnapshot: items.length > 0 },
    };
  },
};
