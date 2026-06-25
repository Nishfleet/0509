import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { SubmitButton } from "~/components/submit-button";
import {
  hasInvalidCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import {
  normalizeSavedQuery,
} from "~/lib/normalize";
import { defaultCountryForVisitor } from "~/lib/countries";

export const meta: MetaFunction = () => [
  { title: "Set up your account | Five to Nine" },
  {
    name: "description",
    content: "Choose a competitor to track so your Five to Nine account starts with a concrete next step.",
  },
];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Get started" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getWorkspaceBranding } = await import("~/lib/data.server");
  const { checkPlanLimit, getUserPlan } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);

  if (isMember) {
    const { completeUserOnboarding } = await import("~/lib/data.server");
    await completeUserOnboarding(env, session.user.id);
    throw redirect("/app");
  }

  if (session.user.onboardedAt) {
    throw redirect("/app");
  }

  const [plan, watchlistLimit, branding] = await Promise.all([
    getUserPlan(env, workspaceUserId),
    checkPlanLimit(env, workspaceUserId, "watchlists"),
    getWorkspaceBranding(env, workspaceUserId),
  ]);

  return {
    session,
    plan,
    watchlistLimit,
    brandWebsite: branding.brandWebsite,
    visitorCountry: defaultCountryForVisitor(
      (context.cloudflare as { country?: string | null } | undefined)?.country ??
        request.headers.get("cf-ipcountry"),
    ),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { completeUserOnboarding, createWatchlist, upsertWorkspaceBranding } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);

  if (isMember) {
    const { completeUserOnboarding } = await import("~/lib/data.server");
    await completeUserOnboarding(env, session.user.id);
    throw redirect("/app");
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const websiteInput = String(formData.get("website") ?? "").trim();
  const queryInput = String(formData.get("query") ?? "").trim();
  const brandWebsiteInput = String(formData.get("brandWebsite") ?? "").trim();
  const competitorWebsite = normalizeCompetitorWebsiteInput(websiteInput);
  const brandWebsite = normalizeCompetitorWebsiteInput(brandWebsiteInput);
  const query = queryInput || competitorWebsite.searchTerm || "";

  if (brandWebsiteInput && hasInvalidCompetitorWebsite(brandWebsite)) {
    return {
      ok: false,
      message: brandWebsite.error,
    };
  }

  async function saveOptionalBrandWebsite() {
    if (brandWebsiteInput || formData.has("brandWebsite")) {
      await upsertWorkspaceBranding(env, workspaceUserId, {
        brandWebsite: brandWebsite.normalizedUrl,
      });
    }
  }

  if (intent === "create-watchlist") {
    if (hasInvalidCompetitorWebsite(competitorWebsite)) {
      return {
        ok: false,
        message: competitorWebsite.error,
      };
    }

    if (!query) {
      return {
        ok: false,
        message: "Enter a full website address first, like brand.com.",
      };
    }

    const watchlistLimit = await checkPlanLimit(env, workspaceUserId, "watchlists");
    if (!watchlistLimit.allowed) {
      const isZeroLimit = watchlistLimit.limit === 0;

      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message: isZeroLimit
          ? "Competitor monitoring is available on paid plans. Starter is the recommended plan for this competitor."
          : "You have reached your competitor monitoring limit.",
        upgradePath: "/#pricing",
      };
    }

    const visitorCountry = defaultCountryForVisitor(
      (context.cloudflare as { country?: string | null } | undefined)?.country ??
        request.headers.get("cf-ipcountry"),
    );
    const normalizedQuery = normalizeSavedQuery("advertiser", {
      query,
      country: visitorCountry,
    });
    const targetFingerprint = watchlistFingerprint(normalizedQuery, competitorWebsite);
    const targetLabel = competitorWebsite.displayName ?? competitorWebsite.searchTerm ?? query;
    const watchlist = await createWatchlist(env, workspaceUserId, {
      name: `${competitorWebsite.displayName ?? query} watch`,
      targetType: "advertiser",
      targetId: competitorWebsite.normalizedUrl || query,
      targetFingerprint,
      targetLabel,
      targetCountry: normalizedQuery.filters.country,
      trackingRole: "competitor",
    });

    const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
    queueFirstWatchlistScan(env, context.cloudflare?.ctx, watchlist);

    await saveOptionalBrandWebsite();
    await completeUserOnboarding(env, session.user.id);

    throw redirect(watchlist ? `/app/watchlists?watchlist=${watchlist.id}` : "/app/watchlists");
  }

  if (intent === "finish") {
    await saveOptionalBrandWebsite();
    await completeUserOnboarding(env, session.user.id);
    throw redirect("/app");
  }

  return {
    ok: false,
    message: "Unknown onboarding action.",
  };
}

