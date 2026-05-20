import { Link, redirect, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Create a Five to Nine pilot workspace to save competitor research, build proof collections, and monitor Meta ad changes.";

export const links: LinksFunction = () => canonicalLinks("/auth/signup");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Create account | Five to Nine",
    description,
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
    <main className="auth-shell">
      <div className="container auth-grid">
        <div className="auth-aside">
          <Link className="brand-mark" to="/">
            <span className="brand-pill" aria-hidden="true">
              09
            </span>
            <span>
              <strong>Five to Nine</strong>
              <small>India-first proof-backed monitoring</small>
            </span>
          </Link>
          <div className="auth-points">
            <div>
              <p className="eyebrow">Built for</p>
              <h2>Indian growth teams that need proof they can hand to a team or client.</h2>
            </div>
            <ul className="bullet-list">
              <li>Save repeated Ad Library checks without hiding source status.</li>
              <li>Track how offers, hooks, and landing pages change over time.</li>
              <li>Keep your team’s competitor learning in one reusable workspace.</li>
            </ul>
            <div className="auth-proof-note">
              <h3>What happens after signup</h3>
              <p>
                The workspace keeps research actions separate: run a public search first, save the useful query,
                turn it into a watchlist, then review changes only when source status and proof are visible.
                Pilot access is still activated manually when payment and delivery gates need review.
              </p>
              <p>
                Use signup when the public search flow is not enough anymore. Accounts are for teams that want
                saved filters, reusable competitor sets, proof collections, report links, and weekly review habits
                instead of one-off searches that disappear after the tab closes.
              </p>
            </div>
          </div>
        </div>

        <AuthForm mode="signup" redirectTo={loaderData.redirectTo} />
      </div>
    </main>
  );
}
