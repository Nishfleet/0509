import { Form, Link, useLoaderData, useRouteLoaderData } from "react-router";
import { useEffect, useState } from "react";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { SubmitButton } from "~/components/submit-button";
import { demoProof } from "~/lib/demo-proof";
import { dodoAnnualSavingsIsValid } from "~/lib/dodo-pricing-display";
import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";
import { EVIDENCE_USAGE_CUSTOMER_COPY } from "~/lib/pricing";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { RootLoaderData } from "~/root";

const marketingDescription =
  "Five to Nine tracks competitor ads, offers, and landing pages so revenue teams can react before deals move.";
const publicSearchTrialPath = "/search?website=https%3A%2F%2Fnykaa.com";

export const links: LinksFunction = () => canonicalLinks("/");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine | Know when competitors change the offer",
    description: marketingDescription,
    pathname: "/",
  });

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { previewDodo0509PlanPrices } = await import("~/lib/dodo-pricing.server");
  const { summarizeCommercialLaunch } = await import("~/lib/commercial-launch-gate.server");
  const env = getEnv(context);

  return {
    pricingPreview: await previewDodo0509PlanPrices({
      env,
      request,
    }),
    commercialLaunch: summarizeCommercialLaunch(env),
  };
}

const tickerEvents = [
  ["02:14", "New Meta ad set — third repeat of the routine-first hook", "ad library"],
  ["03:47", "Pricing page — plan renamed, anchor price added", "screenshot saved"],
  ["04:58", "Lead form appeared on the campaign landing page", "page text + link"],
  ["05:09", "Morning brief delivered — 3 changes, 9 pieces of evidence", "sample watch"],
] as const;

