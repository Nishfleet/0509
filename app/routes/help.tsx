import { useEffect, useState } from "react";
import { Link, useRouteLoaderData } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { CUSTOMER_SUPPORT_PATHS } from "~/lib/agent-action-catalog";
import { appLinkTarget } from "~/lib/app-link";
import { SUPPORTED_COUNTRIES } from "~/lib/countries";
import { DODO_ANNUAL_SAVINGS_LABEL } from "~/lib/dodo-pricing-display";
import { getPlanEntitlements, type PaidPlanFamily, type PlanFamily } from "~/lib/plan-entitlements";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { RootLoaderData } from "~/root";

const description =
  "What Five to Nine tracks, what “verified” means, what each plan costs, and how to get delivery, billing, cancellation, and account help.";

export const links: LinksFunction = () => canonicalLinks("/help");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Help | Five to Nine",
    description,
    pathname: "/help",
  });

const PAID_PLANS = ["scout", "starter", "agency"] as const satisfies readonly PaidPlanFamily[];

/**
 * Localized monthly prices are never hardcoded or server-rendered here. Dodo
 * resolves the amount for the buyer's region, so /help fetches the same public
 * preview the pricing section uses, after mount. Two consequences are
 * deliberate: the HTML stays region-neutral and publicly cacheable, and a
 * failed or unavailable preview leaves the honest fallback sentence in place.
 */
interface PricingPreviewResponse {
  available?: boolean;
  prices?: Partial<
    Record<PaidPlanFamily, Partial<Record<"monthly" | "yearly", { display?: string | null }>>>
  >;
  commercialLaunch?: {
    scoutSaleOpen?: boolean;
    starterSaleOpen?: boolean;
    agencySaleOpen?: boolean;
  };
}

interface LocalizedPlanPricing {
  monthly: Partial<Record<PaidPlanFamily, string>>;
  saleOpen: Partial<Record<PaidPlanFamily, boolean>>;
}

function useLocalizedPlanPricing(): LocalizedPlanPricing {
  const [pricing, setPricing] = useState<LocalizedPlanPricing>({ monthly: {}, saleOpen: {} });

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/pricing-preview", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const data = (await response.json()) as PricingPreviewResponse;
        if (!active || data?.available !== true) return;

        const monthly: Partial<Record<PaidPlanFamily, string>> = {};
        for (const plan of PAID_PLANS) {
          const display = data.prices?.[plan]?.monthly?.display;
          if (typeof display === "string" && display.trim()) {
            monthly[plan] = display.trim();
          }
        }

        setPricing({
          monthly,
          saleOpen: {
            scout: data.commercialLaunch?.scoutSaleOpen === true,
            starter: data.commercialLaunch?.starterSaleOpen === true,
            agency: data.commercialLaunch?.agencySaleOpen === true,
          },
        });
      } catch {
        // Keep the fallback sentence: it already tells the buyer where the
        // real number comes from instead of inventing one.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return pricing;
}

/** Plain-English scheduled-check cadence, read from the entitlement catalog. */
function checkCadenceLabel(plan: PlanFamily) {
  const entitlements = getPlanEntitlements(plan);
  if (entitlements.scheduledScanCadence === "every_3h") {
    return entitlements.priorityScanSlots == null
      ? "checks every 3 hours"
      : `the first ${entitlements.priorityScanSlots} checked every 3 hours and the rest every 6 hours`;
  }
  if (entitlements.scheduledScanCadence === "every_6h") return "checks every 6 hours";
  if (entitlements.scheduledScanCadence === "weekly") return "a weekly check";
  return "no scheduled checks";
}

function planScopeLine(plan: PaidPlanFamily) {
  const entitlements = getPlanEntitlements(plan);
  const briefs =
    entitlements.digestCadence === "daily_and_weekly" ? "daily and weekly briefs" : "a weekly brief";
  return `${entitlements.watchlists} competitors, ${checkCadenceLabel(plan)}, ${briefs}, ${entitlements.includedEvidenceChecksPerMonth.toLocaleString("en-US")} proof captures a month, and ${entitlements.collections} Collections.`;
}

function planPriceLabel(plan: PaidPlanFamily, pricing: LocalizedPlanPricing) {
  const price = pricing.monthly[plan];
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
  if (!price) {
    return `${planName} — price loads in your local currency`;
  }
  return `${planName} — ${price} a month`;
}

