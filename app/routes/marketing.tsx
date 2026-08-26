import { Form, Link, useLoaderData, useRouteLoaderData } from "react-router";
import { useEffect } from "react";
import type { HeadersArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { PricingSection, billingFaqJsonLdEntries } from "~/components/pricing-section";
import { SubmitButton } from "~/components/submit-button";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  organizationJsonLd,
  publicSeoMeta,
  webSiteJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { noPricingPreview, pricingPreviewWithinBound } from "~/lib/pricing-preview.server";
import type { RootLoaderData } from "~/root";
import { pickFeaturedAdsInternalLink, type IndexableAdsLink } from "~/lib/ads-internal-links";
import type { PublicProofBrief } from "~/lib/public-proof.server";

export { planIntentPath, valueMathLabel, billingFaqJsonLdEntries } from "~/components/pricing-section";
export type { LocalPricingPreview } from "~/components/pricing-section";

// Kept under ~155 characters so search results show the whole line instead of
// truncating mid-sentence. The audit flagged the previous 166-character copy.
// Same claims, nothing new promised. The hero leads with what a scheduled
// reliability check proves every day: public landing-page change monitoring
// with screenshot evidence. Meta Ad Library coverage is named as a public
// source below and in the FAQ, not promised as a scheduled first-class lane
// until the Meta discovery reliability check publishes a green state on a
// schedule.
const marketingDescription =
  "Five to Nine watches competitors' landing pages for price, offer, and CTA changes, then sends screenshot evidence and change alerts before your next meeting.";
const publicSearchTrialPath =
  "/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com";

export const links: LinksFunction = () => canonicalLinks("/");

// React Router merges only Set-Cookie from loader responses into the document
// response; every other header needs a route-level `headers` export. Without
// this, the private cache-control set by the SSR-pricing loader would be
// dropped and the worker would stamp the generic public policy on HTML that
// embeds buyer-country prices.
export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders;
}

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine | Know when competitors change the offer",
    description: marketingDescription,
    pathname: "/",
  });

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
  const env = getEnv(context);
  const { emitFunnelHomeView } = await import("~/lib/funnel-measurement.server");
  emitFunnelHomeView(env, request);
  const commercialLaunch = publicCommercialLaunchSummary(env);
  const pricingPreview = await pricingPreviewWithinBound({ env, request });

  let proofBrief: PublicProofBrief | null = null;
  try {
    const { loadPublicProofBrief } = await import("~/lib/public-proof.server");
    proofBrief = await loadPublicProofBrief(env);
  } catch (error) {
    // A cache-read hiccup degrades to the honest "no live proof yet" state,
    // never a 500 and never a sample fixture.
    console.warn("Homepage proof brief load failed; rendering the honest state.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    proofBrief = null;
  }

  let indexableAdsLinks: IndexableAdsLink[] = [];
  try {
    const { loadIndexableAdsInternalLinks } = await import("~/lib/ads-internal-links.server");
    indexableAdsLinks = await loadIndexableAdsInternalLinks(env);
  } catch (error) {
    console.warn("Homepage indexable ads links load failed; omitting /ads links.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    indexableAdsLinks = [];
  }

  if (pricingPreview.available) {
    // Buyer-country prices are embedded in this HTML, so the response must
    // never be shared-cached: a cached DE/EUR variant would otherwise be
    // served to a US visitor (and vice versa). The worker honors an
    // explicitly-set cache-control on cacheable HTML paths instead of
    // stamping the generic public, max-age=300 policy.
    return Response.json(
      { pricingPreview, commercialLaunch, proofBrief, indexableAdsLinks },
      { headers: { "Cache-Control": "private, max-age=300", Vary: "cookie" } },
    );
  }

  return { pricingPreview: noPricingPreview, commercialLaunch, proofBrief, indexableAdsLinks };
}

/**
 * Real-data ticker events for the homepage marquee. Every timestamp traces to
 * a real capture clock from the proof brief; when no live proof exists the
 * ticker makes no time claims at all.
 */
function buildTickerEvents(brief: PublicProofBrief | null) {
  if (!brief) {
    return [
      ["Proof-backed monitoring", "screenshot evidence"],
      ["Every change keeps its source link", "source trail"],
      ["The brief files what moved", "morning brief"],
    ] as const;
  }

  const firstTime = proofTimeLabel(brief.proofTrail[0]?.capturedAt ?? brief.fetchedAt);
  const topHook = brief.insights.topHooks[0]?.trim() ?? "offer";
  return [
    [`${firstTime}`, `New Meta ad captured — “${truncateHook(topHook)}”`, "ad library"],
    [`${firstTime}`, `${brief.adCount} creatives on record for ${brief.website}`, "source links"],
    [`${firstTime}`, `Proof brief ready — ${brief.activeAdCount} active`, "brief"],
  ] as const;
}

const howSteps = [
  {
    step: "01",
    title: "Paste their website",
    detail: "Preview available competitor ads before creating an account. Coverage and freshness are labeled and can vary by source.",
  },
  {
    step: "02",
    title: "Paid monitoring keeps checking",
    detail:
      "Five to Nine checks their ads, offers, CTAs, and forms every 3–6 hours on paid plans and saves source-linked evidence for each confirmed change.",
  },
  {
    step: "03",
    title: "The brief stays focused",
    detail:
      "Your brief groups meaningful changes with screenshots, links, and one next review — daily on Starter and Agency, weekly on Scout.",
  },
] as const;

const quietSignals = [
  {
    title: "Baseline first",
    detail:
      "Your first scan records what is already running as a baseline — no alert flood for ads that existed before you started watching.",
  },
  {
    title: "One change, one alert",
    detail:
      "When a field moves you hear about it once. The same field stays quiet for 48 hours unless it changes again.",
  },
  {
    title: "Silence you can trust",
    detail:
      "Quiet periods still send a heartbeat — “All quiet — 24 ads checked” — so silence always means we looked and nothing moved.",
  },
] as const;

const backboneStats = [
  { value: "Paste", label: "competitor sites", detail: "start from the brands you already track" },
  { value: "Watch", label: "ads, pages, website moves", detail: "scheduled monitoring is included with your plan" },
  { value: "Prove", label: "screenshots and source links", detail: "no proof, no claim" },
  { value: "Brief", label: "the counter-move", detail: "what changed, why it matters, what to do next" },
] as const;

// Product FAQ. Every answer here is verified against shipped behavior
// (plan-entitlements.ts cadences, ad-source/browser-run public-page reads) —
// keep it that way: weaker honest phrasing beats a stronger claim.
export const productFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "Where does the data come from?",
    answer:
      "Public surfaces only: the Meta Ad Library — the same public archive anyone can open in a browser — plus the public landing pages those ads link to. Five to Nine never logs in to anything and never reads anything behind a login.",
  },
  {
    question: "Is this allowed?",
    answer:
      "Five to Nine only reads public data. The Meta Ad Library exists so anyone can inspect the ads a page is running, and landing pages are the pages competitors publish for every visitor. Every capture keeps its source link so you can open the same page yourself.",
  },
  {
    question: "Will competitors know I'm watching?",
    answer:
      "Their accounts are never touched — no follows, no logins, no interaction with their pages or profiles. Checks read the same public surfaces any visitor's browser loads, and nothing in Five to Nine notifies the advertiser.",
  },
  {
    question: "How is this different from ad-spy tools?",
    answer:
      "Ad-spy tools are built for browsing creatives, and some search many platforms’ ad libraries at once. Five to Nine monitors the Meta Ad Library only — other platforms’ ad libraries are out of scope — and is built around what changed: offers, prices, CTAs, and landing-page copy, each confirmed change saved with screenshots, page text, and links, then summarized in a brief. If you mainly want a large multi-platform creative library, ours is narrower; the change evidence is deeper.",
  },
  {
    question: "How fast will I hear about changes?",
    answer:
      "Paid plans run scheduled checks every 3–6 hours: Scout every 6 hours, Starter every 3 hours, and Agency every 3 hours for its first 25 watchlists with the rest every 6 hours. Starter and Agency can also turn on instant alerts, so a confirmed change emails you as soon as a check finds it instead of waiting for the brief.",
  },
];

