/**
 * /sample-brief — one real Monday brief on a public page (issue #2136).
 *
 * Growth deep-pass 2 (2026-09-09): the strongest proof of the Monday brief is
 * the brief itself. The loader picks the newest indexable brand domain — the
 * sitemap's own indexability signal via `loadIndexableAdsInternalLinks`, so a
 * demo, stale, empty, or emergency-braked domain can never be picked — that
 * has at least one stored watch_event in the last 30 days, and renders those
 * stored rows through the SAME `buildDigestEmail` renderer customer inboxes
 * get (via `buildSampleBriefDigest`). When no indexable domain has a filed
 * change, the honest all-quiet brief variant renders for the newest indexable
 * domain with its real stored run counts; when no brand is indexable at all,
 * the page renders an explicit empty state (still 200).
 *
 * Bounded D1 reads only — this route never triggers live scraping, a Browser
 * Rendering run, or a Meta API call.
 *
 * Privacy contract (issue must-nots): no customer workspace name, email,
 * watchlist id, or non-indexable domain leaves this page. Items carry no
 * event/watchlist ids, so the digest renderer's deep links fall back to the
 * public brand page; the accountable-reviewer line renders the generic
 * "Workspace owner" fallback; and event titles/summaries are scrubbed of the
 * exact stored watchlist name (system-generated summaries can embed it)
 * before rendering, replaced by the public brand name.
 */

import { Link, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import type { IndexableAdsLink } from "~/lib/ads-internal-links";
import { digestMetadataForEvent } from "~/lib/change-intelligence";
import { registrableDomainFromLandingPage } from "~/lib/competitor-website";
import type { WatchEventRow } from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import type { DigestTrustItem } from "~/lib/proof-classification";
import {
  canonicalLinks,
  canonicalUrl,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { WatchEventRecord } from "~/lib/types";

export const SAMPLE_BRIEF_PUBLIC_PATH = "/sample-brief";

/** Public sample window: only events captured in the last 30 days qualify. */
const SAMPLE_BRIEF_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Hard bound on the one event scan across all advertiser watchlists. */
const SAMPLE_BRIEF_EVENT_SCAN_LIMIT = 400;
/** Hard bound on rendered digest items per domain (newest first). */
const SAMPLE_BRIEF_ITEMS_PER_DOMAIN = 25;
/** Hard bound on the quiet-variant run-stats scan. */
const SAMPLE_BRIEF_RUN_SCAN_LIMIT = 500;

const pageTitle = "A real Monday brief, on a public page | Five to Nine";
const pageDescription =
  "See one real Monday brief: stored competitor landing-page and ad changes for a public brand, with capture dates and source links intact — the same brief customers get by email.";

export const links: LinksFunction = () => canonicalLinks(SAMPLE_BRIEF_PUBLIC_PATH);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: SAMPLE_BRIEF_PUBLIC_PATH,
  });

interface SampleBriefLoaderData {
  kind: "brief" | "quiet" | "empty";
  brandName: string | null;
  domain: string | null;
  brandPath: string | null;
  digestHtml: string | null;
  signupUrl: string;
}

