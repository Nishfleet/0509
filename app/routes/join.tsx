import { useActionData, useFetcher, useLoaderData } from "react-router";
import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { getOptionalSession } from "~/lib/auth.server";
import { getEnv } from "~/lib/context.server";
import {
  JOIN_IDENTITY_BUDGET_MS,
  resolveJoinIdentity,
  type JoinIdentityCandidate,
  type JoinIdentityResolution,
  type JoinInputKind,
} from "~/lib/join-identity.server";
import { safeRedirectPath } from "~/lib/safe-redirect";
import { publicSeoMeta } from "~/lib/seo";

/**
 * `/join` — onboarding slice 1 (issue #3173, epic #3172).
 *
 * ONE field: "Your website or your name". Submitting resolves an identity
 * card within the 5 s budget (the resolver itself caps at 3 s): name, logo,
 * site, socials found, ad count + last seen, and up to 3 ranked candidates
 * when the input is ambiguous. Confirm folds the identity into the EXISTING
 * signup + setup paths (#2415/#2414 prefill params; #3045 infers the self
 * role in the setup checklist) rather than opening a parallel flow. No
 * other question sits in the path.
 *
 * Persons disambiguate via handle / site / LinkedIn URL ON the card: when a
 * person input resolves to nothing, the card offers to enrich the input
 * with one of those markers and re-resolves server-side.
 *
 * time-to-first-confirm is recorded per signup as a structured log line
 * (`join_identity_confirm`) whose latency spans resolve-start → confirm
 * receipt, measured server-side via a first-touch cookie — the metric
 * source the /status counters pick up in a later epic slice.
 */

export const meta: MetaFunction = () => [
  ...publicSeoMeta({
    title: "Join | Five to Nine",
    description: "Add your website or your name, confirm the identity we find, and start your first watch.",
    pathname: "/join",
  }),
];

const MAX_INPUT_LENGTH = 200;
const FIRST_TOUCH_COOKIE = "f9_join_touch";
const MAX_COOKIE_AGE_SECONDS = 60 * 60;

export async function action({ context, request }: ActionFunctionArgs) {
  const env = getEnv(context);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "resolve");
  const input = String(formData.get("input") ?? "").slice(0, MAX_INPUT_LENGTH);

  if (!input.trim()) {
    return errorResponse("empty_input");
  }

  if (intent === "resolve") {
    // Live web lookup is on unless the e2e harness turns it off (deterministic
      // card time with zero external calls outside the budget).
      const liveLookup = process.env.E2E_JOIN_LIVE_LOOKUP !== "0";
    const resolution = await resolveJoinIdentity(env, input, {
      budgetMs: JOIN_IDENTITY_BUDGET_MS,
      liveLookup,
    });
    logJoinIdentityResolve(resolution);

    const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
    // First-touch marker: the confirm leg reads it to measure the real
    // server-to-server time-to-first-confirm delta.
    headers.append(
      "set-cookie",
      `${FIRST_TOUCH_COOKIE}=${Date.now()}; Max-Age=${MAX_COOKIE_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${
        process.env.NODE_ENV === "production" ? "; Secure" : ""
      }`,
    );
    return new Response(JSON.stringify({ resolution }), { headers });
  }

  if (intent === "confirm") {
    // The card's enrichment field (person disambiguation) replaces a bare
    // name when the visitor volunteers a site / LinkedIn URL there.
    const enrichment = String(formData.get("enrichment") ?? "").trim();
    const effectiveInput = enrichment && enrichment !== input ? enrichment : input;

    // Confirm re-resolves flow-forward facts (name / domain) WITHOUT the
    // live homepage probe: the visit already paid for the first card, and
    // the confirm metric must measure user latency, not a second lookup.
    const resolution = await resolveJoinIdentity(env, effectiveInput, {
      budgetMs: JOIN_IDENTITY_BUDGET_MS,
      liveLookup: process.env.E2E_JOIN_LIVE_LOOKUP !== "0",
    });

    const firstTouchValue = await readFirstTouch(request);
    const confirmLatencyMs = firstTouchValue ? Math.max(0, Date.now() - firstTouchValue) : null;

    const confirmedName =
      String(formData.get("pinnedName") ?? "").trim() || resolution.primary.name || effectiveInput;
    const confirmedDomain = resolution.primary.domain;

    console.info(
      JSON.stringify({
        event: "join_identity_confirm",
        kind: resolution.kind,
        confirm_latency_ms: confirmLatencyMs,
        domain: confirmedDomain,
        ts: new Date().toISOString(),
      }),
    );

    // Fold into the existing signup path: prefill params mirror what
    // #2415/#2414 already accept, and #3045's setup card keeps resolving
    // the target (and inferring the self role) on the next screen.
    const signupUrl = new URL("/auth/signup", new URL(request.url).origin);
    if (confirmedDomain) {
      signupUrl.searchParams.set("competitor", confirmedDomain);
      if (confirmedName && confirmedName !== confirmedDomain) {
        signupUrl.searchParams.set("name", confirmedName);
      }
    } else if (confirmedName) {
      signupUrl.searchParams.set("name", confirmedName);
    }
    const redirectTo = safeRedirectPath(String(formData.get("redirectTo") ?? ""), "/app#setup-checklist");
    if (redirectTo) {
      signupUrl.searchParams.set("redirectTo", redirectTo);
    }
    throw redirect(signupUrl.pathname + signupUrl.search);
  }

  return errorResponse("unknown_intent");
}

