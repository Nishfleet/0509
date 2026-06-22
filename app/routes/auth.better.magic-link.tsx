import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";

export const meta: MetaFunction = () => [{ title: "Confirm sign-in | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    BetterAuthMagicLinkCallbackError,
    betterAuthMagicLinkConfirmationCookie,
    clearBetterAuthMagicLinkStateCookie,
    readBetterAuthMagicLinkConfirmation,
  } = await import("~/lib/better-auth.server");
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const isSignup =
    Boolean(url.searchParams.get("newUserCallbackURL")) || url.searchParams.get("mode") === "signup";
  const mode = isSignup ? "signup" : "login";
  const env = getEnv(context);

  if (token) {
    const headers = new Headers();
    try {
      headers.append(
        "Set-Cookie",
        await betterAuthMagicLinkConfirmationCookie(env, request, url.toString()),
      );
    } catch (error) {
      if (!(error instanceof BetterAuthMagicLinkCallbackError)) {
        throw error;
      }
      headers.append("Set-Cookie", clearBetterAuthMagicLinkStateCookie(request));
      throw redirect(`/auth/${mode}?error=callback_failed`, { headers });
    }
    throw redirect(`/auth/better/magic-link?mode=${mode}`, { headers });
  }

  const confirmation = await readBetterAuthMagicLinkConfirmation(env, request);
  if (confirmation) {
    const isSignupConfirmation = Boolean(confirmation.newUserCallbackURL) || mode === "signup";
    return Response.json({
      email: confirmation.browserBound ? confirmation.email : "",
      fallbackStep: confirmation.browserBound
        ? "none"
        : confirmation.challengeId
        ? "code"
        : "email",
      mode: isSignupConfirmation ? "signup" : "login",
      requiresEmailConfirmation: !confirmation.browserBound,
    });
  }

  throw redirect(`/auth/${mode}?error=callback_failed`);
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    appendBetterAuthSetCookieHeaders,
    clearBetterAuthMagicLinkConfirmationCookie,
    clearBetterAuthMagicLinkStateCookie,
    isSameOriginAuthFormPost,
    readBetterAuthMagicLinkConfirmation,
    startBetterAuthMagicLinkFallbackChallenge,
    verifyBetterAuthMagicLinkFallbackChallenge,
    verifyBetterAuthMagicLink,
  } = await import("~/lib/better-auth.server");
  const env = getEnv(context);

  if (!isSameOriginAuthFormPost(env, request)) {
    throw redirect("/auth/login?error=request_invalid");
  }

  const confirmation = await readBetterAuthMagicLinkConfirmation(env, request);
  if (!confirmation) {
    throw redirect("/auth/login?error=callback_failed");
  }

  if (!confirmation.browserBound) {
    const formData = await request.clone().formData();
    const modePath = confirmation.newUserCallbackURL ? "signup" : "login";
    if (!confirmation.challengeId) {
      const confirmedEmail = String(formData.get("email") ?? "").trim().toLowerCase();
      if (confirmedEmail !== confirmation.email.trim().toLowerCase()) {
        throw redirect(`/auth/${modePath}?error=callback_failed`);
      }
      const headers = new Headers();
      headers.append(
        "Set-Cookie",
        await startBetterAuthMagicLinkFallbackChallenge(env, request, confirmation),
      );
      return redirect(
        `/auth/better/magic-link?mode=${confirmation.newUserCallbackURL ? "signup" : "login"}&challenge=sent`,
        { headers },
      );
    }

    const code = String(formData.get("code") ?? "");
    const verified = await verifyBetterAuthMagicLinkFallbackChallenge(env, confirmation, code);
    if (!verified) {
      throw redirect(`/auth/${modePath}?error=callback_failed`);
    }
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
  const data = useLoaderData() as {
    email: string;
    fallbackStep: "none" | "email" | "code";
    mode: "login" | "signup";
    requiresEmailConfirmation: boolean;
  };
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
            <p>Confirm this request before we open your account.</p>
          </div>
        </section>

        <section className="f9-auth-card">
          <span>{isSignup ? "Confirm setup" : "Confirm sign-in"}</span>
          <h2>{isSignup ? "Create your workspace" : "Open your account"}</h2>
          <p>
            {data.fallbackStep === "email"
              ? "Enter the email address that received this link. We will send a one-time code before continuing."
              : data.fallbackStep === "code"
              ? "Enter the one-time code we just sent to the email address that received this link."
              : data.email
              ? `We will verify the link for ${data.email} only after you continue.`
              : "We will verify the email link only after you continue."}
          </p>
          <Form className="f9-auth-form" method="post">
            {data.fallbackStep === "email" ? (
              <label className="f9-field">
                <span>Email</span>
                <input
                  autoComplete="email"
                  name="email"
                  placeholder="you@company.com"
                  required
                  type="email"
                />
              </label>
            ) : null}
            {data.fallbackStep === "code" ? (
              <label className="f9-field">
                <span>Code</span>
                <input
                  autoComplete="one-time-code"
                  inputMode="text"
                  name="code"
                  placeholder="ABCD2345"
                  required
                  type="text"
                />
              </label>
            ) : null}
            <button className="f9-primary-button" type="submit">
              {data.fallbackStep === "email"
                ? "Send code"
                : isSignup
                ? "Create workspace"
                : "Sign in"}
            </button>
          </Form>
        </section>
      </div>
    </main>
  );
}