export async function loader({ context }: LoaderFunctionArgs): Promise<SampleBriefLoaderData> {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const now = new Date();
  const periodStart = new Date(now.getTime() - SAMPLE_BRIEF_WINDOW_MS);

  let links: IndexableAdsLink[] = [];
  try {
    const { loadIndexableAdsInternalLinks } = await import("~/lib/ads-internal-links.server");
    links = await loadIndexableAdsInternalLinks(env);
  } catch (error) {
    console.warn("Sample-brief indexable link load failed; rendering the empty state.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    links = [];
  }

  if (!env.DB || links.length === 0) {
    return emptySampleBriefData();
  }

  // Links arrive newest-first (the sitemap's fetched_at ordering); the first
  // domain with a filed change in the window wins the page.
  let eventsByDomain: Map<string, SampleBriefEvent[]>;
  try {
    eventsByDomain = await loadRecentEventsByDomain(env, periodStart);
  } catch (error) {
    console.warn("Sample-brief event read failed; rendering the empty state.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return emptySampleBriefData();
  }

  for (const link of links) {
    const events = eventsByDomain.get(link.domain);
    if (!events || events.length === 0) {
      continue;
    }
    const digest = await renderSampleBriefDigest({
      brandName: link.name,
      domain: link.domain,
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
      items: events.map((entry) => sampleBriefItemForEvent(entry, link.name)),
      heartbeat: null,
    });
    return {
      kind: "brief",
      brandName: link.name,
      domain: link.domain,
      brandPath: link.path,
      digestHtml: digest.html,
      signupUrl: sampleBriefSignupUrl(link.domain),
    };
  }

  // Quiet-brief variant: no indexable domain has a filed change in the
  // window, so the newest indexable domain shows the honest all-quiet brief
  // with its real stored run counts.
  const newest = links[0]!;
  let heartbeat = { runs: 0, watchlistsChecked: 0, adsSeen: 0 };
  try {
    heartbeat = await loadDomainRunHeartbeat(env, newest.domain, periodStart);
  } catch (error) {
    console.warn("Sample-brief run-stats read failed; rendering zero counts.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
  const quietDigest = await renderSampleBriefDigest({
    brandName: newest.name,
    domain: newest.domain,
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    items: [],
    heartbeat,
  });
  return {
    kind: "quiet",
    brandName: newest.name,
    domain: newest.domain,
    brandPath: newest.path,
    digestHtml: quietDigest.html,
    signupUrl: sampleBriefSignupUrl(newest.domain),
  };
}

export default function SampleBriefRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <main className="f9-home f9-sample-brief-page">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: SAMPLE_BRIEF_PUBLIC_PATH,
          }),
        )}
      />
      <MarketingNav />

      <section className="ld-section" aria-labelledby="sample-brief-title">
        <div className="ld-section-head">
          <span className="ld-kicker">Sample brief</span>
          <h1 id="sample-brief-title">
            {data.brandName
              ? `A real Monday brief for ${data.brandName}`
              : "A real Monday brief"}
          </h1>
          <p>
            This is not a mockup. It is the same Monday brief Five to Nine customers get by
            email, rendered from stored change events for a public brand — capture dates and
            source links intact.
          </p>
        </div>

        {data.kind === "empty" || !data.digestHtml ? (
          <p>
            No stored brief is available to show right now. The moment a tracked public brand
            has a filed change, this page shows the real brief here — no sample data, no
            mockup.
          </p>
        ) : (
          <div className="f9-sample-brief-document">
            <div dangerouslySetInnerHTML={{ __html: data.digestHtml }} />
          </div>
        )}

        <p className="f9-sample-brief-cta">
          <a className="ld-cta-button" href={data.signupUrl}>
            Get this every Monday, free
          </a>
        </p>
        {data.brandPath && data.brandName ? (
          <p className="f9-sample-brief-brand">
            The live public brand page for {data.brandName} is{" "}
            <Link to={data.brandPath}>here</Link>.
          </p>
        ) : null}
      </section>

      <MarketingFooter />
    </main>
  );
}

interface SampleBriefEvent {
  event: WatchEventRecord;
  /** Stored customer watchlist name — scrubbed from rendered text, never rendered. */
  watchlistName: string;
}

/**
 * One bounded scan of recent digest-eligible watch events across every active
 * advertiser watchlist, grouped by the registrable domain each watchlist
 * tracks (the established watchlist identity rule: an advertiser watchlist's
 * target_id is its normalized website URL). Same eligibility bar as the
 * customer digest — confirmed events, or provisional detections above the
 * digest importance threshold — so the public sample is the brief a customer
 * would actually receive; suppressed/invalidated rows never qualify.
 */
async function loadRecentEventsByDomain(
  env: AppEnv,
  since: Date,
): Promise<Map<string, SampleBriefEvent[]>> {
  const { queryAll } = await import("~/lib/data/d1.server");
  const { toWatchEventRecord } = await import("~/lib/data/watchlist-rows.server");
  const { isCustomerDigestEligibleEvent } = await import("~/lib/delivery-policy.server");
  const rows = await queryAll<
    WatchEventRow & { watchlist_name: string; watchlist_target_id: string }
  >(
    env,
    `
      SELECT watch_event.*, watchlist.name AS watchlist_name, watchlist.target_id AS watchlist_target_id
      FROM watch_event
      INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
      WHERE watchlist.target_type = 'advertiser'
        AND watchlist.is_active = 1
        AND watch_event.status IN ('confirmed', 'detected', 'proof_pending')
        AND watch_event.created_at >= ?
      ORDER BY watch_event.created_at DESC, watch_event.id DESC
      LIMIT ?
    `,
    since.toISOString(),
    SAMPLE_BRIEF_EVENT_SCAN_LIMIT,
  );
  const byDomain = new Map<string, SampleBriefEvent[]>();
  for (const row of rows) {
    const domain = registrableDomainFromLandingPage(row.watchlist_target_id);
    if (!domain) {
      continue;
    }
    const event = toWatchEventRecord(row);
    if (!isCustomerDigestEligibleEvent(event)) {
      continue;
    }
    const list = byDomain.get(domain) ?? [];
    if (list.length >= SAMPLE_BRIEF_ITEMS_PER_DOMAIN) {
      continue;
    }
    list.push({ event, watchlistName: row.watchlist_name });
    byDomain.set(domain, list);
  }
  return byDomain;
}

