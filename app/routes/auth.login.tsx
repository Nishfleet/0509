import { Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

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
  const { safeRedirectPath } = await import("~/lib/safe-redirect");
  const {
    enabledBetterAuthOAuthProviders,
    isBetterAuthPasskeyEnabled,
  } = await import("~/lib/better-auth.server");
  const env = getEnv(context);
  const session = await getOptionalSession(env, request);
  const url = new URL(request.url);
  const redirectTo = safeRedirectPath(url.searchParams.get("redirectTo"), "/app");

  if (session) {
    throw redirect(redirectTo);
  }

  const message =
    url.searchParams.get("sent") === "1"
      ? "Check your email for a secure Five to Nine sign-in link."
      : null;
  const error = authErrorMessage(url.searchParams.get("error"));
  const oauthProviders = enabledBetterAuthOAuthProviders(env);
  const passkeysEnabled = isBetterAuthPasskeyEnabled(env);

  return {
    redirectTo,
    prefillEmail: url.searchParams.get("email")?.trim() || "",
    ...(oauthProviders.length > 0 ? { oauthProviders } : {}),
    ...(passkeysEnabled ? { passkeysEnabled } : {}),
    ...(message ? { message } : {}),
    ...(error ? { error } : {}),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { safeRedirectPath } = await import("~/lib/safe-redirect");
  const {
    BetterAuthUnknownUserError,
    isBetterAuthConfigured,
    isSameOriginAuthFormPost,
    sendBetterAuthMagicLink,
  } = await import("~/lib/better-auth.server");
  const env = getEnv(context);
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const redirectTo = safeRedirectPath(String(formData.get("redirectTo") ?? ""), "/app");

  if (!isBetterAuthConfigured(env)) {
    throw redirect("/auth/login?error=better_auth_not_configured");
  }
  if (!isSameOriginAuthFormPost(env, request)) {
    throw redirect("/auth/login?error=request_invalid");
  }

  try {
    await sendBetterAuthMagicLink(env, request, {
      email,
      mode: "login",
      redirectTo,
    });
  } catch (error) {
    if (!(error instanceof BetterAuthUnknownUserError)) {
      console.warn("failed to send Better Auth login email", error);
      throw redirect("/auth/login?error=send_failed");
    }
  }

  const next = new URL("/auth/login", request.url);
  next.searchParams.set("sent", "1");
  next.searchParams.set("email", email);
  next.searchParams.set("redirectTo", redirectTo);
  throw redirect(`${next.pathname}${next.search}`);
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
              <strong>Boards</strong>
              <p>Share useful ads and landing-page examples with clients or teammates.</p>
            </div>
          </div>
        </section>

        <AuthForm
          error={loaderData.error}
          initialEmail={loaderData.prefillEmail}
          message={loaderData.message}
          mode="login"
          oauthProviders={loaderData.oauthProviders}
          passkeysEnabled={loaderData.passkeysEnabled}
          redirectTo={loaderData.redirectTo}
        />
      </div>
    </main>
  );
}

function authErrorMessage(code: string | null) {
  if (code === "better_auth_not_configured") {
    return "Sign-in is not configured yet. Ask support to finish account access setup.";
  }
  if (code === "callback_failed" || code === "INVALID_TOKEN") {
    return "That sign-in link could not be verified. Request a fresh link and try again.";
  }
  if (code === "no_workspace") {
    return "No account was found for that email. Create an account first.";
  }
  if (code === "multiple_workspaces") {
    return "That email is attached to multiple accounts. Ask support to pick the right account before signing in.";
  }
  if (code === "unsupported_policy") {
    return "This account requires an additional sign-in step that Five to Nine has not enabled yet. Ask support to adjust that policy for now.";
  }
  if (code === "passwordless") {
    return "Five to Nine now uses secure email links instead of passwords.";
  }
  if (code === "request_invalid") {
    return "That sign-in request could not be verified. Open this page and try again.";
  }
  if (code === "send_failed") {
    return "We could not send that sign-in link. Try again in a minute.";
  }
  if (code === "oauth_not_configured") {
    return "That sign-in option is not configured yet. Use the email link for now.";
  }
  if (code === "oauth_failed") {
    return "That sign-in option could not start. Use the email link for now.";
  }
  if (code) {
    return "That sign-in request could not be completed. Request a fresh link and try again.";
  }
  return null;
}
