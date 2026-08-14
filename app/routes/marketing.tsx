import { Form, Link, useLoaderData, useRouteLoaderData } from "react-router";
import { useEffect, useState, type ReactNode } from "react";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { SubmitButton } from "~/components/submit-button";
import { demoProof } from "~/lib/demo-proof";
import {
  DODO_ANNUAL_SAVINGS_LABEL,
  dodoAnnualSavingsIsValid,
  dodoAnnualUnavailableCopy,
} from "~/lib/dodo-pricing-display";
import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";
import { EVIDENCE_USAGE_CUSTOMER_COPY } from "~/lib/pricing";
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
import type { RootLoaderData } from "~/root";

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

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine | Know when competitors change the offer",
    description: marketingDescription,
    pathname: "/",
  });

const noPricingPreview = { available: false } as const;

export async function loader({ context }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
  const env = getEnv(context);

  return {
    // Keep the document request provider-independent. The client hydrates
    // buyer-country pricing from /api/pricing-preview after the page is
    // visible, so an unavailable provider never blocks the homepage HTML.
    pricingPreview: noPricingPreview,
    commercialLaunch: publicCommercialLaunchSummary(env),
  };
}

const tickerEvents = [
  ["02:14", "New Meta ad set — third repeat of the routine-first hook", "ad library"],
  ["03:47", "Pricing page — plan renamed, anchor price added", "screenshot saved"],
  ["04:58", "Lead form appeared on the campaign landing page", "page text + link"],
  ["05:09", "Morning brief delivered — 3 changes, 9 pieces of evidence", "sample brief"],
] as const;

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
// Keep in sync with the "Common billing questions" markup below.
export function billingFaqJsonLdEntries(agencySaleOpen: boolean): FaqJsonLdEntry[] {
  return [
    {
      question: "What uses checks?",
      answer:
        "Scheduled scans are included with your plan. A check is used when Five to Nine saves a proof-backed capture with screenshots, page text, and the original link.",
    },
    {
      question: "Do unused checks roll over?",
      answer:
        "Included checks reset every month and do not roll over. Purchased checks never expire.",
    },
    {
      question: "What changes on Agency?",
      answer:
        "Agency includes 75 watchlists, 250 Collections, 2,500 checks/month, team seats, API/MCP access, client reports, and shared report branding.",
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

type LocalDisplayPrice = {
  amount?: number | null;
  currency?: string | null;
  display?: string | null;
  validationAmount?: number | null;
};

type LocalAnnualValidation = {
  annualAmount?: number | null;
  billingCountry?: string | null;
  currency?: string | null;
  expectedAnnualAmount?: number | null;
  monthlyAmount?: number | null;
  planId?: PricingPlanSlug | null;
  reason?: string | null;
  valid?: boolean | null;
};

export interface LocalPricingPreview {
  available?: boolean;
  prices?: Partial<
    Record<
      PricingPlanSlug,
      Partial<Record<PricingBillingCycle, LocalDisplayPrice>>
    >
  >;
  annualValidation?: Partial<Record<PricingPlanSlug, LocalAnnualValidation>>;
  usageBundles?: Partial<Record<UsageBundleSlug, LocalDisplayPrice>>;
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

function formatMinorCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined,
  options: { roundWhole?: boolean } = {},
) {
  if (!Number.isFinite(amount) || !currency) return "";
  try {
    const decimals =
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    const majorAmount = Number(amount) / 10 ** decimals;
    const displayAmount = options.roundWhole === false ? majorAmount : Math.ceil(majorAmount);
    const fractionDigits = options.roundWhole === false && Math.abs(displayAmount) < 10 ? 2 : 0;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: 0,
    }).format(displayAmount);
  } catch {
    return `${currency} ${Math.ceil(Number(amount) / 100)}`;
  }
}

export function valueMathLabel(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
  annualIsValid: boolean,
) {
  const monthlyPrice = preview?.prices?.[planId]?.monthly;
  if (cycle === "yearly" && annualIsValid) {
    const yearlyPrice = preview?.prices?.[planId]?.yearly;
    const monthlyAmount = monthlyPrice?.amount;
    const annualAmount = yearlyPrice?.amount;
    const monthlyCurrency = monthlyPrice?.currency;
    const annualCurrency = yearlyPrice?.currency;
    const savingsAmount =
      Number.isFinite(monthlyAmount) &&
      Number.isFinite(annualAmount) &&
      monthlyCurrency &&
      annualCurrency &&
      monthlyCurrency === annualCurrency
        ? Number(monthlyAmount) * 12 - Number(annualAmount)
        : null;
    const savings = savingsAmount && savingsAmount > 0
      ? formatMinorCurrency(savingsAmount, monthlyCurrency)
      : "";
    return savings ? `Save ${savings} vs monthly` : DODO_ANNUAL_SAVINGS_LABEL;
  }

  const perDay = formatMinorCurrency(
    Number.isFinite(monthlyPrice?.amount) ? Number(monthlyPrice?.amount) / 30 : null,
    monthlyPrice?.currency,
  );
  return perDay ? `About ${perDay}/day` : "Simple monthly start";
}

function planValueSummary(planId: PricingPlanSlug) {
  if (planId === "scout") return "3 competitors checked every 6 hours";
  if (planId === "starter") return "10 competitors checked every 3 hours";
  if (planId === "agency")
    return "75 competitors — top 25 checked every 3 hours, the rest every 6 hours";
  return "Scheduled competitor monitoring";
}

function bundleValueLabel(
  preview: LocalPricingPreview | null,
  bundleId: UsageBundleSlug,
  creditQuantity: number | null | undefined,
) {
  const price = preview?.usageBundles?.[bundleId];
  if (!Number.isFinite(price?.amount) || !Number.isFinite(creditQuantity) || Number(creditQuantity) <= 0) {
    return "Purchased checks never expire";
  }
  const unit = formatMinorCurrency(
    Number(price?.amount) / Number(creditQuantity),
    price?.currency,
    { roundWhole: false },
  );
  return unit ? `${unit} per check` : "Purchased checks never expire";
}

function hasBundlePrice(preview: LocalPricingPreview | null, bundleId: UsageBundleSlug) {
  return Boolean(preview?.usageBundles?.[bundleId]?.display);
}

// Sample-proof fields must never render blank. An empty fixture value
// degrades to the explicit unavailable state instead of an empty label.
export function sampleProofValue(value: string): string {
  return value.trim() || "Not available in this sample";
}

// The sample digest export is stored as markdown for the raw-export API
// contract. On the homepage, render the small supported subset — bold
// emphasis and line breaks — instead of leaking raw markdown syntax into
// the visible "Brief export" preview.
export function renderDigestMarkdownPreview(markdown: string): ReactNode {
  const lines = markdown.split("\n");
  return lines.map((line, index) => (
    <span key={index}>
      {renderDigestMarkdownLine(line)}
      {index < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

function renderDigestMarkdownLine(line: string): ReactNode {
  const emphasis = line.match(/^\*(.+)\*$/);
  return emphasis ? <strong>{emphasis[1]}</strong> : line;
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
  const primaryLabel = rootData.session ? "Open app" : "Create account";
  const [localPricing, setLocalPricing] = useState<LocalPricingPreview | null>(
    routeData.pricingPreview?.available ? routeData.pricingPreview : null,
  );
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>("monthly");
  const isPlanSaleOpen = (plan: PricingPlanSlug) =>
    plan === "scout"
      ? commercialLaunch.scoutSaleOpen
      : plan === "starter"
        ? commercialLaunch.starterSaleOpen
        : commercialLaunch.agencySaleOpen;
  const saleOpenPricingPlans = rootData.pricingPlans.filter((plan) => isPlanSaleOpen(plan.slug));
  const annualCycleAvailable =
    saleOpenPricingPlans.length > 0 &&
    saleOpenPricingPlans.some((plan) =>
      dodoAnnualSavingsIsValid(localPricing?.annualValidation?.[plan.slug]),
    );
  const annualSavingsValidated =
    saleOpenPricingPlans.length > 0 &&
    saleOpenPricingPlans.every((plan) =>
      dodoAnnualSavingsIsValid(localPricing?.annualValidation?.[plan.slug]),
    );

  useEffect(() => {
    if (billingCycle === "yearly" && !annualCycleAvailable) {
      setBillingCycle("monthly");
    }
  }, [annualCycleAvailable, billingCycle]);

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

  useEffect(() => {
    if (localPricing?.available) return undefined;

    let active = true;
    let started = false;
    let observer: IntersectionObserver | undefined;
    let fallbackTimer = 0;

    const startPricingPreview = () => {
      if (!active || started) return;
      started = true;
      window.clearTimeout(fallbackTimer);
      observer?.disconnect();
      // The pricing section sits far below the fold, and the preview can take
      // seconds (Dodo checkout-preview latency). Fetching it eagerly on mount
      // kept the page's network busy after render (dogfood c99ff5d9b87b:
      // rendered audit reached network idle in 5136ms). Fetch only when the
      // visitor is close to the section, so the document load settles fast
      // while prices still arrive before the section becomes visible.
      fetch("/api/pricing-preview")
        .then((response) => (response.ok ? response.json() : null))
        .then((value: unknown) => {
          const preview = value as LocalPricingPreview | null;
          if (active && preview?.available) setLocalPricing(preview);
        })
        .catch(() => {
          // Keep honest checkout-localized fallbacks on fetch failure.
          if (active) setLocalPricing(null);
        });
    };

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) startPricingPreview();
      },
      { rootMargin: "0px 0px 100% 0px", threshold: 0.01 },
    );
    const pricingSection = document.getElementById("pricing");
    if (pricingSection) observer.observe(pricingSection);

    // Safety net for viewers who never scroll (print, landmark-jumping screen
    // readers, find-in-page jumps): prices still arrive eventually. Fires long
    // after the document has settled, so it never delays the initial load.
    fallbackTimer = window.setTimeout(startPricingPreview, 10_000);

    return () => {
      active = false;
      window.clearTimeout(fallbackTimer);
      observer?.disconnect();
    };
  }, [localPricing?.available]);

  const tickerRun = (
    <span className="ld-ticker-run">
      <em>Sample brief</em>
      {tickerEvents.map(([time, event, evidence]) => (
        <span className="ld-ticker-item" key={time}>
          <b>{time}</b> {event} <small>[{evidence}]</small>
        </span>
      ))}
    </span>
  );

  const structuredFaq = faqPageJsonLd([
    ...productFaqEntries,
    ...billingFaqJsonLdEntries(commercialLaunch.agencySaleOpen),
  ]);

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
        A sample competitor feed: timestamped changes with saved evidence, ending in the
        05:09 morning brief.
      </p>

      <MarketingNav />

      <section className="ld-hero">
        <Link className="f9-announcement" to={publicSearchTrialPath}>
          <strong>Free search preview</strong>
          <span>Paste a competitor site — no account needed.</span>
        </Link>

        <p className="ld-case">
          <span className="ld-rec">Sample proof-backed brief</span>
          <span>A rival page changed while your growth team was offline</span>
        </p>

        <div className="ld-hero-grid">
          <div className="ld-hero-copy">
            <h1 className="ld-wall">
              <span className="ld-row">They cut</span>
              <span className="ld-row">
                the price <s className="ld-del">$159</s>
              </span>
              <span className="ld-row ld-row-indent">
                <ins className="ld-ins">
                  $129<i className="ld-flag">03:47 AM</i>
                </ins>{" "}
                last
              </span>
              <span className="ld-row">night.</span>
            </h1>

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

            <div className="f9-hero-proof-actions" aria-label="Sample brief before signup">
              <Link to={publicSearchTrialPath}>Try with Nykaa</Link>
              <a href="#demo">Review sample brief</a>
            </div>

            <p className="ld-honest" role="note">
              <strong>No account needed.</strong> Preview one competitor now. We label source,
              freshness, coverage, cached results, and sample evidence separately.
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
                  <p className="ld-shot-price ld-price-old">Offer page</p>
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
                    <em>Bundle angle</em>
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
              <span className="ld-diff-clip">Proof saved</span>
            </div>

            <aside className="ld-brief-strip" aria-label="Sample brief">
              <b>Morning brief — 3 moves to beat</b>
              <ul>
                <li>Price drop spotted before breakfast</li>
                <li>New CTA pushing buyers to book</li>
                <li>Lead form added overnight</li>
              </ul>
              <small>Sample evidence — no live captures attached. Next move ready by 05:09.</small>
            </aside>
          </div>
        </div>

      </section>

      <section className="ld-proof" id="demo">
        <div className="ld-section-head">
          <span className="ld-kicker">Sample brief</span>
          <h2>Sample morning brief</h2>
          <p>
            Preview the morning brief before creating an account. See how Five to Nine turns one competitor move into a clear summary, proof status,
            source, and next action before creating an account.
          </p>
          <div className="ld-proof-actions">
            <Link to={publicSearchTrialPath}>Try the search preview</Link>
            <a href="#pricing">See plans</a>
          </div>
        </div>

        <div className="ld-caseboard ld-reveal" aria-label="Sample Five to Nine evidence trail">
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
                <dd>{sampleProofValue(demoProof.digestPreview.whatChanged)}</dd>
              </div>
              <div>
                <dt>Why it matters</dt>
                <dd>{sampleProofValue(demoProof.digestPreview.whyItMatters)}</dd>
              </div>
              <div>
                <dt>Urgency</dt>
                <dd>{sampleProofValue(demoProof.digestPreview.priority)}</dd>
              </div>
              <div>
                <dt>Proof status</dt>
                <dd>{sampleProofValue(demoProof.digestPreview.proofStatus)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{sampleProofValue(demoProof.digestPreview.source)}</dd>
              </div>
              <div>
                <dt>Freshness</dt>
                <dd>{sampleProofValue(demoProof.digestPreview.freshness)}</dd>
              </div>
              <div>
                <dt>Next action</dt>
                <dd>{sampleProofValue(demoProof.digestPreview.recommendedMove)}</dd>
              </div>
            </dl>
          </article>

          <article className="ld-case-card">
            <span className="ld-kicker">Source trail</span>
            <ul className="ld-trail">
              {demoProof.proofTrail.map((item) => (
                <li key={item.signal}>
                  <strong>{sampleProofValue(item.signal)}</strong>
                  <p>{sampleProofValue(item.evidence)}</p>
                  <em>{sampleProofValue(item.source)}</em>
                </li>
              ))}
            </ul>
            <p className="ld-trail-note" role="note">
              This sample trail is illustrative — no live captures are attached to this preview.
              Saved watches attach real screenshots, page text, and original links.
            </p>
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
              <p className="ld-export">{renderDigestMarkdownPreview(demoProof.exports.digestMarkdown)}</p>
            </article>
          </div>
        </div>
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

      <section className="f9-growth-pricing" id="pricing">
        <div className="ld-section-head">
          <span className="ld-kicker">Plans</span>
          <h2>Choose the monitoring rhythm your team needs.</h2>
          <div className="ld-plan-summary" aria-label="Pricing summary">
            <span>Recommended launch plan</span>
            <strong>Start with Starter</strong>
            <p>3-hour competitor monitoring for 10 competitors, plus daily and weekly briefs.</p>
          </div>
          <p className="ld-pricing-note">
            Free: watch 1 competitor with a weekly email brief. Paid plans add 3–6 hour checks,
            evidence, more competitors, Collections, daily briefs, and clear check caps. Save
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
              aria-disabled={!annualCycleAvailable}
              className={billingCycle === "yearly" ? "is-active" : ""}
              disabled={!annualCycleAvailable}
              onClick={() => {
                if (annualCycleAvailable) setBillingCycle("yearly");
              }}
              type="button"
            >
              <span>Annual</span>
              {annualSavingsValidated ? (
                <span className="f9-toggle-savings">{DODO_ANNUAL_SAVINGS_LABEL}</span>
              ) : null}
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
            const planSaleOpen = isPlanSaleOpen(plan.slug);
            const selectedAnnualBlocked =
              billingCycle === "yearly" && planSaleOpen && yearlyReady && !annualIsValid;
            const valueLabel = valueMathLabel(
              localPricing,
              plan.slug,
              billingCycle,
              annualIsValid,
            );
            const annualStatusCopy = !planSaleOpen
              ? "Checkout temporarily unavailable"
              : annualIsValid
                ? null
                : yearlyReady
                  ? "Annual checkout unavailable. Monthly still works."
                  : "Prices load in your local currency at checkout";

            return (
              <article
                className={`f9-commerce-card${plan.slug === "starter" ? " is-recommended" : ""}`}
                key={plan.name}
              >
                <span>{plan.name}</span>
                {plan.slug === "starter" ? <em className="f9-plan-badge">Recommended</em> : null}
                {plan.slug === "agency" && !planSaleOpen ? (
                  <em className="f9-plan-note">Account review</em>
                ) : null}
                <h3 className={selectedReady ? undefined : "is-loading-price"}>
                  {priceLabel(
                    localPricing,
                    plan.slug,
                    billingCycle,
                    billingCycle === "yearly" ? plan.yearlyLabel : plan.monthlyLabel,
                  )}
                </h3>
                <small>
                  {billingCycle === "yearly"
                    ? annualIsValid && planSaleOpen
                      ? (
                        <span className="f9-annual-status">
                          <span>Annual billing</span>
                          <strong>{DODO_ANNUAL_SAVINGS_LABEL}</strong>
                        </span>
                      )
                      : annualStatusCopy
                      // Monthly is selected: mention the annual cadence only
                      // when annual checkout is actually available for this
                      // plan. Otherwise the note stays on the monthly cadence
                      // and never claims the annual savings offer.
                      : annualIsValid && planSaleOpen && hasPrice(localPricing, plan.slug, "yearly")
                        ? `${priceLabel(localPricing, plan.slug, "yearly", plan.yearlyLabel)} annual`
                        : "Billed monthly"}
                </small>
                <div className="f9-plan-value" aria-label={`${plan.name} value summary`}>
                  <strong>{planValueSummary(plan.slug)}</strong>
                  <span>{valueLabel}</span>
                </div>
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
                      Agency is available by account review. Email{" "}
                      <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we will confirm fit directly.
                    </p>
                  ) : selectedAnnualBlocked && yearlyReady ? (
                    <span className="f9-price-sync">
                      {dodoAnnualUnavailableCopy(localPricing?.annualValidation?.[plan.slug])}
                    </span>
                  ) : (
                    <span className="f9-price-sync">Prices loading</span>
                  )
                ) : (
                  plan.slug === "agency" && !planSaleOpen ? (
                    <p className="f9-price-sync">
                      Agency is available by account review. Email{" "}
                      <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
                    </p>
                  ) : (
                    <Link to={planSaleOpen && selectedReady && !selectedAnnualBlocked
                      ? planIntentPath(false, plan.slug, billingCycle)
                      : primaryCta}
                    >
                      {planSaleOpen && selectedReady && !selectedAnnualBlocked
                        ? `Choose ${billingCycle === "yearly" ? "annual" : "monthly"}`
                        : primaryLabel}
                    </Link>
                  )
                )}
              </article>
            );
          })}
        </div>

        <p className="ld-pricing-note">
          {EVIDENCE_USAGE_CUSTOMER_COPY}
        </p>

        <p className="ld-pricing-note">
          Coming from MagicBrief or another tool that&rsquo;s winding down? Your competitor list
          imports as watchlists — see the{" "}
          <Link to="/compare/magicbrief">migration guide</Link>. Collections, boards, analytics
          history, and past evidence are not migrated by Five to Nine — you recreate them with our
          help. Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll set up your
          watchlists with you, person to person.
        </p>

        <div className="ld-bundles" aria-label="Check packs">
          <div className="ld-bundles-head">
            <span className="ld-kicker">Check packs</span>
            <h3>Extra checks when campaigns move fast.</h3>
            <p>
              Add purchased checks for busy weeks or big campaigns without changing the team&rsquo;s
              plan. Purchased checks never expire.
            </p>
            <p className="ld-check-pack-note">
              Packs: 500 extra checks, 2,000 extra checks, or 7,500 extra checks.
            </p>
          </div>
          <div className="ld-bundle-grid ld-reveal">
            {(rootData.usageBundles ?? []).map((bundle) => (
              <article className="ld-bundle-card" key={bundle.slug}>
                <span className="ld-kicker">{bundle.creditLabel}</span>
                <h3>{bundle.name}</h3>
                <strong>{bundlePriceLabel(localPricing, bundle.slug, bundle.priceLabel)}</strong>
                <span className="ld-bundle-value">
                  {bundleValueLabel(localPricing, bundle.slug, bundle.creditQuantity)}
                </span>
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
              <dt>What uses checks?</dt>
              <dd>
                Scheduled scans are included with your plan. A check is used when Five to Nine saves
                a proof-backed capture with screenshots, page text, and the original link.
              </dd>
            </div>
            <div>
              <dt>Do unused checks roll over?</dt>
              <dd>
                Included checks reset every month and do not roll over. Purchased checks never
                expire.
              </dd>
            </div>
            <div>
              <dt>What changes on Agency?</dt>
              <dd>
                Agency includes 75 watchlists, 250 Collections, 2,500 checks/month, team seats,
                API/MCP access, client reports, and shared report branding.
              </dd>
            </div>
            <div>
              <dt>{commercialLaunch.agencySaleOpen ? "How does Agency checkout work?" : "Why is Agency held?"}</dt>
              <dd>
                {commercialLaunch.agencySaleOpen ? (
                  <>
                    Agency checkout is available when pricing loads in your region. Email{" "}
                    <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you want an account review before
                    buying.
                  </>
                ) : (
                  <>
                    Agency is available by account review. Email{" "}
                    <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we will confirm fit directly.
                  </>
                )}
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