/**
 * Real stored run counts for one domain's watchlists in the window — the
 * quiet variant's heartbeat. Mirrors getSuccessfulRunStatsForUserBetween
 * (succeeded, non-degraded runs; adsSeen from the run summary) but scoped by
 * tracked domain instead of user.
 */
async function loadDomainRunHeartbeat(env: AppEnv, domain: string, since: Date) {
  const { queryAll } = await import("~/lib/data/d1.server");
  const rows = await queryAll<{
    watchlist_id: string;
    target_id: string;
    ads_seen: number | null;
  }>(
    env,
    `
      SELECT watchlist_run.watchlist_id, watchlist.target_id,
        COALESCE(json_extract(watchlist_run.summary_json, '$.adsSeen'), 0) AS ads_seen
      FROM watchlist_run
      INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
      WHERE watchlist.target_type = 'advertiser'
        AND watchlist.is_active = 1
        AND watchlist_run.status = 'succeeded'
        AND COALESCE(json_extract(watchlist_run.summary_json, '$.scanStatus'), '') != 'degraded'
        AND watchlist_run.finished_at >= ?
      ORDER BY watchlist_run.finished_at DESC
      LIMIT ?
    `,
    since.toISOString(),
    SAMPLE_BRIEF_RUN_SCAN_LIMIT,
  );
  let runs = 0;
  let adsSeen = 0;
  const watchlistIds = new Set<string>();
  for (const row of rows) {
    if (registrableDomainFromLandingPage(row.target_id) !== domain) {
      continue;
    }
    runs += 1;
    adsSeen += Number(row.ads_seen ?? 0);
    watchlistIds.add(row.watchlist_id);
  }
  return { runs, watchlistsChecked: watchlistIds.size, adsSeen };
}

function sampleBriefItemForEvent(input: SampleBriefEvent, brandName: string): DigestTrustItem {
  const { event, watchlistName } = input;
  return {
    eventType: event.eventType,
    title: scrubWatchlistName(event.title, watchlistName, brandName),
    summary: scrubWatchlistName(event.summary, watchlistName, brandName),
    createdAt: event.createdAt,
    // The public group label is the brand — never the customer's watchlist name.
    watchlistName: brandName,
    // Deliberately no id/eventId/watchlistId: the digest renderer's deep links
    // then resolve to the public fullDigestUrl instead of /app/watchlists.
    metadata: digestMetadataForEvent(event),
  };
}

/**
 * System-generated event text can embed the customer's watchlist name (e.g.
 * "A new ad entered <name>."). Replace exact occurrences with the public
 * brand name so no customer-chosen string reaches the page.
 */
function scrubWatchlistName(text: string, watchlistName: string, brandName: string): string {
  const needle = watchlistName.trim();
  if (!needle) {
    return text;
  }
  return text.split(needle).join(brandName);
}

async function renderSampleBriefDigest(input: {
  brandName: string;
  domain: string;
  periodStart: string;
  periodEnd: string;
  items: DigestTrustItem[];
  heartbeat: { runs: number; watchlistsChecked: number; adsSeen: number } | null;
}) {
  const { buildSampleBriefDigest } = await import("~/lib/digest-email.server");
  return buildSampleBriefDigest({
    brandName: input.brandName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    items: input.items,
    heartbeat: input.heartbeat,
    fullDigestUrl: canonicalUrl(`/ads/${input.domain}`),
    signupUrl: `${canonicalUrl("/auth/signup")}${sampleBriefSignupQuery(input.domain)}`,
    supportEmail: SUPPORT_EMAIL,
    supportMailto: SUPPORT_MAILTO,
  });
}

/** The issue-specified CTA target: signup with the competitor prefilled. */
function sampleBriefSignupUrl(domain: string | null): string {
  return `/auth/signup${sampleBriefSignupQuery(domain)}`;
}

function sampleBriefSignupQuery(domain: string | null): string {
  const params = new URLSearchParams();
  if (domain) {
    params.set("competitor", domain);
  }
  // The allowlisted attribution marker (SAMPLE_BRIEF_SIGNUP_SOURCE in
  // ~/lib/signup-source) — kept as a literal here because that module is
  // server-only; tests/sample-brief.route.test.ts pins the two together.
  params.set("source", "sample_brief");
  return `?${params.toString()}`;
}

function emptySampleBriefData(): SampleBriefLoaderData {
  return {
    kind: "empty",
    brandName: null,
    domain: null,
    brandPath: null,
    digestHtml: null,
    signupUrl: sampleBriefSignupUrl(null),
  };
}
