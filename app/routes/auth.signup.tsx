import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";

export const meta: MetaFunction = () => [
  { title: "Create account | Five to Nine" },
  {
    name: "description",
    content: "Create a Five to Nine account to save research, build collections, and monitor competitor changes on Meta.",
  },
];

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
              <h2>Indian growth teams that need shared memory, not tab chaos.</h2>
            </div>
            <ul className="bullet-list">
              <li>Save hours of repeated Ad Library digging every week.</li>
              <li>Track how offers, hooks, and landing pages change over time.</li>
              <li>Keep your team’s competitor learning in one reusable workspace.</li>
            </ul>
          </div>
        </div>

        <AuthForm mode="signup" redirectTo={loaderData.redirectTo} />
      </div>
    </main>
  );
}
