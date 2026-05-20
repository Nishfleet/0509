import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";
import { BrandWordmark } from "~/components/brand-wordmark";

export const meta: MetaFunction = () => [
  { title: "Sign in | Five to Nine" },
  {
    name: "description",
    content: "Sign in to access saved searches, watchlists, collections, and weekly competitor digests in Five to Nine.",
  },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const session = await getOptionalSession(env, request);
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo") || "/app";

  if (session) {
    throw redirect(redirectTo);
  }

  return {
    redirectTo,
  };
}

export default function LoginRoute() {
  const loaderData = useLoaderData<typeof loader>();

  return (
    <main className="f9-auth-page">
      <div className="f9-auth-gradient" aria-hidden="true" />
      <div className="f9-container f9-auth-layout">
        <section className="f9-auth-story">
          <Link className="f9-brand f9-auth-brand" to="/" aria-label="Five to Nine home">
            <BrandWordmark />
          </Link>

          <div>
            <span>Workspace sign in</span>
            <h1>Return to the proof layer behind your market decisions.</h1>
            <p>
              Saved searches, watchlists, collections, and digests stay tied to source state so the team can pick up
              the exact market trail.
            </p>
          </div>

          <div className="f9-auth-proof-list">
            <div>
              <strong>Saved research</strong>
              <p>Keep filters and source labels attached to repeated checks.</p>
            </div>
            <div>
              <strong>Watchlists</strong>
              <p>Track competitor changes over time without losing proof history.</p>
            </div>
            <div>
              <strong>Collections</strong>
              <p>Share useful ads and landing-page evidence with clients or teammates.</p>
            </div>
          </div>
        </section>

        <AuthForm mode="login" redirectTo={loaderData.redirectTo} />
      </div>
    </main>
  );
}
