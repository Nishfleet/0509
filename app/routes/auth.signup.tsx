import { Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

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
  const { safeRedirectPath } = await import("~/lib/safe-redirect");
  const { enabledBetterAuthOAuthProviders } = await import("~/lib/better-auth.server");
  const env = getEnv(context);
  const session = await getOptionalSession(env, request);
  const url = new URL(request.url);
  const redirectTo = safeRedirectPath(url.searchParams.get("redirectTo"), "/app/onboard");

  if (session) {
    throw redirect(redirectTo);
  }

  const message =
    url.searchParams.get("sent") === "1"
      ? "Check your email. The setup link will verify you and create the account."
      : null;
  const error = signupErrorMessage(url.searchParams.get("error"));
  const oauthProviders = enabledBetterAuthOAuthProviders(env);

  return {
    redirectTo,
    // The marketing hero's email-capture form lands here with ?email=…
    prefillEmail: url.searchParams.get("email")?.trim() || "",
    ...(oauthProviders.length > 0 ? { oauthProviders } : {}),
    ...(message ? { message } : {}),
    ...(error ? { error } : {}),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { safeRedirectPath } = await import("~/lib/safe-redirect");
  const {
    isBetterAuthConfigured,
    isSameOriginAuthFormPost,
    sendBetterAuthMagicLink,
  } = await import("~/lib/better-auth.server");
  const env = getEnv(context);
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const redirectTo = safeRedirectPath(String(formData.get("redirectTo") ?? ""), "/app/onboard");

  if (!isBetterAuthConfigured(env)) {
    throw redirect("/auth/signup?error=better_auth_not_configured");
  }
  if (!isSameOriginAuthFormPost(env, request)) {
    throw redirect("/auth/signup?error=request_invalid");
  }

  try {
    await sendBetterAuthMagicLink(env, request, {
      email,
      mode: "signup",
      name: name || organizationName,
      redirectTo,
    });
  } catch (error) {
    console.warn("failed to send Better Auth signup email", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw redirect("/auth/signup?error=send_failed");
  }

  const next = new URL("/auth/signup", request.url);
  next.searchParams.set("sent", "1");
  next.searchParams.set("email", email);
  next.searchParams.set("redirectTo", redirectTo);
  throw redirect(`${next.pathname}${next.search}`);
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
              <p>Start from one competitor website.</p>
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

        <AuthForm
          error={loaderData.error}
          initialEmail={loaderData.prefillEmail}
          message={loaderData.message}
          mode="signup"
          oauthProviders={loaderData.oauthProviders}
          redirectTo={loaderData.redirectTo}
        />
      </div>
    </main>
  );
}

function signupErrorMessage(code: string | null) {
  if (code === "better_auth_not_configured") {
    return "Sign-up is not configured yet. Ask support to finish account access setup.";
  }
  if (code === "callback_failed" || code === "INVALID_TOKEN") {
    return "That setup link could not be verified. Request a fresh link and try again.";
  }
  if (code === "request_invalid") {
    return "That setup request could not be verified. Open this page and try again.";
  }
  if (code === "send_failed") {
    return "We could not send that setup link. Try again in a minute.";
  }
  if (code === "oauth_not_configured") {
    return "That sign-in option is not configured yet. Use the email link for now.";
  }
  if (code === "oauth_failed") {
    return "That sign-in option could not start. Use the email link for now.";
  }
  if (code) {
    return "That setup request could not be completed. Request a fresh link and try again.";
  }
  return null;
}
