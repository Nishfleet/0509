import { Form, Link, useLoaderData, useRouteLoaderData } from "react-router";
import { useEffect } from "react";
import type { HeadersArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { PricingSection } from "~/components/pricing-section";
import { SubmitButton } from "~/components/submit-button";
import { NO_PRICING_PREVIEW, type LocalPricingPreview } from "~/lib/pricing-preview";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  organizationJsonLd,
  publicSeoMeta,
  webSiteJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { AppEnv } from "~/lib/env.server";
import type { RootLoaderData } from "~/root";
import type { PublicProofBrief } from "~/lib/public-proof.server";

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

// Published prices: the marketing page renders real per-plan Dodo prices in
// the server-rendered HTML instead of waiting for a client-side fetch. The
// Dodo checkout preview can take a second or two on a cold cache, so the
// document request waits only up to this bound; when Dodo is slower than the
// bound the loader degrades to the honest checkout-localized fallback and the
// existing client-side /api/pricing-preview fetch takes over near the fold.
const MARKETING_PRICING_SSR_TIMEOUT_MS = 2500;

async function pricingPreviewWithinBound({
  env,
  request,
}: {
  env: AppEnv;
  request: Request;
}): Promise<LocalPricingPreview | typeof NO_PRICING_PREVIEW> {
  const { previewDodo0509PlanPrices } = await import("~/lib/dodo-pricing.server");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const preview = await Promise.race([
      previewDodo0509PlanPrices({ env, request }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("pricing preview exceeded SSR bound")),
          MARKETING_PRICING_SSR_TIMEOUT_MS,
        );
      }),
    ]);
    return preview.available ? preview : NO_PRICING_PREVIEW;
  } catch {
    return NO_PRICING_PREVIEW;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
  const env = getEnv(context);
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

  if (pricingPreview.available) {
    // Buyer-country prices are embedded in this HTML, so the response must
    // never be shared-cached: a cached DE/EUR variant would otherwise be
    // served to a US visitor (and vice versa). The worker honors an
    // explicitly-set cache-control on cacheable HTML paths instead of
    // stamping the generic public, max-age=300 policy.
    return Response.json(
      { pricingPreview, commercialLaunch, proofBrief },
      { headers: { "Cache-Control": "private, max-age=300", Vary: "cookie" } },
    );
  }

  return { pricingPreview: NO_PRICING_PREVIEW, commercialLaunch, proofBrief };
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
      "Ad-spy tools are built for browsing creatives. Five to Nine is built around what changed: offers, prices, CTAs, and landing-page copy — each confirmed change saved with screenshots, page text, and links, then summarized in a brief. If you mainly want a large creative library, ours is narrower; the change evidence is deeper.",
  },
  {
    question: "How fast will I hear about changes?",
    answer:
      "Paid plans run scheduled checks every 3–6 hours: Scout every 6 hours, Starter every 3 hours, and Agency every 3 hours for its first 25 watchlists with the rest every 6 hours. Starter and Agency can also turn on instant alerts, so a confirmed change emails you as soon as a check finds it instead of waiting for the brief.",
  },
];

// Plain-text mirror of the rendered billing FAQ block for FAQPage JSON-LD.
// Keep in sync with the "Common billing questions" markup in the shared
// pricing-section component.
export function billingFaqJsonLdEntries(agencySaleOpen: boolean): FaqJsonLdEntry[] {
  return [
    {
      question: "What uses proof captures?",
      answer:
        "Scheduled scans are included with your plan and never touch your cap. A proof capture is used when Five to Nine saves a confirmed change with screenshots, page text, and the original link.",
    },
    {
      question: "Do unused proof captures roll over?",
      answer:
        "Included proof captures reset every month and do not roll over — the caps are generous. Purchased proof captures never expire and carry over until you use them.",
    },
    {
      question: "What changes on Agency?",
      answer:
        "Agency includes 75 watchlists, 250 Collections, 2,500 proof captures/month, team seats, API/MCP access, client reports, and shared report branding.",
    },
    agencySaleOpen
      ? {
          question: "How does Agency checkout work?",
          answer: `Agency checkout is available when pricing loads in your region. Email ${SUPPORT_EMAIL} if you want an account review before buying.`,
        }
      : {
          question: "Why is Agency held?",
          answer: `Agency is available by account review. Email ${SUPPORT_EMAIL} and we will confirm fit directly.`,
        },
    {
      question: "Where do prices come from?",
      answer:
        "Display prices load from Dodo Payments in your local currency at preview time. We never hardcode checkout amounts in the app.",
    },
  ];
}

