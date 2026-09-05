import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { noindexMetaEntry } from "~/lib/seo";

export const meta: MetaFunction = () => [
  { title: "Confirm sign-in | Five to Nine" },
  // The magic-link confirm page is an auth surface that renders (not a pure
  // redirect): it must carry noindex so Google never indexes the sign-in
  // confirmation entry. Shares the same helper as /auth/login.
  noindexMetaEntry(),
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    BetterAuthMagicLinkCallbackError,
    betterAuthLegacyMagicLinkConfirmationTicketCookie,
    betterAuthMagicLinkConfirmationTicketCookie,
    clearBetterAuthMagicLinkConfirmationCookies,
    clearBetterAuthMagicLinkStateCookies,
    readBetterAuthMagicLinkConfirmationTicket,
    readBetterAuthMagicLinkVerificationTicket,
    replacementBetterAuthMagicLinkConfirmationCookies,
    requestHasBetterAuthSessionCookie,
  } = await import("~/lib/better-auth.server");
  const url = new URL(request.url);
  const mode: "login" | "signup" =
    Boolean(url.searchParams.get("newUserCallbackURL")) || url.searchParams.get("mode") === "signup"
      ? "signup"
      : "login";
  const env = getEnv(context);

  if (url.searchParams.has("token")) {
    try {
      const headers = new Headers();
      headers.set("Cache-Control", "no-store");
      appendSetCookies(
        headers,
        replacementBetterAuthMagicLinkConfirmationCookies(
          request,
          await betterAuthLegacyMagicLinkConfirmationTicketCookie(env, request, { mode }),
        ),
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
      appendSetCookies(headers, clearBetterAuthMagicLinkConfirmationCookies(request));
      appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
      throw redirect(`/auth/${mode}?error=callback_failed`, { headers });
    }
  }

  if (url.searchParams.has("ticket")) {
    if (requestHasBetterAuthSessionCookie(request)) {
      const headers = new Headers();
      headers.set("Cache-Control", "no-store");
      appendSetCookies(headers, clearBetterAuthMagicLinkConfirmationCookies(request));
      appendSetCookies(headers, clearBetterAuthMagicLinkStateCookies(request));
      // Double-open: already signed in. Mirror the POST action's
      // session-present path (better-auth-magic-link-sign-in.server.ts) and
      // honor the ticket's stored callbackURL instead of dropping it for a
      // hardcoded /app. The callbackURL is same-origin-validated when the
      // ticket is read (parseSameOriginUrl), so no hand-rolled check is needed;
      // fall back to the mode default when no ticket is readable.
      const verification = await readBetterAuthMagicLinkVerificationTicket(env, request).catch(
        () => null,
      );
      if (verification?.callbackURL) {
        throw redirect(verification.callbackURL, { headers });
      }
      throw redirect(mode === "signup" ? "/app#setup-checklist" : "/app", { headers });
    }

    const ticketId = url.searchParams.get("ticket") || "";
    const stagingHeaders = new Headers();
    stagingHeaders.set("Cache-Control", "no-store");
    let confirmMode = mode;

    try {
      const ticket = await betterAuthMagicLinkConfirmationTicketCookie(env, request, {
        ticketId,
      });
      confirmMode = ticket.mode;
      appendSetCookies(
        stagingHeaders,
        replacementBetterAuthMagicLinkConfirmationCookies(request, ticket.cookie),
      );
      appendSetCookies(stagingHeaders, clearBetterAuthMagicLinkStateCookies(request));
    } catch (error) {
      if (!(error instanceof BetterAuthMagicLinkCallbackError)) {
        throw error;
      }
      const stagedConfirmation = await readBetterAuthMagicLinkConfirmationTicket(env, request);
      if (!stagedConfirmation) {
        appendSetCookies(stagingHeaders, clearBetterAuthMagicLinkConfirmationCookies(request));
        appendSetCookies(stagingHeaders, clearBetterAuthMagicLinkStateCookies(request));
        throw redirect(`/auth/${mode}?error=callback_failed`, { headers: stagingHeaders });
      }
      confirmMode = stagedConfirmation.mode;
    }

    throw redirect(cleanMagicLinkPath(confirmMode), { headers: stagingHeaders });
  }

  try {
    const confirmation = await readBetterAuthMagicLinkConfirmationTicket(env, request);
    if (!confirmation) {
      throw new BetterAuthMagicLinkCallbackError();
    }
    return Response.json(
      {
        error: "",
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
    appendSetCookies(headers, clearBetterAuthMagicLinkConfirmationCookies(request));
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
    isSameOriginAuthFormPost,
    readBetterAuthMagicLinkVerificationTicket,
  } = await import("~/lib/better-auth.server");
  const { completeBetterAuthMagicLinkSignIn } = await import(
    "~/lib/better-auth-magic-link-sign-in.server"
  );
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
    throw redirect(`/auth/${fallbackMode}?error=callback_failed`, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  await completeBetterAuthMagicLinkSignIn(env, request, confirmation);
}

export default function BetterAuthMagicLinkRoute() {
  const data = useLoaderData() as {
    error?: string;
    mode: "login" | "signup";
  };
  const isSignup = data.mode === "signup";

  return (
    <main className="f9-auth-page">
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
            <p>Email security scanners cannot finish this step — tap continue to open your account.</p>
          <Form className="f9-auth-form" method="post" action={cleanMagicLinkPath(data.mode)}>
            {data.error ? (
              <p aria-live="assertive" className="f9-wk-notice is-error" role="alert">
                {data.error}
              </p>
            ) : null}
            <button className="f9-wk-btn" type="submit">
              {isSignup ? "Create workspace" : "Continue to account"}
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