export default function HelpRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData | undefined;
  const session = rootData?.session;
  const pricing = useLocalizedPlanPricing();
  const freePlan = getPlanEntitlements("free");

  return (
    <PublicDocShell
      kicker="Help"
      title="Get Five to Nine working for your team."
      intro="Buyer questions first — what gets tracked, what “verified” means, and what each plan costs — then the delivery, billing, cancellation, and account help existing customers need."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({ name: "Help | Five to Nine", description, pathname: "/help" }),
        )}
      />

      <PublicDocBlock id="what-it-does" title="What does Five to Nine actually do?">
        <p>
          It watches a competitor&rsquo;s public website and the ads that competitor runs in the public Meta
          Ad Library, then saves each confirmed change with a screenshot, the page text, and the original
          source link. Those confirmed changes become the email brief you read in the morning. Five to Nine
          reads only public surfaces, never signs in to anything, and never touches a competitor&rsquo;s
          account, so nothing tells them you are watching.
        </p>
        <p>
          You can try the evidence before creating anything: run a public{" "}
          <Link to="/search">search</Link> from any competitor website, or read the{" "}
          <Link to="/#demo">proof brief</Link>. Neither needs an account.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="coverage" title="Which competitors, categories, and countries are tracked?">
        <dl className="proof-trail-list">
          <div>
            <dt>Competitors</dt>
            <dd>
              Any business with a public website — you add a competitor by its website address, so there is
              no eligibility list to be on. How many you can watch at once is the plan limit:{" "}
              {freePlan.watchlists} on Free, {getPlanEntitlements("scout").watchlists} on Scout,{" "}
              {getPlanEntitlements("starter").watchlists} on Starter, and{" "}
              {getPlanEntitlements("agency").watchlists} on Agency.
            </dd>
          </div>
          <div>
            <dt>Categories</dt>
            <dd>
              There is no industry taxonomy and no category gate: tracking follows the website you enter.
              A competitor who runs no Meta ads still gets website and landing-page checks — the ad section
              is simply empty, which is not proof that they have no ads anywhere.
            </dd>
          </div>
          <div>
            <dt>Countries</dt>
            <dd>
              Ad searches run across all countries or can be narrowed to {SUPPORTED_COUNTRIES.length}{" "}
              specific ones, including the United States, the United Kingdom, India, Germany, Brazil, and
              Singapore. Website and landing-page checks are not country-filtered: they read the page the
              way the checking browser sees it, so pages that vary by visitor location can differ from
              what you see.
            </dd>
          </div>
          <div>
            <dt>Ad placements</dt>
            <dd>
              Whatever the Meta Ad Library publishes for the advertiser: Facebook, Instagram, Audience
              Network, and Messenger.
            </dd>
          </div>
          <div>
            <dt>Not tracked</dt>
            <dd>
              Automated X, Reddit, LinkedIn, YouTube, TikTok, Google, or Pinterest ingestion is not live.
              Spend, reach, impressions, and ROAS are never inferred from public evidence.
            </dd>
          </div>
        </dl>
      </PublicDocBlock>

      <PublicDocBlock id="verified" title="What does “verified” mean here?">
        <p>
          Verified is a claim about the evidence trail, never a claim about how good an ad is. Every result
          and every recorded change carries one of these labels.
        </p>
        <dl className="proof-trail-list">
          <div>
            <dt>Verified ad match</dt>
            <dd>
              The ad&rsquo;s landing page — or an audited alias of it — resolves to the competitor domain you
              searched. An ad that merely mentions the brand name in its text does not qualify.
            </dd>
          </div>
          <div>
            <dt>Related or broader</dt>
            <dd>A useful lead that still needs human review before it becomes a competitor claim.</dd>
          </div>
          <div>
            <dt>Verified evidence</dt>
            <dd>A stored screenshot, page record, or source link is attached to the recorded change.</dd>
          </div>
          <div>
            <dt>Check-spotted</dt>
            <dd>The scheduled check saw the change; treat it as a lead until a capture is stored.</dd>
          </div>
          <div>
            <dt>Cached</dt>
            <dd>Previously captured provider evidence. Read its capture time before treating it as current.</dd>
          </div>
          <div>
            <dt>Sample</dt>
            <dd>Static product walkthrough data, always labeled sample-only and never shown as a live result.</dd>
          </div>
        </dl>
        <p>
          No evidence is not proof that a competitor has no active ads: coverage can be partial, delayed,
          cached, or unavailable. <Link to="/docs">Docs</Link> covers how to read a thin result.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="cost" title="What does it cost?">
        <p>
          Free costs nothing and never asks for a card: {freePlan.watchlists} competitor, an instant first
          scan, then {checkCadenceLabel("free")}, a weekly email brief, {freePlan.collections} Collection,
          and {freePlan.includedEvidenceChecksPerMonth} proof capture a month. Paid plans bill monthly, and
          annual billing is offered as {DODO_ANNUAL_SAVINGS_LABEL} when the annual price validates for your
          region.
        </p>
        <dl className="proof-trail-list">
          {PAID_PLANS.map((plan) => (
            <div key={plan}>
              <dt>{planPriceLabel(plan, pricing)}</dt>
              <dd>
                {planScopeLine(plan)}
                {plan === "agency" && pricing.saleOpen.agency === false
                  ? " Agency is sold by account review — email support and we will confirm fit."
                  : ""}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          Prices are charged in your local currency and load live from the payment provider, so the exact
          amount for your region appears on <Link to="/#pricing">Plans</Link> and again at checkout — we
          never hardcode a checkout amount. Included proof captures reset every month and do not roll over;
          purchased proof-capture packs never expire.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="start-here" title="Start here">
        <ol className="f9-numbered-guide">
          <li>Run a public search from the homepage or Search page.</li>
          <li>Create an account and add one competitor website.</li>
          <li>Open the watchlist and refresh tracking to save the first evidence trail.</li>
          <li>Review the digest page after the first monitored change or quiet check.</li>
        </ol>
        <p>
          Free lets you watch one competitor: an activation scan when you add it, then a weekly check with a weekly
          email brief. Paid plans add 3–6 hour checks, daily briefs, evidence, and more competitors, subject to the
          plan and account configuration. Proof captures are saved for each recorded change, with generous monthly
          caps and purchased proof-capture packs that never expire.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="delivery-setup" title="Delivery setup">
        <p>
          Email delivery is in product scope, but this page does not measure live email-provider availability. Paid
          plans add scheduled monitoring and digest features when configured for the account. Open{" "}
          <Link to={appLinkTarget("/app/notifications", session)}>Notifications</Link> to review delivery settings. A manual refresh confirms a
          fresh check only; it does not confirm recurring delivery. If a scheduled digest does not arrive, open a{" "}
          <Link to={appLinkTarget("/app/support?category=delivery", session)}>delivery support case</Link>.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="billing-help" title="Billing help">
        <p>
          Paid access follows the confirmed payment path connected to the account. Card and invoice tasks can use the
          hosted billing portal on <Link to={appLinkTarget("/app/billing", session)}>Plan &amp; billing</Link> when it is available. Plan changes
          and cancellation stay backed by{" "}
          <Link to={appLinkTarget("/app/support?category=billing", session)}>signed-in support cases</Link> until portal subscription updates
          are confirmed.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="cancellation" title="Cancellation and deletion">
        <p>
          Cancellation stops future renewals, and access continues until the end of the period you have paid for.
          Use the hosted billing portal when it is available; otherwise, open a signed-in support case for cancellation
          help.
        </p>
        <p>
          Account deletion is a support request, not an automatic or in-app deletion. Signed-in customers can open a{" "}
          <Link to={appLinkTarget("/app/support?category=security", session)}>deletion support case</Link>; email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you cannot sign in. Nothing is deleted automatically or
          in-app.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="support-paths" title="Paid customer support paths">
        <dl className="proof-trail-list">
          {CUSTOMER_SUPPORT_PATHS.map((path) => (
            <div key={path.label}>
              <dt>{path.label}</dt>
              <dd>{path.detail}</dd>
            </div>
          ))}
        </dl>
      </PublicDocBlock>

      <PublicDocBlock id="contact-support" title="Contact support">
        <p>
          Signed-in customers can open <Link to={appLinkTarget("/app/support", session)}>support cases</Link> for account access,
          billing changes, cancellation help, deletion requests, security reports, or migration
          support. Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you cannot sign in.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
