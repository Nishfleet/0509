import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";

export const meta: MetaFunction = () => [{ title: "Confirm sign-in | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    BetterAuthMagicLinkCallbackError,
    betterAuthLegacyMagicLinkConfirmationTicketCookie,
    betterAuthMagicLinkConfirmationTicketCookie,
    clearBetterAuthMagicLinkConfirmationCookie,
    clearBetterAuthMagicLinkStateCookies,
    readBetterAuthMagicLinkConfirmationTicket,
  } = await import("~/lib/better-auth.server");
  const url = new URL(request.url);
  const mode =
    Boolean(url.searchParams.get("newUserCallbackURL")) || url.searchParams.get("mode") === "signup"
      ? "signup"
      : "login";
  const env = getEnv(context);

  if (url.searchParams.has("token")) {
    try {
      const headers = new Headers();
      headers.set("Cache-Control", "no-store");
      headers.append(
        "Set-Cookie",
        await betterAuthLegacyMagicLinkConfirmationTicketCookie(env, request, { mode }),
      );
      appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
      throw redirect(cleanMagicLinkPath(mode), { headers });
    } catch (error) {
      if (!(error instanceof BetterAuthMagicLinkCallbackError)) {
        throw error;
      }
      const stagedConfirmation = await readBetterAuthMagicLinkConfirmationTicket(env, request);
      if (stagedConfirmation) {
        throw redirect(cleanMagicLinkPath(stagedConfirmation.mode), {
          headers: {
            "Cache-Control": "no-store",
          },
        });
      }
      const headers = new Headers();
      headers.set("Cache-Control", "no-store");
      headers.append("Set-Cookie", clearBetterAuthMagicLinkConfirmationCookie(request));
      appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
      throw redirect(`/auth/${mode}?error=callback_failed`, { headers });
    }
  }

  if (url.searchParams.has("ticket")) {
    try {
      const ticketId = url.searchParams.get("ticket") || "";
      const ticket = await betterAuthMagicLinkConfirmationTicketCookie(env, request, {
        ticketId,
      });
      const headers = new Headers();
      headers.set("Cache-Control", "no-store");
      headers.append("Set-Cookie", ticket.cookie);
      appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
      throw redirect(cleanMagicLinkPath(ticket.mode), { headers });
    } catch (error) {
      if (!(error instanceof BetterAuthMagicLinkCallbackError)) {
        throw error;
      }
      const stagedConfirmation = await readBetterAuthMagicLinkConfirmationTicket(env, request);
      if (stagedConfirmation) {
        throw redirect(cleanMagicLinkPath(stagedConfirmation.mode), {
          headers: {
            "Cache-Control": "no-store",
          },
        });
      }
      const headers = new Headers();
      headers.set("Cache-Control", "no-store");
      headers.append("Set-Cookie", clearBetterAuthMagicLinkConfirmationCookie(request));
      appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
      throw redirect(`/auth/${mode}?error=callback_failed`, { headers });
    }
  }

  try {
    const confirmation = await readBetterAuthMagicLinkConfirmationTicket(env, request);
    if (!confirmation) {
      throw new BetterAuthMagicLinkCallbackError();
    }
    return Response.json(
      {
        emailHint: confirmation.emailHint ?? "",
        error: url.searchParams.get("error") === "email_mismatch"
          ? "Use the email address that received this link."
          : "",
        mode: confirmation.mode,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (!(error instanceof BetterAuthMagicLinkCallbackError)) {
      throw error;
    }
    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    headers.append("Set-Cookie", clearBetterAuthMagicLinkConfirmationCookie(request));
    appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
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
    clearBetterAuthMagicLinkStateCookies,
    consumeBetterAuthMagicLinkConfirmationTicket,
    isSameOriginAuthFormPost,
    normalizeBetterAuthMagicLinkEmail,
    readBetterAuthMagicLinkVerificationTicket,
    verifyBetterAuthMagicLink,
  } = await import("~/lib/better-auth.server");
  const env = getEnv(context);
  const url = new URL(request.url);
  const fallbackMode =
    Boolean(url.searchParams.get("newUserCallbackURL")) || url.searchParams.get("mode") === "signup"
      ? "signup"
      : "login";

  if (!isSameOriginAuthFormPost(env, request)) {
    throw redirect(`/auth/${fallbackMode}?error=request_invalid`, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  let confirmation;
  try {
    confirmation = await readBetterAuthMagicLinkVerificationTicket(env, request);
    if (!confirmation) {
      throw new BetterAuthMagicLinkCallbackError();
    }
  } catch (error) {
    if (!(error instanceof BetterAuthMagicLinkCallbackError)) {
      throw error;
    }
    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    headers.append("Set-Cookie", clearBetterAuthMagicLinkConfirmationCookie(request));
    appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
    throw redirect(`/auth/${fallbackMode}?error=callback_failed`, { headers });
  }

  if (confirmation.email) {
    const formData = await request.formData();
    const submittedEmail = normalizeBetterAuthMagicLinkEmail(String(formData.get("email") ?? ""));
    if (submittedEmail !== confirmation.email) {
      const headers = new Headers();
      headers.set("Cache-Control", "no-store");
      appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
      throw redirect(`${cleanMagicLinkPath(confirmation.mode)}&error=email_mismatch`, {
        headers,
      });
    }
  }

  let response: Response;
  try {
    response = await verifyBetterAuthMagicLink(env, request, confirmation);
  } catch (error) {
    console.warn(
      "failed to verify Better Auth magic link",
      error instanceof Error ? error.message : "unknown error",
    );
    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
    throw redirect(`/auth/${confirmation.mode}?error=callback_failed`, { headers });
  }

  if (response.status >= 500) {
    console.warn("failed to verify Better Auth magic link", response.status);
    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
    throw redirect(`/auth/${confirmation.mode}?error=callback_failed`, { headers });
  }

  try {
    await consumeBetterAuthMagicLinkConfirmationTicket(env, request);
  } catch (error) {
    console.warn(
      "failed to mark Better Auth magic-link ticket consumed",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  appendBetterAuthSetCookieHeaders(headers, response.headers);
  headers.append("Set-Cookie", clearBetterAuthMagicLinkConfirmationCookie(request));
  appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));

  const location =
    response.headers.get("Location") ??
    (confirmation.mode === "signup" && confirmation.newUserCallbackURL
      ? confirmation.newUserCallbackURL
      : confirmation.callbackURL);
  throw redirect(location, { headers });
}

export default function BetterAuthMagicLinkRoute() {
  const data = useLoaderData() as {
    emailHint?: string;
    error?: string;
    mode: "login" | "signup";
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
          <p>We will verify this email link after you continue.</p>
          <Form className="f9-auth-form" method="post" action={cleanMagicLinkPath(data.mode)}>
            {data.emailHint ? (
              <label className="f9-field">
                <span>Email</span>
                <input
                  autoComplete="email"
                  name="email"
                  placeholder={data.emailHint}
                  required
                  type="email"
                />
              </label>
            ) : null}
            {data.error ? <p className="f9-message is-error">{data.error}</p> : null}
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

function appendSetCookies(headers: Headers, cookies: string[]) {
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
}
