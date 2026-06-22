import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";

export const meta: MetaFunction = () => [{ title: "Confirm sign-in | Five to Nine" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const {
    BetterAuthMagicLinkStateError,
    betterAuthMagicLinkConfirmationCookie,
    clearBetterAuthMagicLinkStateCookie,
    readBetterAuthMagicLinkConfirmation,
  } = await import("~/lib/better-auth.server");
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const isSignup =
    Boolean(url.searchParams.get("newUserCallbackURL")) || url.searchParams.get("mode") === "signup";
  const mode = isSignup ? "signup" : "login";

  if (token) {
    const headers = new Headers();
    try {
      headers.append("Set-Cookie", betterAuthMagicLinkConfirmationCookie(request, url.toString()));
    } catch (error) {
      if (!(error instanceof BetterAuthMagicLinkStateError)) {
        throw error;
      }
      headers.append("Set-Cookie", clearBetterAuthMagicLinkStateCookie(request));
      throw redirect(`/auth/${mode}?error=callback_failed`, { headers });
    }
    throw redirect(`/auth/better/magic-link?mode=${mode}`, { headers });
  }

  const confirmation = readBetterAuthMagicLinkConfirmation(request);
  if (confirmation) {
    const isSignupConfirmation = Boolean(confirmation.newUserCallbackURL) || mode === "signup";
    return Response.json({
      email: confirmation.email ?? "",
      mode: isSignupConfirmation ? "signup" : "login",
    });
  }

  throw redirect("/auth/login?error=callback_failed");
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    appendBetterAuthSetCookieHeaders,
    clearBetterAuthMagicLinkConfirmationCookie,
    clearBetterAuthMagicLinkStateCookie,
    isSameOriginAuthFormPost,
    readBetterAuthMagicLinkConfirmation,
    verifyBetterAuthMagicLink,
  } = await import("~/lib/better-auth.server");
  const env = getEnv(context);

  if (!isSameOriginAuthFormPost(env, request)) {
    throw redirect("/auth/login?error=request_invalid");
  }

  const confirmation = readBetterAuthMagicLinkConfirmation(request);
  if (!confirmation) {
    throw redirect("/auth/login?error=callback_failed");
  }

  const response = await verifyBetterAuthMagicLink(env, request, confirmation);
  const headers = new Headers(response.headers);
  headers.delete("Set-Cookie");
  appendBetterAuthSetCookieHeaders(headers, response.headers);
  headers.append("Set-Cookie", clearBetterAuthMagicLinkConfirmationCookie(request));
  headers.append("Set-Cookie", clearBetterAuthMagicLinkStateCookie(request));
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export default function BetterAuthMagicLinkRoute() {
  const data = useLoaderData() as { email: string; mode: "login" | "signup" };
  const isSignup = data.mode === "signup";

  return (
    <main className="f9-auth-page">
      <div className="f9-auth-gradient" aria-hidden="true" />
      <div className="f9-container f9-auth-layout">
        <section className="f9-auth-story">
          <Link className="f9-brand f9-auth-brand" to="/" aria-label="Five to Nine home">
            <BrandWordmark />
          </Link>
          <div>
            <span>{isSignup ? "Workspace setup" : "Secure sign-in"}</span>
            <h1>{isSignup ? "Finish creating your workspace." : "Finish signing in."}</h1>
            <p>Continue from this browser to keep your account link protected.</p>
          </div>
        </section>

        <section className="f9-auth-card">
          <span>{isSignup ? "Confirm setup" : "Confirm sign-in"}</span>
          <h2>{isSignup ? "Create your workspace" : "Open your account"}</h2>
          <p>
            {data.email
              ? `We will verify the link for ${data.email} only after you continue.`
              : "We will verify the email link only after you continue."}
          </p>
          <Form className="f9-auth-form" method="post">
            <button className="f9-primary-button" type="submit">
              {isSignup ? "Create workspace" : "Sign in"}
            </button>
          </Form>
        </section>
      </div>
    </main>
  );
}