/** A capture older than this is not "the hook on" a current ad — surfacing
 *  its date in the proof strip next to the "checked N hours ago" freshness
 *  stamp reads as a contradiction (a year-old date beside a 2-hour-old
 *  check). The strip swaps to non-date-bearing "on record" copy past this
 *  age. See #1076. The H1 is the chosen Safe buyer-job wall and never
 *  carries a capture date (#1173). */
const PROOF_CAPTURE_FRESH_DAYS = 30;

/** Days between a capture timestamp and `now`. Returns Infinity for an
 *  unparseable or missing timestamp so a bad date can never read as fresh. */
function captureAgeDays(iso: string | null | undefined, now: Date = new Date()): number {
  const raw = iso?.trim();
  if (!raw) return Infinity;
  // Date-only Meta Ad Library captures (YYYY-MM-DD) are UTC midnight; a full
  // ISO timestamp carries its own offset. Both parse the same way here.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return Infinity;
  return Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
}

/** "03:47 AM" style clock for a real capture timestamp; date-only captures
 *  (YYYY-MM-DD, no time of day) render as a calendar date instead of a
 *  fabricated "12:00 AM". */
function proofTimeLabel(iso: string | null | undefined): string {
  const raw = iso?.trim();
  if (!raw) {
    return "recently";
  }
  // Date-only Meta Ad Library captures carry no time of day; rendering them
  // as a clock would fabricate "12:00 AM". Show the calendar date instead.
  // timeZone: "UTC" is required because new Date("YYYY-MM-DD") is UTC midnight
  // and a local timezone behind UTC would otherwise shift the date back a day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return "recently";
    }
    // A capture from a prior (or, defensively, future) UTC year must carry
    // its year so "Sep 4" cannot read as a recent or upcoming same-year date
    // for a year-old capture. Same-year dates keep the compact rendering.
    // See issue 1032 (homepage proof wall year-stripping bug).
    const includeYear = parsed.getUTCFullYear() !== new Date().getUTCFullYear();
    return parsed.toLocaleString("en", {
      month: "short",
      day: "numeric",
      ...(includeYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "recently";
  }
  return parsed.toLocaleString("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function truncateHook(value: string, maxLength = 26) {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

/** Short host for the proof-shot URL bar, e.g. "facebook.com/ads/library". */
function proofShotHost(sourceUrl: string | null): string {
  if (!sourceUrl) return "source page";
  try {
    const url = new URL(sourceUrl);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname !== "/" ? url.pathname.slice(0, 24) : ""}`;
  } catch {
    return "source page";
  }
}

export default function MarketingRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const routeData = useLoaderData<typeof loader>();
  const commercialLaunch = routeData.commercialLaunch ?? {
    scoutSaleOpen: true,
    starterSaleOpen: true,
    agencySaleOpen: false,
  };
  const proofBrief = routeData.proofBrief ?? null;
  const featuredAdsLink = pickFeaturedAdsInternalLink(
    routeData.indexableAdsLinks ?? [],
    "nykaa.com",
  );
  const primaryCta = rootData.session ? "/app" : "/auth/signup";
  const primaryLabel = rootData.session ? "Open app" : "Create account";

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const root = document.documentElement;
    root.classList.add("ld-motion");
    const targets = Array.from(document.querySelectorAll(".ld-reveal"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-seen");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    targets.forEach((el) => observer.observe(el));

		// Fail-safe: content that has reached the viewport must never stay hidden
		// if the observer or reveal animation misbehaves. Shortly after the page
		// has fully loaded, unstick only visible/previous sections so below-fold
		// sections keep their normal stagger (observed live 2026-07-13:
		// .ld-case-card stuck at opacity 0 with parent .is-seen — the animation
		// clock can freeze at 0 in hidden/background tabs, leaving the
		// backwards-fill "from" state applied indefinitely).
		let revealFallbackTimer = 0;
		const revealRemaining = () => {
			const stuckTargets = targets.filter(
				(el) =>
					!el.classList.contains("is-seen") &&
					el.getBoundingClientRect().top < window.innerHeight,
			);
			for (const el of stuckTargets) {
				el.classList.add("is-seen");
				observer.unobserve(el);
			}
			// Jump any still-pending reveal animations straight to their end
			// state so a frozen animation timeline cannot keep content hidden.
			if (typeof document.getAnimations === "function") {
				for (const animation of document.getAnimations()) {
					if ((animation as CSSAnimation).animationName === "ld-reveal-in") {
						try {
							animation.finish();
						} catch {
							// Ignore animations that cannot be finished.
						}
					}
				}
			}
		};
		const scheduleRevealFallback = () => {
			window.clearTimeout(revealFallbackTimer);
			revealFallbackTimer = window.setTimeout(revealRemaining, 3000);
		};
		if (document.readyState === "complete") {
			scheduleRevealFallback();
		} else {
			window.addEventListener("load", scheduleRevealFallback, { once: true });
		}

    return () => {
			window.clearTimeout(revealFallbackTimer);
			window.removeEventListener("load", scheduleRevealFallback);
      observer.disconnect();
      root.classList.remove("ld-motion");
    };
  }, []);

  const tickerEvents = buildTickerEvents(proofBrief);

  const tickerRun = (
    <span className="ld-ticker-run">
      <em>Proof brief</em>
      {tickerEvents.map(([time, event, evidence]) => (
        <span className="ld-ticker-item" key={event}>
          <b>{time}</b> {event} <small>[{evidence}]</small>
        </span>
      ))}
    </span>
  );

  const structuredFaq = faqPageJsonLd([
    ...productFaqEntries,
    ...billingFaqJsonLdEntries(commercialLaunch.agencySaleOpen),
  ]);

  const heroTopHook = proofBrief?.insights.topHooks[0]?.trim() ?? null;
  const heroCaptureIso = proofBrief
    ? proofBrief.proofTrail[0]?.capturedAt ?? proofBrief.fetchedAt
    : null;
  const heroProofTime = proofBrief ? proofTimeLabel(heroCaptureIso) : null;
  // A capture older than PROOF_CAPTURE_FRESH_DAYS is not "the hook on" a
  // current ad. Surfacing its date next to the "checked N hours ago"
  // freshness stamp reads as a contradiction, so the proof strip drops the
  // date and reframes to "on record" copy. See #1076. The H1 no longer
  // carries capture dates (#1173 / BET 9 Safe).
  const heroCaptureStale = proofBrief
    ? captureAgeDays(heroCaptureIso) > PROOF_CAPTURE_FRESH_DAYS
    : false;
  // Chosen BET 9 direction: Safe. Buyer + job stay in the H1 even when live
  // Nykaa proof is present. See docs/design/hero-directions/CHOSEN.md.
  const heroWall = (
    <h1 className="ld-wall">
      <span className="ld-row">Growth teams</span>
      <span className="ld-row">who track competitors</span>
      <span className="ld-row ld-row-indent">
        know the{" "}
        <ins className="ld-ins">
          offer<i className="ld-flag">proof</i>
        </ins>{" "}
        before
      </span>
      <span className="ld-row">the call.</span>
    </h1>
  );

  const heroProofStrip =
    proofBrief && heroTopHook ? (
      <aside className="ld-proof-strip" aria-label="Live proof brief">
        <div className="ld-proof-strip-head">
          <span className="ld-proof-live">Live proof</span>
          <b>We saved the proof — {proofBrief.website}</b>
          <span className="ld-proof-time">
            {heroCaptureStale
              ? "On record · Meta Ad Library"
              : `Captured ${heroProofTime} · Meta Ad Library`}
          </span>
        </div>
        <div className="ld-proof-strip-body">
          <div className="ld-proof-hook">
            <span className="ld-proof-quote">“{truncateHook(heroTopHook, 48)}”</span>
            <span className="ld-proof-attrib">
              {heroCaptureStale ? (
                <>
                  is a hook on record across {proofBrief.adCount} Meta ads linking to{" "}
                  {proofBrief.website}. We saved every one.
                </>
              ) : (
                <>
                  {proofBrief.freshForLiveClaim ? "is the hook on" : "was the hook on"}{" "}
                  {proofBrief.adCount} Meta ads linking to {proofBrief.website}. We saved
                  every one.
                </>
              )}
            </span>
          </div>
          <div className="ld-proof-trail">
            <ul>
              {proofBrief.proofTrail.map((item) => (
                <li key={item.id}>
                  <span className="ld-proof-signal">{item.signal}</span>
                  {truncateHook(item.evidence, 48)}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="ld-proof-strip-foot">
          Every row links to the same public page. No proof, no claim.
        </div>
      </aside>
    ) : (
      <aside className="ld-proof-strip" aria-label="Live proof brief">
        <div className="ld-proof-strip-head">
          <span className="ld-proof-live">Live proof</span>
          <b>No live proof yet</b>
        </div>
        <div className="ld-proof-strip-body">
          <div className="ld-proof-hook">
            <span className="ld-proof-quote">We haven’t captured this competitor recently.</span>
            <span className="ld-proof-attrib">
              Run the public search preview to see current ads and sources.
            </span>
          </div>
        </div>
      </aside>
    );

  const heroShotCards = proofBrief ? (
    proofBrief.proofTrail.map((item) => (
      <a
        className="ld-shot"
        key={item.id}
        href={item.sourceUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
      >
        <span className="ld-stamp ld-stamp-green">
          {item.signal} · {proofTimeLabel(item.capturedAt)}
        </span>
        <span className="ld-shot-bar">
          <i />
          <i />
          <i />
          <span>{proofShotHost(item.sourceUrl)}</span>
        </span>
        <span className="ld-shot-body">
          <strong>{truncateHook(item.evidence, 60)}</strong>
          <span className="ld-shot-meta">Open the same public page →</span>
        </span>
      </a>
    ))
  ) : (
    <div className="ld-shot ld-shot-empty">
      <span className="ld-stamp">No live proof yet</span>
      <span className="ld-shot-body">
        <strong>We haven’t captured this competitor recently.</strong>
        <span className="ld-shot-meta">
          <Link to="/search">Run the public search preview →</Link>
        </span>
      </span>
    </div>
  );

  const briefStrip = proofBrief ? (
    <aside className="ld-brief-strip" aria-label="Proof brief">
      <b>Proof brief — {proofBrief.activeAdCount} of {proofBrief.adCount} ads active</b>
      <ul>
        {proofBrief.proofTrail.map((item) => (
          <li key={item.id}>{item.signal}: {truncateHook(item.evidence, 48)}</li>
        ))}
      </ul>
      <small>
        Real captures from the Meta Ad Library — last checked {proofBrief.checkedAgoLabel}. Every
        row links to the same public page.
      </small>
    </aside>
  ) : (
    <aside className="ld-brief-strip" aria-label="Proof brief">
      <b>Proof brief</b>
      <ul>
        <li>Every change keeps a screenshot and source link</li>
        <li>The brief files what moved and why it matters</li>
        <li>No proof, no claim</li>
      </ul>
      <small>Live proof appears here after the first scan of a competitor.</small>
    </aside>
  );

  return (
    <main className="f9-home">
      <script {...jsonLdScriptProps(organizationJsonLd())} />
      <script {...jsonLdScriptProps(webSiteJsonLd())} />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <div className="ld-ticker" aria-hidden="true">
        <div className="ld-ticker-belt">
          {tickerRun}
          {tickerRun}
        </div>
      </div>
      <p className="ld-sr-only">
        {proofBrief
          ? `A real proof brief for ${proofBrief.competitorName}: ${proofBrief.adCount} Meta ads with captured hooks, offers, and source links.`
          : "Five to Nine watches competitors' Meta ads and landing pages, then sends screenshot evidence and change alerts."}
      </p>

      <MarketingNav />

      <section className="ld-hero">
        <div className="ld-hero-callouts">
          <Link className="f9-announcement" to={publicSearchTrialPath}>
            <strong>Free search preview</strong>
            <span>Paste a competitor site — no account needed.</span>
          </Link>

          {/* MagicBrief wind-down callout (issue 965). Uses the migration page's
              existing headline, not new copy. Revertible per the issue rollback.
              #1212 sits both pills on one desktop row so the search submit
              stays inside 1440x900 with a Nykaa-length wall. */}
          <Link
            className="f9-announcement f9-migration-callout"
            to="/compare/magicbrief"
          >
            <strong>Moving from MagicBrief?</strong>
            <span>Bring your competitor list. Gain the receipts.</span>
          </Link>
        </div>

        <p className="ld-case">
          <Link className="ld-rec" to="/proof">
            Proof-backed brief
          </Link>
          <span>For growth teams who track competitors</span>
        </p>

        <div className="ld-hero-grid">
          <div className="ld-hero-copy">
            {heroWall}

            {heroProofStrip}

            <p className="ld-deck-copy">
              Your growth team would&rsquo;ve found out from a client. Five to Nine watches competitors&rsquo;
              landing pages for price, offer, and CTA changes, saves the screenshots, and files the brief —{" "}
              <b>before your alarm goes off.</b>
            </p>

            <Form className="ld-command" method="get" action="/search" aria-label="Public search preview">
              <input
                aria-label="Competitor website"
                name="website"
                placeholder="paste-their-website.com…"
                type="text"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
              />
              <button type="submit">
                Preview available ads <span aria-hidden="true">→</span>
              </button>
            </Form>

            <div className="f9-hero-proof-actions" aria-label="Proof brief before signup">
              <Link to={publicSearchTrialPath}>Try with Nykaa</Link>
              <a href="#demo">Review the proof brief</a>
            </div>

            <p className="ld-honest" role="note">
              <strong>No account needed.</strong> Preview one competitor now. We label source,
              freshness, coverage, cached results, and proof freshness separately.
            </p>
          </div>

          <div className="ld-hero-side">
            <div className="ld-stack" aria-label="Real captured competitor evidence">
              <svg className="ld-thread" viewBox="0 0 420 560" aria-hidden="true">
                <path
                  d="M190 80 C 300 120, 310 190, 260 250 M 240 340 C 160 390, 150 430, 180 470"
                  stroke="#E0442C"
                  strokeWidth="1.5"
                  fill="none"
                  strokeDasharray="5 4"
                />
              </svg>
              {heroShotCards}
              {proofBrief ? (
                <span className="ld-diff-clip">Real proof saved</span>
              ) : null}
            </div>

            {briefStrip}
          </div>
        </div>

      </section>

      <section className="ld-proof" id="demo">
        <div className="ld-section-head">
          <span className="ld-kicker">Proof brief</span>
          <h2>{proofBrief ? "The morning brief — from a real watch" : "See the brief before you sign up"}</h2>
          <p>
            {proofBrief
              ? `Real captures from the ${proofBrief.adLibraryCountry ? `${proofBrief.adLibraryCountry} Ad Library` : "Meta Ad Library"} for ${proofBrief.website}, checked ${proofBrief.checkedAgoLabel}. Every row links to the same public page you can open yourself.`
              : "A brief groups one competitor's real captured changes — hooks, offers, CTAs, sources, and freshness — into one decision. Live proof appears here after the first scan; preview what it looks like with the search preview."}
          </p>
          <div className="ld-proof-actions">
            <Link to={publicSearchTrialPath}>Try the search preview</Link>
            <Link to="/competitor-monitoring">Read the methodology</Link>
            {featuredAdsLink ? <Link to={featuredAdsLink.path}>See a live example</Link> : null}
            <Link to="/proof">What we refuse to alert on</Link>
            <a href="#pricing">See plans</a>
          </div>
        </div>

        {proofBrief ? (
          <div className="ld-caseboard ld-reveal" aria-label="Real Five to Nine evidence trail">
            <article className="ld-case-lead">
              <span className="ld-kicker">
                {proofBrief.adLibraryCountry
                  ? `${proofBrief.adLibraryCountry} Ad Library`
                  : "Meta Ad Library"}
              </span>
              <h3>{proofBrief.competitorName}</h3>
              <p>{proofBrief.summary}</p>
            </article>

            <article className="ld-case-card">
              <span className="ld-kicker">Decision summary</span>
              <h4>{proofBrief.decision.subject}</h4>
              <p>{proofBrief.decision.whyItMatters}</p>
              <dl>
                <div>
                  <dt>What changed</dt>
                  <dd>{proofBrief.decision.whatChanged}</dd>
                </div>
                <div>
                  <dt>Why it matters</dt>
                  <dd>{proofBrief.decision.whyItMatters}</dd>
                </div>
                <div>
                  <dt>Urgency</dt>
                  <dd>{proofBrief.decision.priority}</dd>
                </div>
                <div>
                  <dt>Proof status</dt>
                  <dd>{proofBrief.decision.proofStatus}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{proofBrief.decision.source}</dd>
                </div>
                <div>
                  <dt>Freshness</dt>
                  <dd>{proofBrief.decision.freshness}</dd>
                </div>
                <div>
                  <dt>Next action</dt>
                  <dd>
                    {proofBrief.proofTrail[0]?.sourceUrl ? (
                      <a href={proofBrief.proofTrail[0].sourceUrl} target="_blank" rel="noreferrer">
                        {proofBrief.decision.nextAction} →
                      </a>
                    ) : (
                      proofBrief.decision.nextAction
                    )}
                  </dd>
                </div>
              </dl>
            </article>

            <article className="ld-case-card">
              <span className="ld-kicker">Source trail</span>
              <ul className="ld-trail">
                {proofBrief.proofTrail.map((item) => (
                  <li key={item.id}>
                    <strong>{item.signal}</strong>
                    <p>{item.evidence}</p>
                    <em>
                      {item.sourceUrl ? (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                          {item.source} — open the same page →
                        </a>
                      ) : (
                        item.source
                      )}
                    </em>
                    <small>Captured {proofTimeLabel(item.capturedAt)}</small>
                  </li>
                ))}
              </ul>
              <p className="ld-trail-note" role="note">
                Every row above is a real capture. Open the source link and check it yourself —
                saved watches attach screenshots, page text, and original links.
              </p>
            </article>

            <article className="ld-case-card">
              <span className="ld-kicker">Client-ready view</span>
              <h4>Report preview</h4>
              <ul className="ld-trail">
                {proofBrief.reportRows.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            </article>

            <div className="ld-intel" aria-label="Insight depth from real captures">
              <article>
                <span className="ld-kicker">Top hooks</span>
                <ul>
                  {proofBrief.insights.topHooks.map((hook) => (
                    <li key={hook}>{hook}</li>
                  ))}
                </ul>
              </article>
              <article>
                <span className="ld-kicker">Media mix</span>
                <ul>
                  {proofBrief.insights.mediaMix.map((item) => (
                    <li key={item.channel}>
                      <strong>{item.channel}</strong>
                      <em>{item.count}</em>
                    </li>
                  ))}
                </ul>
              </article>
              <article>
                <span className="ld-kicker">Timeline</span>
                <ul>
                  {proofBrief.insights.timeline.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
              <article>
                <span className="ld-kicker">Brief export</span>
                <p className="ld-export">
                  {proofBrief.decision.subject}
                  {"\n"}Priority: {proofBrief.decision.priority}
                  {"\n"}Proof: {proofBrief.adCount} real captures — {proofBrief.fetchedAt}
                </p>
              </article>
            </div>
          </div>
        ) : (
          <div className="ld-caseboard ld-reveal" aria-label="No live proof yet">
            <article className="ld-case-card ld-case-empty">
              <span className="ld-kicker">No live proof right now</span>
              <h4>We haven’t captured this competitor recently.</h4>
              <p>
                The proof brief renders real captures from the public Meta Ad Library. Run the
                search preview to see current ads and sources, or create an account to start a
                scheduled watch.
              </p>
              <div className="ld-proof-actions">
                <Link to={publicSearchTrialPath}>Run the search preview</Link>
                <Link to="/auth/signup">Create an account</Link>
              </div>
            </article>
          </div>
        )}
      </section>

      <section className="ld-how" id="platform">
        <h2>Know when competitors change the offer.</h2>
        <div className="ld-how-grid ld-reveal">
          {howSteps.map((item) => (
            <article key={item.step}>
              <span className="ld-step">{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet" id="signal">
        <div className="ld-section-head">
          <span className="ld-kicker">Zero-noise monitoring</span>
          <h2>Signal, not noise.</h2>
          <p>
            Ad-spy tools drown teams in &ldquo;new ad&rdquo; pings. Five to Nine alerts you when
            something actually moved — and tells you what it checked when nothing did.
          </p>
        </div>
        <div className="ld-quiet-grid ld-reveal" aria-label="Zero-noise monitoring points">
          {quietSignals.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-stats">
        <h2>Stop finding out after the sales call.</h2>
        <div className="ld-stats-belt ld-reveal" aria-label="Five to Nine signal model">
          {backboneStats.map((stat) => (
            <article key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
              <p>{stat.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <PricingSection
        commercialLaunch={commercialLaunch}
        initialPricingPreview={routeData.pricingPreview?.available ? routeData.pricingPreview : null}
      />

      <section className="ld-quiet" id="faq">
        <div className="ld-pricing-faq ld-reveal" aria-label="Product FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common product questions</h3>
          <dl className="proof-trail-list">
            {productFaqEntries.map((entry) => (
              <div key={entry.question}>
                <dt>{entry.question}</dt>
                <dd>{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="ld-final">
        <h2>
          Start the watch <span aria-hidden="true">→</span>
        </h2>
        <Form className="f9-email-cta" method="get" action={primaryCta}>
          {rootData.session ? (
            <span className="f9-email-state">Account ready</span>
          ) : (
            <input
              aria-label="Work email"
              name="email"
              placeholder="work@company.com…"
              type="email"
              autoComplete="email"
              spellCheck={false}
            />
          )}
          <SubmitButton getAction={primaryCta} pendingLabel="Redirecting…">{primaryLabel}</SubmitButton>
        </Form>
        <p>Public search preview is free — no account. Paid plans run scheduled checks every 3–6 hours and email you the proof.</p>
      </section>

      <MarketingFooter />
    </main>
  );
}