const howSteps = [
  {
    step: "01",
    title: "Paste their website",
    detail: "See a competitor's live ads immediately — free, before any account exists.",
  },
  {
    step: "02",
    title: "We watch while you sleep",
    detail:
      "Five to Nine checks their ads, offers, CTAs, and forms, and saves screenshots, page text, and links for every change.",
  },
  {
    step: "03",
    title: "The morning brief lands",
    detail:
      "What changed and why it matters, before your day starts — every claim backed by evidence on file.",
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
  { value: "1", label: "competitor website", detail: "turns into a watchlist" },
  { value: "24h", label: "change checks", detail: "daily on Starter & Agency plans" },
  { value: "3", label: "saved evidence", detail: "screenshot, page text, original link" },
  { value: "05:09", label: "morning brief", detail: "what changed and why it matters" },
] as const;

interface LocalPricingPreview {
  available?: boolean;
  prices?: Partial<
    Record<
      PricingPlanSlug,
      Partial<Record<PricingBillingCycle, { display?: string }>>
    >
  >;
  annualValidation?: Partial<Record<PricingPlanSlug, { valid?: boolean; reason?: string }>>;
  usageBundles?: Partial<Record<UsageBundleSlug, { display?: string }>>;
}

function priceLabel(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
  fallback: string,
) {
  return preview?.prices?.[planId]?.[cycle]?.display || fallback;
}

function hasPrice(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
) {
  return Boolean(preview?.prices?.[planId]?.[cycle]?.display);
}

function bundlePriceLabel(
  preview: LocalPricingPreview | null,
  bundleId: UsageBundleSlug,
  fallback: string,
) {
  return preview?.usageBundles?.[bundleId]?.display || fallback;
}

function hasBundlePrice(preview: LocalPricingPreview | null, bundleId: UsageBundleSlug) {
  return Boolean(preview?.usageBundles?.[bundleId]?.display);
}

export function planIntentPath(
  signedIn: boolean,
  plan: PricingPlanSlug,
  cycle: PricingBillingCycle,
) {
  const billingPath = `/app/billing?plan=${plan}&cycle=${cycle}&source=pricing#plans`;
  if (signedIn) return billingPath;
  return `/auth/signup?redirectTo=${encodeURIComponent(billingPath)}`;
}

export default function MarketingRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const routeData = useLoaderData<typeof loader>();
  const commercialLaunch = routeData.commercialLaunch ?? {
    scoutSaleOpen: true,
    starterSaleOpen: true,
    agencySaleOpen: false,
  };
  const primaryCta = rootData.session ? "/app" : "/auth/signup";
  const primaryLabel = rootData.session ? "Open account" : "Start now";
  const [localPricing, setLocalPricing] = useState<LocalPricingPreview | null>(
    routeData.pricingPreview?.available ? routeData.pricingPreview : null,
  );
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>("monthly");

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
    return () => {
      observer.disconnect();
      root.classList.remove("ld-motion");
    };
  }, []);

  useEffect(() => {
    if (localPricing?.available) return undefined;

    let active = true;

    fetch("/api/pricing-preview")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        const preview = value as LocalPricingPreview | null;
        if (active && preview?.available) setLocalPricing(preview);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [localPricing?.available]);

  const tickerRun = (
    <span className="ld-ticker-run">
      <em>Sample watch</em>
      {tickerEvents.map(([time, event, evidence]) => (
        <span className="ld-ticker-item" key={time}>
          <b>{time}</b> {event} <small>[{evidence}]</small>
        </span>
      ))}
    </span>
  );

  return (
    <main className="f9-home">
      <div className="ld-ticker" aria-hidden="true">
        <div className="ld-ticker-belt">
          {tickerRun}
          {tickerRun}
        </div>
      </div>
      <p className="ld-sr-only">
        A sample capture feed: timestamped competitor changes with saved evidence, ending in the
        05:09 morning brief.
      </p>

      <header className="ld-nav">
        <Link className="ld-brand" to="/" aria-label="Five to Nine home">
          <BrandWordmark />
        </Link>

        <nav className="ld-nav-links" aria-label="Primary">
          <Link to={publicSearchTrialPath}>Live search</Link>
          <a href="#demo">Proof loop</a>
          <a href="#pricing">Pricing</a>
        </nav>

        <nav className="ld-nav-actions" aria-label="Account">
          <Link className="f9-link-arrow" to="/auth/login">
            Sign in
          </Link>
          <Link className="ld-nav-pill" to={primaryCta}>
            {primaryLabel}
          </Link>
        </nav>
      </header>

      <section className="ld-hero">
        <Link className="f9-announcement" to={publicSearchTrialPath}>
          <strong>Live search</strong>
          <span>Preview live search before creating an account</span>
        </Link>

        <p className="ld-case">
          <span className="ld-rec">Recording</span>
          <span>Sample case file № 59 — birchandstone.example — last night</span>
        </p>

        <div className="ld-hero-grid">
          <div className="ld-hero-copy">
            <h1 className="ld-wall">
              <span className="ld-row">They cut</span>
              <span className="ld-row">
                the price <s className="ld-del">₹2,400</s>
              </span>
              <span className="ld-row ld-row-indent">
                <ins className="ld-ins">
                  ₹1,999<i className="ld-flag">03:47 AM</i>
                </ins>{" "}
                last
              </span>
              <span className="ld-row">night.</span>
            </h1>

            <p className="ld-deck-copy">
              Your sales team would&rsquo;ve walked in blind. Five to Nine catches the change,
              saves the screenshots, and files the brief — <b>before your alarm goes off.</b>
            </p>
          </div>

          <div className="ld-hero-side">
            <div className="ld-stack" aria-hidden="true">
              <svg className="ld-thread" viewBox="0 0 420 560" aria-hidden="true">
                <path
                  d="M190 80 C 300 120, 310 190, 260 250 M 240 340 C 160 390, 150 430, 180 470"
                  stroke="#E0442C"
                  strokeWidth="1.5"
                  fill="none"
                  strokeDasharray="5 4"
                />
              </svg>
              <div className="ld-shot ld-shot-before">
                <span className="ld-stamp ld-stamp-red">Before — 21:00</span>
                <div className="ld-shot-bar">
                  <i />
                  <i />
                  <i />
                  <span>birchandstone.example/pricing</span>
                </div>
                <div className="ld-shot-body">
                  <div className="ld-sk ld-sk-h" />
                  <div className="ld-sk" />
                  <div className="ld-sk ld-sk-s" />
                  <p className="ld-shot-price ld-price-old">₹2,400/mo</p>
                  <div className="ld-sk ld-sk-s" />
                </div>
              </div>
              <div className="ld-shot ld-shot-after">
                <span className="ld-stamp ld-stamp-green">After — 03:47 · screenshot saved</span>
                <div className="ld-shot-bar">
                  <i />
                  <i />
                  <i />
                  <span>birchandstone.example/pricing</span>
                </div>
                <div className="ld-shot-body">
                  <div className="ld-sk ld-sk-h" />
                  <div className="ld-sk" />
                  <div className="ld-sk ld-sk-s" />
                  <p className="ld-shot-price">
                    <em>₹1,999/mo</em>
                  </p>
                  <div className="ld-sk ld-sk-s" />
                </div>
              </div>
              <div className="ld-shot ld-shot-form">
                <span className="ld-stamp ld-stamp-green">04:58 · new</span>
                <div className="ld-shot-bar">
                  <i />
                  <i />
                  <i />
                  <span>campaign landing page</span>
                </div>
                <div className="ld-shot-body">
                  <div className="ld-sk" />
                  <div className="ld-sk ld-sk-s" />
                  <p className="ld-form-row">+ lead form appeared here</p>
                </div>
              </div>
              <span className="ld-diff-clip">Diff: −₹401</span>
            </div>

            <aside className="ld-brief-strip" aria-label="Sample brief">
              <b>Sample brief — 3 changes to review</b>
              <ul>
                <li>Visible offer text changed</li>
                <li>CTA changed on the destination page</li>
                <li>A lead form appeared</li>
              </ul>
              <small>Evidence on file. No screenshots, no claim.</small>
            </aside>
          </div>
        </div>

        <Form className="ld-command" method="get" action="/search" aria-label="Free live search">
          <input
            aria-label="Competitor website"
            name="website"
            placeholder="paste-their-website.com"
            type="text"
            inputMode="url"
            autoComplete="off"
          />
          <button type="submit">
            Catch them in the act <span aria-hidden="true">→</span>
          </button>
        </Form>

        <div className="f9-hero-proof-actions" aria-label="Sample proof before signup">
          <Link to={publicSearchTrialPath}>Try live search</Link>
          <a href="#demo">Review sample proof loop</a>
          <a href="/api/demo-proof?format=markdown">Open markdown proof</a>
        </div>

        <p className="ld-honest" role="note">
          <strong>Honest by design.</strong> The case above is a sample. Live results are always
          labeled fresh, recent, or sample — and Meta ads tracking stays marked beta until it
          proves itself on your competitors. Live search is free, no account. Why
          &ldquo;0509&rdquo;? Five to Nine — we work while you sleep.
        </p>
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

      <section className="ld-proof" id="demo">
        <div className="ld-section-head">
          <span className="ld-kicker">Sample proof loop</span>
          <h2>See the proof shape before creating an account.</h2>
          <p>
            This is sample data, not the live search result. It shows the buyer moment Five to
            Nine is built around: one competitor, evidence trail, insight summary, digest preview,
            and export.
          </p>
          <div className="ld-proof-actions">
            <a href="/api/demo-proof">View JSON</a>
            <a href="/api/demo-proof?format=markdown">Markdown proof</a>
          </div>
        </div>

        <div className="ld-caseboard ld-reveal" aria-label="Sample Five to Nine proof trail">
          <article className="ld-case-lead">
            <span className="ld-kicker">{demoProof.competitor.market}</span>
            <h3>{demoProof.competitor.name}</h3>
            <p>{demoProof.summary}</p>
          </article>

          <article className="ld-case-card">
            <span className="ld-kicker">Decision summary</span>
            <h4>{demoProof.digestPreview.subject}</h4>
            <p>{demoProof.digestPreview.whyItMatters}</p>
            <dl>
              <div>
                <dt>What changed</dt>
                <dd>{demoProof.digestPreview.whatChanged}</dd>
              </div>
              <div>
                <dt>Why it matters</dt>
                <dd>{demoProof.digestPreview.whyItMatters}</dd>
              </div>
              <div>
                <dt>Urgency</dt>
                <dd>{demoProof.digestPreview.priority}</dd>
              </div>
              <div>
                <dt>Proof status</dt>
                <dd>{demoProof.digestPreview.proofStatus}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{demoProof.digestPreview.source}</dd>
              </div>
              <div>
                <dt>Freshness</dt>
                <dd>{demoProof.digestPreview.freshness}</dd>
              </div>
              <div>
                <dt>Next action</dt>
                <dd>{demoProof.digestPreview.recommendedMove}</dd>
              </div>
            </dl>
          </article>

          <article className="ld-case-card">
            <span className="ld-kicker">Proof trail</span>
            <ul className="ld-trail">
              {demoProof.proofTrail.map((item) => (
                <li key={item.signal}>
                  <strong>{item.signal}</strong>
                  <p>{item.evidence}</p>
                  <em>{item.source}</em>
                </li>
              ))}
            </ul>
          </article>

          <article className="ld-case-card">
            <span className="ld-kicker">{demoProof.reportPreview.title}</span>
            <h4>Client-ready view</h4>
            <ul className="ld-trail">
              {demoProof.reportPreview.rows.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          </article>

          <div className="ld-intel" aria-label="Sample insight depth">
            <article>
              <span className="ld-kicker">Top hooks</span>
              <ul>
                {demoProof.insightPreview.topHooks.map((hook) => (
                  <li key={hook}>{hook}</li>
                ))}
              </ul>
            </article>
            <article>
              <span className="ld-kicker">Media mix</span>
              <ul>
                {demoProof.insightPreview.mediaMix.map((item) => (
                  <li key={item.channel}>
                    <strong>{item.channel}</strong>
                    <em>{item.share}</em>
                  </li>
                ))}
              </ul>
            </article>
            <article>
              <span className="ld-kicker">Timeline</span>
              <ul>
                {demoProof.insightPreview.creativeTimeline.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article>
              <span className="ld-kicker">Brief export</span>
              <p className="ld-export">{demoProof.exports.digestMarkdown}</p>
            </article>
          </div>
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
        <div className="ld-quiet-grid ld-reveal" aria-label="Zero-noise proof points">
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

      <section className="f9-growth-pricing" id="pricing">
        <div className="ld-section-head">
          <span className="ld-kicker">Plans</span>
          <h2>Choose the watch depth your team needs.</h2>
          <div className="ld-plan-summary" aria-label="Pricing summary">
            <span>Recommended launch plan</span>
            <strong>Start with Starter</strong>
            <p>Daily and weekly digests, 10 watchlists, and enough checks for a real sales team.</p>
          </div>
          <p className="ld-pricing-note">
            Review live search and the sample proof loop first. Paid plans add account-gated
            competitor research, watchlists, page checks, saved collections, and clear caps. Save
            winning ads to collections — and see how long each ad has been running when the Ad Library
            shares dates.
          </p>
          <div className="f9-cycle-toggle" role="group" aria-label="Billing cycle">
            <button
              aria-pressed={billingCycle === "monthly"}
              className={billingCycle === "monthly" ? "is-active" : ""}
              onClick={() => setBillingCycle("monthly")}
              type="button"
            >
              Monthly
            </button>
            <button
              aria-pressed={billingCycle === "yearly"}
              className={billingCycle === "yearly" ? "is-active" : ""}
              onClick={() => setBillingCycle("yearly")}
              type="button"
            >
              Annual
            </button>
          </div>
        </div>

        <div className="f9-commerce-grid ld-reveal">
          {rootData.pricingPlans.map((plan) => {
            const yearlyReady = hasPrice(localPricing, plan.slug, "yearly");
            const selectedReady = hasPrice(localPricing, plan.slug, billingCycle);
            const annualIsValid = dodoAnnualSavingsIsValid(
              localPricing?.annualValidation?.[plan.slug],
            );
            const selectedAnnualBlocked = billingCycle === "yearly" && !annualIsValid;
            const planSaleOpen =
              plan.slug === "scout"
                ? commercialLaunch.scoutSaleOpen
                : plan.slug === "starter"
                  ? commercialLaunch.starterSaleOpen
                  : commercialLaunch.agencySaleOpen;

            return (
              <article
                className={`f9-commerce-card${plan.slug === "starter" ? " is-recommended" : ""}`}
                key={plan.name}
              >
                <span>{plan.name}</span>
                {plan.slug === "starter" ? <em className="f9-plan-badge">Recommended</em> : null}
                {plan.slug === "agency" && !planSaleOpen ? (
                  <em className="f9-plan-badge">Held for capacity proof</em>
                ) : null}
                <h3>{priceLabel(localPricing, plan.slug, billingCycle, billingCycle === "yearly" ? plan.yearlyLabel : plan.monthlyLabel)}</h3>
                <small>
                  {billingCycle === "yearly"
                    ? annualIsValid
                      ? "Annual billing · 4 months free"
                      : "Annual checkout unavailable until pricing validates"
                    : `${priceLabel(localPricing, plan.slug, "yearly", plan.yearlyLabel)} annual`}
                </small>
                <p>{plan.detail}</p>
                <ul className="f9-plan-feature-list">
                  {plan.features?.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {rootData.session ? (
                  planSaleOpen && selectedReady && !selectedAnnualBlocked ? (
                    <div className="f9-plan-actions">
                      <Link to={planIntentPath(true, plan.slug, billingCycle)}>
                        Choose {billingCycle === "yearly" ? "annual" : "monthly"}
                      </Link>
                    </div>
                  ) : plan.slug === "agency" && !planSaleOpen ? (
                    <p className="f9-price-sync">
                      Agency checkout is temporarily unavailable. Email{" "}
                      <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we will help.
                    </p>
                  ) : selectedAnnualBlocked && yearlyReady ? (
                    <span className="f9-price-sync">Annual pricing needs validation</span>
                  ) : (
                    <span className="f9-price-sync">Prices loading</span>
                  )
                ) : (
                  <Link to={planSaleOpen && selectedReady && !selectedAnnualBlocked
                    ? planIntentPath(false, plan.slug, billingCycle)
                    : primaryCta}
                  >
                    {planSaleOpen && selectedReady && !selectedAnnualBlocked
                      ? `Choose ${billingCycle === "yearly" ? "annual" : "monthly"}`
                      : primaryLabel}
                  </Link>
                )}
              </article>
            );
          })}
        </div>

        <p className="ld-pricing-note">
          {EVIDENCE_USAGE_CUSTOMER_COPY}
        </p>

        <p className="ld-pricing-note">
          Coming from MagicBrief or another tool that&rsquo;s winding down? See the{" "}
          <Link to="/compare/magicbrief">migration guide</Link>. Your collections and
          watchlists set up in an afternoon — email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>{" "}
          and we&rsquo;ll help you move.
        </p>

        <div className="ld-bundles" aria-label="Extra check packs">
          <div className="ld-bundles-head">
            <span className="ld-kicker">Extra check capacity</span>
            <p>
              Add page checks for busy weeks or big campaigns without changing the team&rsquo;s
              plan.
            </p>
          </div>
          <div className="ld-bundle-grid ld-reveal">
            {(rootData.usageBundles ?? []).map((bundle) => (
              <article className="ld-bundle-card" key={bundle.slug}>
                <span className="ld-kicker">{bundle.creditLabel}</span>
                <h3>{bundle.name}</h3>
                <strong>{bundlePriceLabel(localPricing, bundle.slug, bundle.priceLabel)}</strong>
                <p>{bundle.detail}</p>
                {rootData.session && hasBundlePrice(localPricing, bundle.slug) ? (
                  <Link to="/app/billing?source=top-up#top-ups">Manage packs</Link>
                ) : null}
              </article>
            ))}
          </div>
        </div>

        <div className="ld-pricing-faq ld-reveal" aria-label="Pricing FAQ">
          <span className="ld-kicker">FAQ</span>
          <h3>Common billing questions</h3>
          <dl className="proof-trail-list">
            <div>
              <dt>What is an evidence check?</dt>
              <dd>
                Scheduled monitoring is included. A check is consumed when we capture a new
                landing-page proof for a material change — not for routine scans that find nothing
                new.
              </dd>
            </div>
            <div>
              <dt>Do unused checks roll over?</dt>
              <dd>
                Included monthly checks reset on your subscription anniversary and do not roll over.
                Top-up packs never expire.
              </dd>
            </div>
            <div>
              <dt>What changes on Agency?</dt>
              <dd>
                Agency includes 75 watchlists with daily scans, priority monitoring capacity,
                client-ready reports, shared report branding, developer access, and three team
                seats. We keep monitoring coverage visible as account volume grows.
              </dd>
            </div>
            <div>
              <dt>Where do prices come from?</dt>
              <dd>
                Display prices load from Dodo Payments in your local currency at preview time. We
                never hardcode checkout amounts in the app.
              </dd>
            </div>
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
            <input aria-label="Work email" name="email" placeholder="Work email" type="email" />
          )}
          <SubmitButton getAction={primaryCta} pendingLabel="Redirecting…">{primaryLabel}</SubmitButton>
        </Form>
        <p>Live search is free — no account. Five to Nine — we work while you sleep.</p>
      </section>

      <footer className="ld-footer">
        <Link className="ld-footer-brand" to="/" aria-label="Five to Nine home">
          <BrandWordmark meta="Market intelligence" />
        </Link>
        <p>Five to Nine helps teams see competitor offer and landing-page changes before the next sales call.</p>
        <nav aria-label="Footer">
          <Link to="/help">Help</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/api/docs">API docs</Link>
          <Link to="/status">Status</Link>
          <Link to="/changelog">Changelog</Link>
          <Link to="/trust">Trust</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
        </nav>
      </footer>
    </main>
  );
}
