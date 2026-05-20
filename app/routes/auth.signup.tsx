import { Link, redirect, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";
import { BrandWordmark } from "~/components/brand-wordmark";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const signupDescription =
  "Create a Five to Nine account to save research, build collections, and monitor competitor changes on Meta.";

export const links: LinksFunction = () => canonicalLinks("/auth/signup");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Create account | Five to Nine",
    description: signupDescription,
    pathname: "/auth/signup",
  });

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const session = await getOptionalSession(env, request);
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo") || "/app/onboard";

  if (session) {
    throw redirect(redirectTo);
  }

  return {
    redirectTo,
  };
}

export default function SignupRoute() {
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
            <span>Workspace access</span>
            <h1>Build a proof-backed market intelligence workspace.</h1>
            <p>
              Save repeated market checks, monitor the competitor moves that matter, and keep evidence close to every
              decision your team makes.
            </p>
          </div>

          <div className="f9-auth-proof-list">
            <div>
              <strong>Search</strong>
              <p>Start from advertiser, keyword, offer, and platform searches.</p>
            </div>
            <div>
              <strong>Monitor</strong>
              <p>Turn repeated checks into watchlists with source-state history.</p>
            </div>
            <div>
              <strong>Brief</strong>
              <p>Use proof-backed summaries to move copy, pricing, and channel decisions.</p>
            </div>
          </div>
        </section>

        <AuthForm mode="signup" redirectTo={loaderData.redirectTo} />
      </div>
    </main>
  );
}