function errorResponse(code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status: 400,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function readFirstTouch(request: Request): Promise<number | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === FIRST_TOUCH_COOKIE) {
      const value = Number(rest.join("="));
      return Number.isFinite(value) && value > 0 ? value : null;
    }
  }
  return null;
}

function logJoinIdentityResolve(resolution: JoinIdentityResolution): void {
  console.info(
    JSON.stringify({
      event: "join_identity_resolve",
      kind: resolution.kind,
      elapsed_ms: resolution.elapsedMs,
      budget_ms: JOIN_IDENTITY_BUDGET_MS,
      candidates: resolution.candidates.length,
      ambiguous: resolution.ambiguous,
      live_lookup_timed_out: resolution.metrics.liveLookupTimedOut,
      ts: new Date().toISOString(),
    }),
  );
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const session = await getOptionalSession(env, request);
  const url = new URL(request.url);
  const redirectTo = safeRedirectPath(url.searchParams.get("redirectTo"), "/app#setup-checklist");
  if (session) {
    throw redirect(redirectTo);
  }
  return { redirectTo };
}

export default function JoinRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  // Progressive enhancement: a submit that lands before hydration (or with
  // JS unavailable) still resolves a card — the document POST's data is
  // hydration-deserialized into useActionData; the hydrated flow reads the
  // fetcher. Same card either way.
  const actionData = useActionData<typeof action>();

  const resolution =
    fetcher.data && !("error" in fetcher.data)
      ? (fetcher.data as { resolution: JoinIdentityResolution }).resolution
      : actionData && !("error" in actionData)
        ? (actionData as { resolution: JoinIdentityResolution }).resolution
        : null;
  const kindField = fetcher.data && !("error" in fetcher.data);
  const formErrorSource = kindField ? "fetcher" : actionData && "error" in actionData ? "action" : null;

  return (
    <main className="f9-auth-page">
      <div className="f9-container f9-auth-layout">
        <Link className="f9-brand f9-auth-brand" to="/" aria-label="Five to Nine home">
          <BrandWordmark />
        </Link>

        <section>
          <span>Start here</span>
          <h1>Your website or your name. That&rsquo;s the whole question.</h1>
          <p>
            We find who you are, the ads already on record, and any public mentions — then you confirm the one
            that&rsquo;s you. Everything after that is automatic.
          </p>
        </section>

        <div>
          <fetcher.Form method="post" action="/join" className="f9-join-form">
            <input type="hidden" name="intent" value="resolve" />
            <input type="hidden" name="redirectTo" value={loaderData.redirectTo} />
            <label htmlFor="join-input">Your website or your name</label>
            <input
              id="join-input"
              type="text"
              name="input"
              autoComplete="off"
              maxLength={MAX_INPUT_LENGTH}
              placeholder="yourbrand.com, your name, or a handle"
              required
            />
            <button type="submit" disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Looking…" : "Find my brand"}
            </button>
          </fetcher.Form>

          {formErrorSource === "fetcher" || formErrorSource === "action" ? (
            <p role="alert">Enter a website, a name, or a handle and try again.</p>
          ) : null}

          {resolution ? <IdentityCard resolution={resolution} redirectTo={loaderData.redirectTo} /> : null}
        </div>
      </div>
    </main>
  );
}