export default function AppOnboardRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [website, setWebsite] = useState("");
  const [brandWebsite, setBrandWebsite] = useState(data.brandWebsite ?? "");
  const trimmedWebsite = website.trim();
  const trimmedBrandWebsite = brandWebsite.trim();
  const competitorWebsite = normalizeCompetitorWebsiteInput(trimmedWebsite);
  const ownBrandWebsite = normalizeCompetitorWebsiteInput(trimmedBrandWebsite);
  const competitorQuery = competitorWebsite.searchTerm ?? "";
  const canCreateWatchlist = data.watchlistLimit.allowed && data.watchlistLimit.limit > 0;

  return (
    <DashboardPage>
      <main className="f9-onboard-page">
      <div className="f9-auth-gradient" aria-hidden="true" />
      <section className="f9-container f9-onboard-layout">
        <article className="f9-onboard-card">
          <DashboardPageHeader
            lead="Start with one competitor site. Five to Nine finds the ads behind it and keeps checking for changes."
            title="Get started"
          />

          {actionData?.message ? (
            <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
              <p>{actionData.message}</p>
              {!actionData.ok && "upgradePath" in actionData && actionData.upgradePath ? (
                <Link className="f9-text-link" to={actionData.upgradePath}>
                  View pricing
                </Link>
              ) : null}
            </div>
          ) : null}

          {canCreateWatchlist ? (
            <Form className="f9-auth-form f9-onboard-single-form" method="post">
              <input name="intent" type="hidden" value="create-watchlist" />
              <label className="f9-field">
                <span>Competitor website</span>
                <input
                  autoComplete="url"
                  inputMode="url"
                  name="website"
                  onChange={(event) => setWebsite(event.currentTarget.value)}
                  placeholder="https://competitor.com"
                  spellCheck={false}
                  value={website}
                />
                {competitorWebsite.error ? <small>{competitorWebsite.error}</small> : null}
              </label>

              <details className="f9-inline-details">
                <summary>Optional: add your brand website</summary>
                <label className="f9-field">
                  <span>My brand website</span>
                  <input
                    autoComplete="url"
                    inputMode="url"
                    name="brandWebsite"
                    onChange={(event) => setBrandWebsite(event.currentTarget.value)}
                    placeholder="https://yourbrand.com"
                    spellCheck={false}
                    value={brandWebsite}
                  />
                  {ownBrandWebsite.error ? <small>{ownBrandWebsite.error}</small> : null}
                </label>
              </details>

              <SubmitButton
                className="f9-primary-button"
                disabled={!trimmedWebsite}
                intent="create-watchlist"
                pendingLabel="Creating…"
              >
                Start tracking {competitorWebsite.displayName ?? (competitorQuery || "this competitor")}
              </SubmitButton>
            </Form>
          ) : (
            <section className="f9-onboard-step">
              <span className="f9-app-kicker">Plan required</span>
              <h2>Choose a plan to start monitoring</h2>
              <p className="f9-muted-copy">
                Starter is the recommended plan for retained competitor tracking and weekly digests.
              </p>
              <div className="f9-action-row">
                <Link className="f9-primary-button" to="/#pricing">
                  View plans
                </Link>
                <span className="f9-muted-copy">Current plan: {data.plan}</span>
              </div>
            </section>
          )}

          <div className="f9-onboard-actions">
            <Form method="post">
              <input name="intent" type="hidden" value="finish" />
              <input name="brandWebsite" type="hidden" value={trimmedBrandWebsite} />
              <SubmitButton className="f9-secondary-button" intent="finish" pendingLabel="Working…">
                Skip for now
              </SubmitButton>
            </Form>
            <Link className="f9-text-link" to="/search">
              Search first instead
            </Link>
          </div>
        </article>
      </section>
      </main>
    </DashboardPage>
  );
}
