import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { SubmitButton } from "~/components/submit-button";
import {
  buildSearchParams,
  fingerprintSavedQuery,
  hashString,
  normalizeSavedQuery,
  stableStringify,
} from "~/lib/normalize";

export const meta: MetaFunction = () => [
  { title: "Set up your account | Five to Nine" },
  {
    name: "description",
    content: "Choose a competitor to track so your Five to Nine account starts with a concrete next step.",
  },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit, getUserPlan } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);

  if (session.user.onboardedAt) {
    throw redirect("/app");
  }

  const [plan, watchlistLimit] = await Promise.all([
    getUserPlan(env, session.user.id),
    checkPlanLimit(env, session.user.id, "watchlists"),
  ]);

  return { session, plan, watchlistLimit };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { completeUserOnboarding, createWatchlist } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const competitorInput = String(formData.get("website") ?? formData.get("query") ?? "").trim();
  const competitor = normalizeOnboardingCompetitorInput(competitorInput);
  const query = competitor.query;

  if (intent === "create-watchlist") {
    if (!query) {
      return {
        ok: false,
        message: "Enter a competitor website first.",
      };
    }

    const watchlistLimit = await checkPlanLimit(env, session.user.id, "watchlists");
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

    const normalizedQuery = normalizeSavedQuery("advertiser", {
      query,
    });
    const targetFingerprint = competitor.targetId
      ? hashString(
          stableStringify({
            kind: "competitor_website",
            website: competitor.targetId,
            query: normalizedQuery,
          }),
        )
      : fingerprintSavedQuery(normalizedQuery);
    const watchlist = await createWatchlist(env, session.user.id, {
      name: `${query} watch`,
      targetType: "advertiser",
      targetId: competitor.targetId || query,
      targetFingerprint,
      targetLabel: query,
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
  const competitor = normalizeOnboardingCompetitorInput(trimmedWebsite);
  const watchlistCapacity = data.watchlistLimit.limit - data.watchlistLimit.current;
  const canCreateWatchlist = data.watchlistLimit.allowed && data.watchlistLimit.limit > 0;
  const previewParams = buildSearchParams(
    normalizeSavedQuery("advertiser", {
      query: competitor.query,
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
                <input name="country" type="hidden" value="India" />
                <input name="platform" type="hidden" value="all" />
                <input name="creativeType" type="hidden" value="all" />
                <input name="status" type="hidden" value="all" />
                <input name="query" type="hidden" value={competitor.query} />
                <label className="f9-field">
                  <span>Competitor website</span>
                  <input
                    name="website"
                    onChange={(event) => setWebsite(event.currentTarget.value)}
                    placeholder="https://competitor.com"
                    value={website}
                  />
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
                      Create watchlist for {competitor.query || "this competitor"}
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

function normalizeOnboardingCompetitorInput(value: string) {
  const raw = value.trim();
  if (!raw) {
    return {
      query: "",
      targetId: "",
    };
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) {
      return {
        query: raw,
        targetId: raw,
      };
    }

    url.hash = "";
    url.search = "";
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    const root = host.split(".").find((part) => part && part !== "www") ?? host;
    const query = root
      .replace(/[-_]+/g, " ")
      .replace(/\b(official|store|shop|india|in)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      query: titleCase(query || host),
      targetId: `${url.protocol}//${host}${path}`,
    };
  } catch {
    return {
      query: raw,
      targetId: raw,
    };
  }
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
