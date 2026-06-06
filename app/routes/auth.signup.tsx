import { Link, redirect, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";
import { BrandWordmark } from "~/components/brand-wordmark";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const signupDescription =
  "Create a Five to Nine account to search competitor ads, save useful examples, and monitor offer changes.";

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
            <span>First competitor</span>
            <h1>Start with the competitor your team keeps checking by hand.</h1>
            <p>
              Paste a competitor website, find the ads behind it, and keep offer changes and landing-page evidence in
              one place.
            </p>
          </div>

          <div className="f9-auth-proof-list">
            <div>
              <strong>Search</strong>
              <p>Start from a competitor website, brand, keyword, offer, or platform.</p>
            </div>
            <div>
              <strong>Monitor</strong>
              <p>Turn repeated checks into saved competitors with evidence history.</p>
            </div>
            <div>
              <strong>Brief</strong>
              <p>Use change summaries to move copy, pricing, and sales responses faster.</p>
            </div>
          </div>
        </section>

        <AuthForm mode="signup" redirectTo={loaderData.redirectTo} />
      </div>
    </main>
  );
}
