import { Link, redirect, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Sign in to Five to Nine to access saved searches, watchlists, proof collections, reports, and competitor digests.";

export const links: LinksFunction = () => canonicalLinks("/auth/login");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Sign in | Five to Nine",
    description,
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
    <main className="auth-shell">
      <div className="container auth-grid">
        <div className="auth-aside">
          <Link className="brand-mark" to="/">
            <span className="brand-pill" aria-hidden="true">
              09
            </span>
            <span>
              <strong>Five to Nine</strong>
              <small>Proof-backed competitor monitoring</small>
            </span>
          </Link>
          <div className="auth-points">
            <div>
              <p className="eyebrow">What unlocks after login</p>
              <h2>Monitoring is where the value compounds.</h2>
            </div>
            <ul className="bullet-list">
              <li>Save advertiser and keyword research without losing the filters.</li>
              <li>Track changes over time with watchlists and run history.</li>
              <li>Share collections and weekly digests with clients or teammates.</li>
            </ul>
          </div>
        </div>

        <AuthForm mode="login" redirectTo={loaderData.redirectTo} />
      </div>
    </main>
  );
}