function IdentityCard({
  resolution,
  redirectTo,
}: {
  resolution: JoinIdentityResolution;
  redirectTo: string;
}) {
  const { primary, candidates, ambiguous } = resolution;
  const confirmFetcher = useFetcher<typeof action>();
  const enrichFetcher = useFetcher<typeof action>();

  return (
    <section className="f9-join-card" aria-label="Identity" aria-live="polite">
      <div className="f9-join-card-head">
        {primary.logoUrl ? (
          <img src={primary.logoUrl} alt="" width={48} height={48} loading="lazy" />
        ) : null}
        <div>
          <strong>{primary.name ?? primary.input}</strong>
          <p>{kindLabel(primary.kind)}</p>
        </div>
      </div>

      <dl className="f9-join-card-facts">
        {primary.site ? (
          <div>
            <dt>Site</dt>
            <dd>
              <a href={primary.site}>{primary.domain ?? primary.site}</a>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Ads on record</dt>
          <dd>
            {primary.adCount > 0
              ? `${primary.adCount} ad${primary.adCount === 1 ? "" : "s"}${
                  primary.adsLastSeenAt ? ` — last seen ${primary.adsLastSeenAt.slice(0, 10)}` : ""
                }`
              : "None yet. The first scan starts when you confirm."}
          </dd>
        </div>
        {primary.linkedinUrl ? (
          <div>
            <dt>LinkedIn</dt>
            <dd>{primary.linkedinUrl}</dd>
          </div>
        ) : null}
        {primary.handle ? (
          <div>
            <dt>Handle</dt>
            <dd>@{primary.handle}</dd>
          </div>
        ) : null}
      </dl>

      {ambiguous ? (
        <div className="f9-join-disambiguate">
          <p>
            Not sure that&rsquo;s you. Add the linkedin.com/in/ URL you use, or your site, and we&rsquo;ll pin it
            down.
          </p>
          <enrichFetcher.Form method="post" action="/join" className="f9-join-enrich">
            <input type="hidden" name="intent" value="resolve" />
            <input
              type="text"
              name="input"
              aria-label="Disambiguating marker"
              placeholder="linkedin.com/in/you, or your site"
              maxLength={MAX_INPUT_LENGTH}
            />
            <button type="submit">Check this instead</button>
          </enrichFetcher.Form>
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div className="f9-join-candidates">
          <p>More than one match. Pick yours:</p>
          <ul>
            {candidates.map((candidate) => (
              <li
                key={`${candidate.name ?? candidate.input}-${candidate.domain ?? ""}-${candidate.score.toFixed(1)}`}
              >
                <span>
                  <strong>{candidate.name ?? candidate.input}</strong>
                  {candidate.domain ? ` (${candidate.domain})` : ""} — {candidate.evidence}
                </span>
                <ConfirmMiniForm
                  candidate={candidate}
                  redirectTo={redirectTo}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <confirmFetcher.Form method="post" action="/join" className="f9-join-confirm">
        <input type="hidden" name="intent" value="confirm" />
        <input type="hidden" name="input" value={primary.input} />
        <input type="hidden" name="pinnedName" value={primary.name ?? ""} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <button type="submit" disabled={confirmFetcher.state !== "idle"}>
          {confirmFetcher.state !== "idle" ? "Confirming…" : "Yes, that’s me"}
        </button>
        <p>Confirming sets up the first watch — nothing else to configure.</p>
      </confirmFetcher.Form>
    </section>
  );
}

function ConfirmMiniForm({
  candidate,
  redirectTo,
}: {
  candidate: JoinIdentityCandidate;
  redirectTo: string;
}) {
  const fetcher = useFetcher<typeof action>();
  return (
    <fetcher.Form method="post" action="/join" className="f9-join-confirm-mini">
      <input type="hidden" name="intent" value="confirm" />
      <input type="hidden" name="input" value={candidate.domain ?? candidate.name ?? candidate.input} />
      <input type="hidden" name="pinnedName" value={candidate.name ?? ""} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <button type="submit" disabled={fetcher.state !== "idle"}>
        Confirm “{candidate.name ?? candidate.input}”
      </button>
    </fetcher.Form>
  );
}

function kindLabel(kind: JoinInputKind): string {
  return kind === "domain" ? "Website" : kind === "person" ? "Person" : "Brand";
}
