import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { SubmitButton } from "~/components/submit-button";
import {
  hasInvalidCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import {
  buildSearchParams,
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

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
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

  const [plan, watchlistLimit] = await Promise.all([
    getUserPlan(env, workspaceUserId),
    checkPlanLimit(env, workspaceUserId, "watchlists"),
  ]);

  return {
    session,
    plan,
    watchlistLimit,
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
  const { completeUserOnboarding, createWatchlist } = await import("~/lib/data.server");
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
  const competitorWebsite = normalizeCompetitorWebsiteInput(websiteInput);
  const query = queryInput || competitorWebsite.searchTerm || "";

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
        message: "Enter a full website address first, like seoitis.com.",
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
    const targetLabel = competitorWebsite.searchTerm || query;
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

    await completeUserOnboarding(env, session.user.id);

    throw redirect(watchlist ? `/app/watchlists?watchlist=${watchlist.id}` : "/app/watchlists");
  }

  if (intent === "finish") {
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
  const trimmedWebsite = website.trim();
  const competitorWebsite = normalizeCompetitorWebsiteInput(trimmedWebsite);
  const competitorQuery = competitorWebsite.searchTerm ?? "";
  const watchlistCapacity = data.watchlistLimit.limit - data.watchlistLimit.current;
  const canCreateWatchlist = data.watchlistLimit.allowed && data.watchlistLimit.limit > 0;
  const previewParams = buildSearchParams(
    normalizeSavedQuery("advertiser", {
      query: competitorQuery,
      country: data.visitorCountry,
    }),
  );
  if (trimmedWebsite) {
    previewParams.set("website", trimmedWebsite);
  }

  return (
    <main className="f9-onboard-page">
      <div className="f9-auth-gradient" aria-hidden="true" />
      <section className="f9-container f9-onboard-layout">
        <article className="f9-onboard-card">
          <span className="f9-app-kicker">First-run setup</span>
          <h1>Add your first competitor website.</h1>
          <p className="f9-muted-copy">
            Start with one competitor site. Five to Nine finds the ads behind it and keeps checking for changes.
          </p>

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

          <div className="f9-onboard-steps">
            <section className="f9-onboard-step">
              <span className="f9-app-kicker">Step 1</span>
              <h2>Paste the site you want to watch</h2>
              <Form action="/search" className="f9-auth-form" method="get">
                <input name="mode" type="hidden" value="advertiser" />
                <input name="country" type="hidden" value={data.visitorCountry} />
                <input name="platform" type="hidden" value="all" />
                <input name="creativeType" type="hidden" value="all" />
                <input name="status" type="hidden" value="all" />
                <input name="query" type="hidden" value={competitorQuery} />
                <label className="f9-field">
                  <span>Website to track</span>
                  <input
                    name="website"
                    onChange={(event) => setWebsite(event.currentTarget.value)}
                    placeholder="https://competitor.com"
                    value={website}
                  />
                  {competitorWebsite.error ? <small>{competitorWebsite.error}</small> : null}
                </label>
                <div className="f9-action-row">
                  <SubmitButton
                    className="f9-secondary-button"
                    disabled={!trimmedWebsite}
                    getAction="/search"
                    pendingLabel="Searching…"
                  >
                    Search competitor ads
                  </SubmitButton>
                  <small className="f9-muted-copy">
                    You can edit the brand name on the search page.
                  </small>
                </div>
              </Form>
            </section>

            <section className="f9-onboard-step">
              <span className="f9-app-kicker">Step 2</span>
              {canCreateWatchlist ? (
                <>
                  <h2>Create your first watchlist</h2>
                  <p className="f9-muted-copy">
                    One click starts tracking this competitor inside your account.
                    You have {watchlistCapacity} watchlist{watchlistCapacity === 1 ? "" : "s"} available.
                  </p>
                  <Form className="f9-auth-form" method="post">
                    <input name="intent" type="hidden" value="create-watchlist" />
                    <input name="website" type="hidden" value={trimmedWebsite} />
                    <SubmitButton
                      className="f9-primary-button"
                      disabled={!trimmedWebsite}
                      intent="create-watchlist"
                      pendingLabel="Creating…"
                    >
                      Create watchlist for {competitorWebsite.displayName ?? (competitorQuery || "this site")}
                    </SubmitButton>
                  </Form>
                </>
              ) : (
                <>
                  <h2>Choose a plan to start monitoring</h2>
                  <p className="f9-muted-copy">
                    Starter is the recommended plan for retained competitor tracking and weekly change briefs.
                  </p>
                  <div className="f9-action-row">
                    <Link className="f9-primary-button" to="/#pricing">
                      View plans
                    </Link>
                    <span className="f9-muted-copy">Current plan: {data.plan}</span>
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="f9-onboard-actions">
            <Form method="post">
              <input name="intent" type="hidden" value="finish" />
              <SubmitButton className="f9-secondary-button" intent="finish" pendingLabel="Working…">
                Skip for now
              </SubmitButton>
            </Form>
            <Link className="f9-text-link" to={previewParams ? `/search?${previewParams}` : "/search"}>
              Go straight to search instead
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
