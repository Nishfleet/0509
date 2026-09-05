import { Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";
import { BrandWordmark } from "~/components/brand-wordmark";
import { canonicalLinks, jsonLdScriptProps, publicSeoMeta, webPageJsonLd } from "~/lib/seo";

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
    hasBetterAuthPasskeysForEmail,
    isBetterAuthPasskeyEnabled,
  } = await import("~/lib/better-auth.server");
  const env = getEnv(context);
  const session = await getOptionalSession(env, request);
  const url = new URL(request.url);
  const redirectTo = safeRedirectPath(url.searchParams.get("redirectTo"), "/app");
  const prefillEmail = url.searchParams.get("email")?.trim() || "";

  if (session) {
    throw redirect(redirectTo);
  }

  const linkSent = url.searchParams.get("sent") === "1";
  const message = linkSent
      ? "If an account exists for that address, you'll receive a secure sign-in link shortly."
      : null;
  const error = authErrorMessage(url.searchParams.get("error"));
  const oauthProviders = enabledBetterAuthOAuthProviders(env);
  const passkeysEnabled =
    isBetterAuthPasskeyEnabled(env) &&
    Boolean(prefillEmail) &&
    (await hasBetterAuthPasskeysForEmail(env, prefillEmail));

  return {
    redirectTo,
    prefillEmail,
    linkSent,
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

  if (!isPlausibleEmail(email)) {
    const next = new URLSearchParams({ error: "email_invalid", redirectTo });
    if (email) next.set("email", email);
    throw redirect(`/auth/login?${next.toString()}`);
  }

  if (!isBetterAuthConfigured(env)) {
    throw redirect(loginRetryPath({ error: "better_auth_not_configured", email, redirectTo }));
  }
  if (!isSameOriginAuthFormPost(env, request)) {
    throw redirect(loginRetryPath({ error: "request_invalid", email, redirectTo }));
  }

  try {
    await sendBetterAuthMagicLink(env, request, {
      email,
      mode: "login",
      redirectTo,
    });
  } catch (error) {
    if (!(error instanceof BetterAuthUnknownUserError)) {
      console.warn("failed to send Better Auth login email", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw redirect(loginRetryPath({ error: "send_failed", email, redirectTo }));
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
      {/* Truthful WebPage structured data, mirroring /status, /help, /docs:
          only what this shell shows — its head title, its description, and
          its canonical URL. Markup only; session and magic-link behavior are
          untouched. */}
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Sign in | Five to Nine",
            description: loginDescription,
            pathname: "/auth/login",
          }),
        )}
      />
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

        <AuthForm
          error={loaderData.error}
          initialEmail={loaderData.prefillEmail}
          linkSent={loaderData.linkSent}
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
    return "Sign-in isn't set up yet. Email support and we'll sort it out.";
  }
  if (code === "callback_failed" || code === "INVALID_TOKEN") {
    return "We couldn't verify that sign-in link — it may have expired. Request a fresh one below.";
  }
  if (code === "passwordless") {
    return "Five to Nine now uses secure email links instead of passwords.";
  }
  if (code === "request_invalid") {
    return "We couldn't verify that sign-in request. Reload this page and try again.";
  }
  if (code === "send_failed") {
    return "We couldn't send the sign-in link. Try again in a minute.";
  }
  if (code === "email_invalid") {
    return "Enter a valid email address.";
  }
  if (code === "oauth_not_configured") {
    return "That sign-in option isn't available yet. Use the email link for now.";
  }
  if (code === "oauth_failed") {
    return "We couldn't start that sign-in option. Use the email link for now.";
  }
  if (code) {
    return "We couldn't complete that sign-in. Request a fresh link and try again.";
  }
  return null;
}

function isPlausibleEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function loginRetryPath(input: { error: string; email: string; redirectTo: string }) {
  const next = new URLSearchParams({ error: input.error, redirectTo: input.redirectTo });
  if (input.email) next.set("email", input.email);
  return `/auth/login?${next.toString()}`;
}
