import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";

export const meta: MetaFunction = () => [{ title: "Confirm sign-in | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    BetterAuthMagicLinkCallbackError,
    betterAuthMagicLinkConfirmationTicketCookie,
    betterAuthMagicLinkConfirmationFromRequest,
    clearBetterAuthMagicLinkConfirmationCookie,
    clearBetterAuthMagicLinkStateCookie,
    readBetterAuthMagicLinkConfirmationTicket,
    readBetterAuthMagicLinkConfirmationContext,
  } = await import("~/lib/better-auth.server");
  const url = new URL(request.url);
  const mode =
    Boolean(url.searchParams.get("newUserCallbackURL")) || url.searchParams.get("mode") === "signup"
      ? "signup"
      : "login";
  const env = getEnv(context);

  if (url.searchParams.has("token") || url.searchParams.has("context")) {
    try {
      const confirmation = betterAuthMagicLinkConfirmationFromRequest(request);
      const confirmationContext = await readBetterAuthMagicLinkConfirmationContext(env, request);
      if (!confirmationContext?.browserBound) {
        throw new BetterAuthMagicLinkCallbackError();
      }

      const headers = new Headers();
      headers.append(
        "Set-Cookie",
        await betterAuthMagicLinkConfirmationTicketCookie(env, request, {
          ...confirmation,
          ...confirmationContext,
        }),
      );
      throw redirect(cleanMagicLinkPath(confirmationContext.mode), { headers });
    } catch (error) {
      if (!(error instanceof BetterAuthMagicLinkCallbackError)) {
        throw error;
      }
      const headers = new Headers();
      headers.append("Set-Cookie", clearBetterAuthMagicLinkConfirmationCookie(request));
      headers.append("Set-Cookie", clearBetterAuthMagicLinkStateCookie(request));
      throw redirect(`/auth/${mode}?error=callback_failed`, { headers });
    }
  }

  try {
    const confirmation = await readBetterAuthMagicLinkConfirmationTicket(env, request);
    if (!confirmation?.browserBound) {
      throw new BetterAuthMagicLinkCallbackError();
    }
    return Response.json({
      email: confirmation.email,
      mode: confirmation.mode,
      requiresEmailConfirmation: false,
    });
  } catch (error) {
    if (!(error instanceof BetterAuthMagicLinkCallbackError)) {
      throw error;
    }
    const headers = new Headers();
    headers.append("Set-Cookie", clearBetterAuthMagicLinkConfirmationCookie(request));
    headers.append("Set-Cookie", clearBetterAuthMagicLinkStateCookie(request));
    throw redirect(`/auth/${mode}?error=callback_failed`, {
      headers,
    });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    BetterAuthMagicLinkCallbackError,
    appendBetterAuthSetCookieHeaders,
    clearBetterAuthMagicLinkConfirmationCookie,
    clearBetterAuthMagicLinkStateCookie,
    isSameOriginAuthFormPost,
    readBetterAuthMagicLinkConfirmationTicket,
    verifyBetterAuthMagicLink,
  } = await import("~/lib/better-auth.server");
  const env = getEnv(context);
  const url = new URL(request.url);
  const fallbackMode =
    Boolean(url.searchParams.get("newUserCallbackURL")) || url.searchParams.get("mode") === "signup"
      ? "signup"
      : "login";

  if (!isSameOriginAuthFormPost(env, request)) {
    throw redirect(`/auth/${fallbackMode}?error=request_invalid`);
  }

  let confirmation;
  try {
    confirmation = await readBetterAuthMagicLinkConfirmationTicket(env, request);
    if (!confirmation?.browserBound) {
      throw new BetterAuthMagicLinkCallbackError();
    }
  } catch (error) {
    if (!(error instanceof BetterAuthMagicLinkCallbackError)) {
      throw error;
    }
    const headers = new Headers();
    headers.append("Set-Cookie", clearBetterAuthMagicLinkConfirmationCookie(request));
    headers.append("Set-Cookie", clearBetterAuthMagicLinkStateCookie(request));
    throw redirect(`/auth/${fallbackMode}?error=callback_failed`, { headers });
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
            {data.requiresEmailConfirmation
              ? "Enter the email address that received this link before continuing."
              : data.email
              ? `We will verify the link for ${data.email} after you continue.`
              : "We will verify the email link after you continue."}
          </p>
          <Form className="f9-auth-form" method="post" action={cleanMagicLinkPath(data.mode)}>
            {data.requiresEmailConfirmation ? (
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
            <button className="f9-primary-button" type="submit">
              {isSignup ? "Create workspace" : "Sign in"}
            </button>
          </Form>
        </section>
      </div>
    </main>
  );
}

function cleanMagicLinkPath(mode: "login" | "signup") {
  return `/auth/better/magic-link?mode=${mode}`;
}
