import { Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";
import { BrandWordmark } from "~/components/brand-wordmark";
import { recordFunnelEvent } from "~/lib/funnel-measurement.server";
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
  const redirectTo = safeRedirectPath(url.searchParams.get("redirectTo"), "/app#setup-checklist");

  if (session) {
    throw redirect(redirectTo);
  }

  const linkSent = url.searchParams.get("sent") === "1";
  const message = linkSent
      ? "Check your email. The setup link will verify you and create the account."
      : null;
  const error = signupErrorMessage(url.searchParams.get("error"));
  const oauthProviders = enabledBetterAuthOAuthProviders(env);

  return {
    redirectTo,
    // The marketing hero's email-capture form lands here with ?email=…
    prefillEmail: url.searchParams.get("email")?.trim() || "",
    linkSent,
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
  const redirectTo = safeRedirectPath(String(formData.get("redirectTo") ?? ""), "/app#setup-checklist");

  if (!name) {
    return signupActionError("name_required", { email, name, redirectTo });
  }
  if (!isPlausibleEmail(email)) {
    return signupActionError("email_invalid", { email, name, redirectTo });
  }

  if (!isBetterAuthConfigured(env)) {
    return signupActionError("better_auth_not_configured", { email, name, redirectTo });
  }
  if (!isSameOriginAuthFormPost(env, request)) {
    return signupActionError("request_invalid", { email, name, redirectTo });
  }

  try {
    await sendBetterAuthMagicLink(env, request, {
      email,
      mode: "signup",
      name,
      redirectTo,
    });
  } catch (error) {
    console.warn("failed to send Better Auth signup email", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return signupActionError("send_failed", { email, name, redirectTo });
  }

  recordFunnelEvent(env, request, { event: "funnel_signup_start" });

  const next = new URL("/auth/signup", request.url);
  next.searchParams.set("sent", "1");
  next.searchParams.set("email", email);
  next.searchParams.set("redirectTo", redirectTo);
  throw redirect(`${next.pathname}${next.search}`);
}

export default function SignupRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <main className="f9-auth-page">
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
          error={actionData?.error ?? loaderData.error}
          initialEmail={actionData?.email ?? loaderData.prefillEmail}
          initialName={actionData?.name ?? ""}
          linkSent={loaderData.linkSent && !actionData?.error}
          message={loaderData.message}
          mode="signup"
          oauthProviders={loaderData.oauthProviders}
          redirectTo={actionData?.redirectTo ?? loaderData.redirectTo}
        />
      </div>
    </main>
  );
}

function signupErrorMessage(code: string | null) {
  if (code === "better_auth_not_configured") {
    return "Sign-up isn't set up yet. Email support and we'll sort it out.";
  }
  if (code === "callback_failed" || code === "INVALID_TOKEN") {
    return "We couldn't verify that setup link — it may have expired. Request a fresh one below.";
  }
  if (code === "request_invalid") {
    return "We couldn't verify that setup request. Reload this page and try again.";
  }
  if (code === "send_failed") {
    return "We couldn't send the setup link. Try again in a minute.";
  }
  if (code === "name_required") {
    return "Enter your name to create the account.";
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
    return "We couldn't complete that setup. Request a fresh link and try again.";
  }
  return null;
}

function signupActionError(
  code: string,
  values: { email: string; name: string; redirectTo: string },
) {
  return {
    ok: false as const,
    error: signupErrorMessage(code) ?? "We couldn't complete that setup.",
    ...values,
  };
}

function isPlausibleEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