/** "03:47 AM" style clock for a real capture timestamp. */
function proofTimeLabel(iso: string | null | undefined): string {
  const parsed = iso ? new Date(iso) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "recently";
  }
  return parsed.toLocaleString("en", {
    hour: "numeric",
    minute: "2-digit",
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
  const heroProofTime = proofBrief
    ? proofTimeLabel(proofBrief.proofTrail[0]?.capturedAt ?? proofBrief.fetchedAt)
    : null;
  const heroWall = proofBrief && heroTopHook ? (
    <h1 className="ld-wall">
      <span className="ld-row">“{truncateHook(heroTopHook, 30)}”</span>
      <span className="ld-row">
        {proofBrief.freshForLiveClaim ? "is the hook on" : "was the hook on"} {proofBrief.adCount}{" "}
        Meta ads <i className="ld-flag">{heroProofTime}</i>
      </span>
      <span className="ld-row ld-row-indent">linking to {proofBrief.website}.</span>
      <span className="ld-row">We saved the proof.</span>
    </h1>
  ) : (
    <h1 className="ld-wall">
      <span className="ld-row">Know when</span>
      <span className="ld-row">competitors change</span>
      <span className="ld-row ld-row-indent">
        <ins className="ld-ins">
          the offer<i className="ld-flag">proof</i>
        </ins>{" "}
        before
      </span>
      <span className="ld-row">the call.</span>
    </h1>
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
        <Link className="f9-announcement" to={publicSearchTrialPath}>
          <strong>Free search preview</strong>
          <span>Paste a competitor site — no account needed.</span>
        </Link>

        <p className="ld-case">
          <span className="ld-rec">Proof-backed brief</span>
          <span>A rival page changed while your growth team was offline</span>
        </p>

        <div className="ld-hero-grid">
          <div className="ld-hero-copy">
            {heroWall}

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
          </div>
        ) : (
          <div className="ld-caseboard ld-reveal" aria-label="Proof brief preview">
            <article className="ld-case-lead">
              <span className="ld-kicker">Meta Ad Library</span>
              <h3>One competitor, one brief, every change.</h3>
              <p>
                A real watch groups one competitor's actual captured changes — hooks, offers, CTAs,
                sources, and freshness — into one decision. The preview below shows the shape of
                the brief; the data lands after the first scan of a competitor.
              </p>
            </article>

            <article className="ld-case-card">
              <span className="ld-kicker">Decision summary</span>
              <h4>What changed, why it matters, what to do next</h4>
              <dl>
                <div>
                  <dt>What changed</dt>
                  <dd>Confirmed changes come with screenshots, page text, and the original link.</dd>
                </div>
                <div>
                  <dt>Why it matters</dt>
                  <dd>Each change is filed against the next review your team needs to make.</dd>
                </div>
                <div>
                  <dt>Urgency</dt>
                  <dd>Each capture is labelled fresh, recent, or sample — never implied.</dd>
                </div>
                <div>
                  <dt>Proof status</dt>
                  <dd>Saved screenshots and source links so the claim survives the closed tab.</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>Public Meta Ad Library and the landing pages those ads link to.</dd>
                </div>
                <div>
                  <dt>Freshness</dt>
                  <dd>Captured clocks are visible on every row.</dd>
                </div>
                <div>
                  <dt>Next action</dt>
                  <dd>Open the same public page and confirm in your own browser.</dd>
                </div>
              </dl>
            </article>

            <article className="ld-case-card">
              <span className="ld-kicker">Source trail</span>
              <ul className="ld-trail">
                {[
                  { id: "preview-hook", signal: "Hook captured", evidence: "Sample hook text — placeholder until the first scan.", source: "Meta Ad Library" },
                  { id: "preview-offer", signal: "Offer captured", evidence: "Sample offer detail — placeholder until the first scan.", source: "Landing page" },
                  { id: "preview-cta", signal: "CTA captured", evidence: "Sample CTA — placeholder until the first scan.", source: "Landing page" },
                ].map((item) => (
                  <li key={item.id}>
                    <strong>{item.signal}</strong>
                    <p>{item.evidence}</p>
                    <em>{item.source}</em>
                    <small>Preview — captured once a real watch runs.</small>
                  </li>
                ))}
              </ul>
              <p className="ld-trail-note" role="note">
                Paste a competitor website into the search preview to see real data. The brief
                stays honest about freshness and source.
              </p>
            </article>
          </div>
        )}
      </section>

      <section className="ld-how" id="platform">
        <div className="ld-section-head">
          <span className="ld-kicker">How it works</span>
          <h2>Three steps. The check keeps running.</h2>
        </div>
        <div className="ld-how-grid">
          {howSteps.map((step) => (
            <article key={step.step}>
              <span className="ld-step">{step.step}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ld-quiet" id="signal">
        <div className="ld-section-head">
          <span className="ld-kicker">Quiet by design</span>
          <h2>The signals you can trust.</h2>
        </div>
        <div className="ld-quiet-grid">
          {quietSignals.map((signal) => (
            <article key={signal.title}>
              <h3>{signal.title}</h3>
              <p>{signal.detail}</p>
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
        rootData={rootData}
        pricingPreview={routeData.pricingPreview?.available ? routeData.pricingPreview : null}
        agencySaleOpen={commercialLaunch.agencySaleOpen}
        variant="full"
        primaryCta={primaryCta}
        primaryLabel={primaryLabel}
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
