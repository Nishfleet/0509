import { useState } from "react";
import { Form, Link, redirect, useActionData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { buildSearchParams, fingerprintSavedQuery, normalizeSavedQuery } from "~/lib/normalize";

export const meta: MetaFunction = () => [
  { title: "Set up your workspace | 0509" },
  {
    name: "description",
    content: "Choose a competitor to track so your 0509 workspace starts with a concrete next step.",
  },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);

  if (session.user.onboardedAt) {
    throw redirect("/app");
  }

  return { session };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { PLAN_UPGRADE_URL, checkPlanLimit } = await import("~/lib/plan.server");
  const { completeUserOnboarding, createWatchlist } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const query = String(formData.get("query") ?? "").trim();

  if (intent === "create-watchlist") {
    if (!query) {
      return {
        ok: false,
        message: "Enter a brand or keyword first.",
      };
    }

    const watchlistLimit = await checkPlanLimit(env, session.user.id, "watchlists");
    if (!watchlistLimit.allowed) {
      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        upgradeUrl: PLAN_UPGRADE_URL,
        message: "You have reached the free watchlist limit.",
      };
    }

    const normalizedQuery = normalizeSavedQuery("advertiser", {
      query,
    });
    const watchlist = await createWatchlist(env, session.user.id, {
      name: `${query} watch`,
      targetType: "advertiser",
      targetId: query,
      targetFingerprint: fingerprintSavedQuery(normalizedQuery),
      targetLabel: query,
    });

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
  const actionData = useActionData<typeof action>();
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const previewParams = buildSearchParams(
    normalizeSavedQuery("advertiser", {
      query: trimmedQuery,
    }),
  ).toString();

  return (
    <main className="auth-shell">
      <section className="container section-grid">
        <article className="content-card">
          <p className="eyebrow">First-run setup</p>
          <h1>Start with one brand or keyword you want to watch.</h1>
          <p className="muted-text">
            Search once to see the ad landscape, then create a watchlist so the workspace has
            something useful waiting for you next week.
          </p>

          {actionData?.message ? (
            <div className={`form-message ${actionData.ok ? "form-message-success" : "form-message-error"}`}>
              <p>{actionData.message}</p>
              {actionData.error === "plan_limit_exceeded" ? (
                <Link className="button button-secondary" to={actionData.upgradeUrl}>
                  View pricing
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="stack-list">
            <section className="content-card">
              <p className="section-label">Step 1</p>
              <h2>What do you want to track?</h2>
              <Form action="/search" className="stack-form" method="get">
                <input name="mode" type="hidden" value="advertiser" />
                <input name="country" type="hidden" value="India" />
                <input name="platform" type="hidden" value="all" />
                <input name="creativeType" type="hidden" value="all" />
                <input name="status" type="hidden" value="all" />
                <label className="field">
                  <span>Brand or keyword</span>
                  <input
                    name="query"
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="boAt, Meesho, skincare serum, seller acquisition"
                    value={query}
                  />
                </label>
                <div className="inline-form">
                  <button className="button button-secondary" disabled={!trimmedQuery} type="submit">
                    Preview search
                  </button>
                  <small className="muted-text">
                    This opens the public search view with the same query.
                  </small>
                </div>
              </Form>
            </section>

            <section className="content-card">
              <p className="section-label">Step 2</p>
              <h2>Create your first watchlist</h2>
              <p className="muted-text">
                One click is enough to start tracking the same query inside the workspace.
              </p>
              <Form className="stack-form" method="post">
                <input name="intent" type="hidden" value="create-watchlist" />
                <input name="query" type="hidden" value={trimmedQuery} />
                <button className="button button-primary" disabled={!trimmedQuery} type="submit">
                  Create watchlist for {trimmedQuery || "your query"}
                </button>
              </Form>
            </section>
          </div>

          <div className="inline-form">
            <Form method="post">
              <input name="intent" type="hidden" value="finish" />
              <button className="button button-secondary" type="submit">
                Skip for now
              </button>
            </Form>
            <Link className="auth-switch" to={previewParams ? `/search?${previewParams}` : "/search"}>
              Go straight to search instead
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
