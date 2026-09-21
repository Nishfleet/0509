import { Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { AuthForm } from "~/components/auth-form";
import { BrandWordmark } from "~/components/brand-wordmark";
import { canonicalLinks, jsonLdScriptProps, publicSeoMeta, webPageJsonLd } from "~/lib/seo";

const signupDescription =
  "Create a Five to Nine account to search competitor ads, save useful examples, and monitor offer changes.";

export const links: LinksFunction = () => canonicalLinks("/auth/signup");

export const meta: MetaFunction = () => [
  ...publicSeoMeta({
    title: "Create account | Five to Nine",
    description: signupDescription,
    pathname: "/auth/signup",
  }),
  // Auth/action surfaces stay out of the sitemap and carry noindex so Google
  // never indexes the signup entry (it would leak the auth surface, waste
  // crawl budget, and compete with the homepage for branded queries).
  { name: "robots", content: "noindex" },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { safeRedirectPath } = await import("~/lib/safe-redirect");
  const { enabledBetterAuthOAuthProviders } = await import("~/lib/better-auth.server");
  const env = getEnv(context);
  const session = await getOptionalSession(env, request);
  const url = new URL(request.url);
  let redirectTo = safeRedirectPath(url.searchParams.get("redirectTo"), "/app#setup-checklist");

  // Issue #2051 — the /ads/:domain "Track <domain>" CTA (and any other entry
  // point) may deep-link into signup with the viewed competitor prefilled as
  // bare `?competitor=<domain>`. When no explicit redirectTo is given, honor
  // the prefill by sending the new user straight into the setup checklist
  // with the brand as the first thing they track (the dashboard's existing
  // `?website=` prefill param).
  const competitor = url.searchParams.get("competitor")?.trim();
  if (competitor && !url.searchParams.get("redirectTo")) {
    redirectTo = `/app?website=${encodeURIComponent(competitor)}#setup-checklist`;
  }

  if (session) {
    throw redirect(redirectTo);
  }

  const linkSent = url.searchParams.get("sent") === "1";
  const linkResent = url.searchParams.get("resent") === "1";
  const message = linkSent
      ? "Check your email. The setup link will verify you and create the account."
      : null;
  const error = signupErrorMessage(url.searchParams.get("error"));
  const oauthProviders = enabledBetterAuthOAuthProviders(env);
  const { allowlistedSignupSource } = await import("~/lib/signup-source");
  const signupSource = allowlistedSignupSource(url.searchParams.get("source"));

  return {
    redirectTo,
    // The marketing hero's email-capture form lands here with ?email=…
    prefillEmail: url.searchParams.get("email")?.trim() || "",
    // The sent state re-posts the same name on resend, so it round-trips
    // through the redirect the same way the email does.
    prefillName: url.searchParams.get("name")?.trim() || "",
    // The optional "First competitor website" field pre-fills from a
    // ?competitor= deep link the same way the email/name pre-fills do.
    prefillCompetitor: competitor || "",
    // Issue #2414 — the optional "Your website" field round-trips through the
    // sent/resend states the same way.
    prefillBrandWebsite: url.searchParams.get("brandWebsite")?.trim() || "",
    linkSent,
    linkResent,
    ...(oauthProviders.length > 0 ? { oauthProviders } : {}),
    ...(message ? { message } : {}),
    ...(error ? { error } : {}),
    ...(signupSource ? { signupSource } : {}),
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
  const competitor = String(formData.get("competitor") ?? "").trim();
  const brandWebsite = String(formData.get("brandWebsite") ?? "").trim();
  let redirectTo = safeRedirectPath(String(formData.get("redirectTo") ?? ""), "/app#setup-checklist");
  // Issue #2415 — an inline competitor website on the signup form lands the
  // new user straight in the setup checklist with that brand pre-tracked,
  // mirroring the loader's `?competitor=` deep-link fold (only when the
  // redirect is still the default, never over an explicit redirect).
  if (competitor && redirectTo === "/app#setup-checklist") {
    redirectTo = `/app?website=${encodeURIComponent(competitor)}#setup-checklist`;
  }
  const isResend = formData.get("resend") === "1";

  // `name` is optional: the server already treats it as optional
  // (sendBetterAuthMagicLink takes `name?: string` and sends it through as
  // undefined when empty, mirroring the login route), so email-only signup
  // is allowed — the name is backfilled later from the onboarding flow.
  if (!isPlausibleEmail(email)) {
    return signupActionError("email_invalid", { email, name, redirectTo, competitor, brandWebsite });
  }

  if (!isBetterAuthConfigured(env)) {
    return signupActionError("better_auth_not_configured", { email, name, redirectTo, competitor, brandWebsite });
  }
  if (!isSameOriginAuthFormPost(env, request)) {
    return signupActionError("request_invalid", { email, name, redirectTo, competitor, brandWebsite });
  }

  // Issue #2414 — an optional "Your website" on signup seeds the auto-competitor
  // engine for the visitor's own brand: the same cache-only anonymous probe
  // /search runs, and the top 3 ride into the setup checklist inside the signed
  // #2174 handoff token (no `pick` = every seeded row pre-confirmed). The
  // checklist confirm then creates them within the plan cap, so a free signup
  // accepts exactly one. Only when the checklist is still the destination — an
  // explicit redirectTo or an inline `competitor` fold wins.
  if (brandWebsite && redirectTo === "/app#setup-checklist") {
    const { normalizeCompetitorWebsiteInput, registrableDomainFromLandingPage } =
      await import("~/lib/competitor-website");
    const brandDomain = registrableDomainFromLandingPage(
      normalizeCompetitorWebsiteInput(brandWebsite).normalizedUrl,
    );
    if (brandDomain) {
      try {
        const { getOptionalCloudflareContext } = await import("~/lib/cloudflare-context");
        const { defaultCountryForVisitor } = await import("~/lib/countries");
        const cloudflare = getOptionalCloudflareContext(context);
        const country = defaultCountryForVisitor(
          cloudflare?.country ?? request.headers.get("cf-ipcountry"),
        );
        const { seedAutoCompetitors } = await import("~/lib/auto-competitor-seed.server");
        const seeded = await seedAutoCompetitors(env, {
          domain: brandDomain,
          country,
          // No user row exists at signup time; the anonymous-preview sentinel
          // /search uses — accept-time dedupe happens in the checklist action.
          userId: "anonymous-search-preview",
        });
        const candidates = seeded.slice(0, 3);
        if (candidates.length > 0) {
          const { signCompetitorHandoff } = await import("~/lib/competitor-handoff.server");
          const token = await signCompetitorHandoff(env, {
            domain: brandDomain,
            country,
            candidates: candidates.map((candidate) => ({
              advertiser: candidate.advertiser,
              pageId: candidate.advertiserPageId,
              landingPageUrl: candidate.registrableDomain
                ? `https://${candidate.registrableDomain}`
                : null,
              targetCountry: candidate.countries[0] ?? null,
            })),
          });
          if (token) {
            redirectTo = `/app?handoff=${token}#setup-checklist`;
          }
        }
      } catch {
        // Discovery is best-effort — a probe failure must never block signup.
      }
    }
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
    return signupActionError("send_failed", { email, name, redirectTo, competitor, brandWebsite });
  }

  // CTA markers (`source=`) select an allowlisted funnel kind. The /pricing
  // Free card and locale resale pages both use this path. The raw
  // query value is compared to constants and never recorded.
  const { emitFunnelSignupStartFromAllowlistedSource } =
    await import("~/lib/funnel-measurement.server");
  emitFunnelSignupStartFromAllowlistedSource(
    env,
    request,
    new URL(request.url).searchParams.get("source"),
  );

  const {
    rememberAllowlistedSignupSource,
    signupSourceCookieHeader,
    signupSourceFromRequest,
  } = await import("~/lib/signup-source");
  const signupSource = await rememberAllowlistedSignupSource(env, {
    email,
    source:
      signupSourceFromRequest(request, String(formData.get("signupSource") ?? "")) ??
      new URL(request.url).searchParams.get("source"),
  });

  const next = new URL("/auth/signup", request.url);
  next.searchParams.set("sent", "1");
  next.searchParams.set("email", email);
  next.searchParams.set("name", name);
  next.searchParams.set("redirectTo", redirectTo);
  if (competitor) {
    next.searchParams.set("competitor", competitor);
  }
  if (brandWebsite) {
    next.searchParams.set("brandWebsite", brandWebsite);
  }
  if (isResend) {
    next.searchParams.set("resent", "1");
  }
  if (signupSource) {
    next.searchParams.set("source", signupSource);
  }
  const headers = new Headers();
  if (signupSource) {
    headers.set("Set-Cookie", await signupSourceCookieHeader(request, signupSource));
  }
  if (brandWebsite) {
    const { signupBrandWebsiteCookieHeader } = await import(
      "~/lib/setup-checklist-action.server"
    );
    headers.append("Set-Cookie", await signupBrandWebsiteCookieHeader(request, brandWebsite));
  }
  throw redirect(`${next.pathname}${next.search}`, { headers });
}

export default function SignupRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // Issue #3177: the join path already asked its one question and folded the
  // answer into `source=join` + prefill params, so the story stops telling the
  // visitor to paste a competitor.
  const isJoinSignup = loaderData.signupSource === "join";

  return (
    <main className="f9-auth-page">
      {/* Truthful WebPage JSON-LD mirroring the meta head: same title, same
          description, same canonical URL. Markup only — it never claims
          session state, link delivery, or provider status. */}
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Create account | Five to Nine",
            description: signupDescription,
            pathname: "/auth/signup",
          }),
        )}
      />
      <div className="f9-container f9-auth-layout">
        <section className="f9-auth-story">
          <Link className="f9-brand f9-auth-brand" to="/" aria-label="Five to Nine home">
            <BrandWordmark />
          </Link>

          <div>
            {isJoinSignup ? (
              <>
                <span>One step left</span>
                <h1>Confirm your work email to start tracking.</h1>
                <p>
                  The competitor is already picked. We send a setup link to your inbox — open it and the first
                  scan starts.
                </p>
              </>
            ) : (
              <>
                <span>First competitor</span>
                <h1>Start with the competitor your team keeps checking by hand.</h1>
                <p>
                  Paste a competitor website, find the ads behind it, and keep offer changes and landing-page
                  evidence in one place.
                </p>
              </>
            )}
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
          <p>
            No password to invent — the setup link arrives by email and verifies your work address. Open it,{" "}
            {isJoinSignup
              ? "and the first scan starts on the competitor you confirmed"
              : "add one competitor website, and the first scan starts"}
            ; the brief then arrives on your plan&rsquo;s schedule — weekly on free and Scout, daily and weekly on
            Starter and Agency. You can pause or remove a watchlist any time.
          </p>
        </section>

        <AuthForm
          error={actionData?.error ?? loaderData.error}
          initialEmail={actionData?.email ?? loaderData.prefillEmail}
          initialName={actionData?.name ?? loaderData.prefillName}
          initialCompetitor={actionData?.competitor ?? loaderData.prefillCompetitor}
          initialBrandWebsite={actionData?.brandWebsite ?? loaderData.prefillBrandWebsite}
          linkResent={loaderData.linkResent && !actionData?.error}
          linkSent={loaderData.linkSent && !actionData?.error}
          message={loaderData.message}
          mode="signup"
          oauthProviders={loaderData.oauthProviders}
          redirectTo={actionData?.redirectTo ?? loaderData.redirectTo}
          signupSource={loaderData.signupSource}
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
  values: { email: string; name: string; redirectTo: string; competitor: string; brandWebsite: string },
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
