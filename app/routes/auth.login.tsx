import { Link, redirect, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";
import { BrandWordmark } from "~/components/brand-wordmark";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const loginDescription =
  "Sign in to access saved competitors, alerts, reports, and useful ad examples in Five to Nine.";

export const links: LinksFunction = () => canonicalLinks("/auth/login");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Sign in | Five to Nine",
    description: loginDescription,
    pathname: "/auth/login",
  });

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
            <span>Competitor watch</span>
            <h1>Return to the changes your team is watching.</h1>
            <p>
              Saved competitors, useful ads, and change reports stay ready for the next sales call.
            </p>
          </div>

          <div className="f9-auth-proof-list">
            <div>
              <strong>Saved research</strong>
              <p>Keep competitor sites, filters, and notes attached to repeated checks.</p>
            </div>
            <div>
              <strong>Watchlists</strong>
              <p>Track competitor changes over time without losing the evidence.</p>
            </div>
            <div>
              <strong>Collections</strong>
              <p>Share useful ads and landing-page examples with clients or teammates.</p>
            </div>
          </div>
        </section>

        <AuthForm mode="login" redirectTo={loaderData.redirectTo} />
      </div>
    </main>
  );
}
