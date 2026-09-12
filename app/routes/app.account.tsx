import { Form, Link, useActionData, useLoaderData, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { ActionFeedback } from "~/components/action-feedback";
import { AccountBrandingForm } from "~/components/account-branding-form";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { ThemeToggle } from "~/components/theme-toggle";
import { WorkingHeader } from "~/components/workspace/working-header";
import {
  hasInvalidCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
} from "~/lib/competitor-website";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const meta = () => [{ title: "Account | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Account & security" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { isBetterAuthPasskeyEnabled, listBetterAuthPasskeys, listBetterAuthSessions } = await import(
    "~/lib/better-auth.server"
  );
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { getWorkspaceBranding } = await import("~/lib/data.server");
  const { resolveWorkspaceBrandIdentity } = await import("~/lib/plan-feature-gate.server");
  const { isE2EFixtureWorkspaceSession } = await import("~/lib/e2e-auth.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const isE2EFixtureSession = isE2EFixtureWorkspaceSession(env, request, session.session.id);

  const passkeysEnabled = !isE2EFixtureSession && isBetterAuthPasskeyEnabled(env);
  // Every lookup below is independent — run them as one parallel wave. Each
  // keeps its original per-section failure fallback.
  let passkeyControlsMessage: string | null = null;
  let sessionControlsMessage: string | null = isE2EFixtureSession
    ? "Sign in with email to manage active sessions."
    : null;
  const [plan, reportBrandIdentity, branding, passkeys, activeSessions, emailVerified] =
    await Promise.all([
      getUserPlan(env, session.user.id),
      resolveWorkspaceBrandIdentity(env, session.user.id),
      getWorkspaceBranding(env, session.user.id),
      passkeysEnabled
        ? listBetterAuthPasskeys(env, request).catch((error) => {
            console.warn("[account] passkey controls unavailable", error);
            passkeyControlsMessage = "Sign in again to manage passkeys.";
            return [] as Awaited<ReturnType<typeof listBetterAuthPasskeys>>;
          })
        : ([] as Awaited<ReturnType<typeof listBetterAuthPasskeys>>),
      isE2EFixtureSession
        ? ([] as Awaited<ReturnType<typeof listBetterAuthSessions>>)
        : listBetterAuthSessions(env, request, session.session.id).catch((error) => {
            console.warn("[account] session controls unavailable", error);
            sessionControlsMessage = "Sign in again to manage active sessions.";
            return [] as Awaited<ReturnType<typeof listBetterAuthSessions>>;
          }),
      // Default to verified on a transient DB error so the banner never nags a
      // verified user; the retention gates re-check on every action anyway.
      import("~/lib/email-verification.server")
        .then(({ isUserEmailVerified }) => isUserEmailVerified(env, session.user.id))
        .catch((error) => {
          console.warn("[account] email verification status unavailable", error);
          return true;
        }),
    ]);

  // Issue #3168: pending self-serve state is read by the UI below to
  // show a real grace timer (delete) and an inbox-check banner (email
  // change). Read it after the main payload so a slow DB read never blocks
  // the rest of the page.
  const [pendingDeletion, pendingEmailChange] = isE2EFixtureSession
    ? [null, null]
    : await Promise.all([
        import("~/lib/account-self-serve.server").then(({ readPendingAccountDeletion }) =>
          readPendingAccountDeletion(env, session.user.id),
        ),
        import("~/lib/account-self-serve.server").then(({ readPendingAccountEmailChange }) =>
          readPendingAccountEmailChange(env, session.user.id),
        ),
      ]);

  // The deletion/email-change confirmation routes redirect back here
  // with one of these flags. Read them server-side so the render path
  // does not depend on useSearchParams() (which requires a Router
  // context that the page-level tests do not provide).
  const url = new URL(request.url);
  const deletionNotice = url.searchParams.get("deletion");
  const emailChangeNotice = url.searchParams.get("email-change");

  return {
    email: session.user.email,
    emailVerified,
    name: session.user.name,
    sessionExpiresAt: session.session.expiresAt,
    plan,
    brandName: reportBrandIdentity?.brandName ?? null,
    brandLogo: reportBrandIdentity?.brandLogo ?? null,
    brandWebsite: branding.brandWebsite,
    passkeys,
    passkeysEnabled,
    passkeyControlsMessage,
    activeSessions,
    sessionControlsMessage,
    pendingDeletion: pendingDeletion
      ? {
          id: pendingDeletion.id,
          emailAtRequest: pendingDeletion.email_at_request,
          requestedAt: pendingDeletion.requested_at,
          scheduledFor: pendingDeletion.scheduled_for,
        }
      : null,
    pendingEmailChange: pendingEmailChange
      ? {
          id: pendingEmailChange.id,
          newEmail: pendingEmailChange.new_email,
          requestedAt: pendingEmailChange.requested_at,
          expiresAt: pendingEmailChange.expires_at,
        }
      : null,
    deletionNotice,
    emailChangeNotice,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { upsertWorkspaceBranding } = await import("~/lib/data.server");
  const { isE2EFixtureWorkspaceSession } = await import("~/lib/e2e-auth.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const contentType = request.headers.get("content-type") ?? "";
  let formData: FormData;
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const [{ readRequestBytesWithinLimit }, { WORKSPACE_BRAND_LOGO_MAX_MULTIPART_BYTES }] =
      await Promise.all([
        import("~/lib/bounded-response.server"),
        import("~/lib/workspace-brand-logo.server"),
      ]);
    const requestBytes = await readRequestBytesWithinLimit(
      request,
      WORKSPACE_BRAND_LOGO_MAX_MULTIPART_BYTES,
    );
    if (!requestBytes) {
      return {
        ok: false,
        intent: "save-report-branding",
        error: "invalid_brand_logo" as const,
        message: "Logo must be 48 KB or smaller.",
      };
    }
    formData = await new Request(request.url, {
      method: request.method,
      headers: { "content-type": contentType },
      body: new Uint8Array(requestBytes),
    }).formData();
  } else {
    formData = await request.formData();
  }
  const intent = String(formData.get("intent") ?? "");
  const isE2EFixtureSession = isE2EFixtureWorkspaceSession(env, request, session.session.id);

  if (intent === "save-report-branding") {
    const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
    const brandingGate = await requireWorkspacePlanFeature(env, session.user.id, "agency_branding");
    if (!brandingGate.ok) {
      return {
        ok: false,
        intent,
        error: "plan_gated" as const,
        message: "Branded reports are part of Agency.",
      };
    }

    const removeBrandLogo = formData.get("removeBrandLogo") === "true";
    const brandingInput: { brandName: string; brandLogo?: string | null } = {
      brandName: String(formData.get("brandName") ?? ""),
    };

    if (removeBrandLogo) {
      brandingInput.brandLogo = null;
    } else {
      const { parseWorkspaceBrandLogoUpload } = await import(
        "~/lib/workspace-brand-logo.server"
      );
      const logoUpload = await parseWorkspaceBrandLogoUpload(formData.get("brandLogo"));
      if (!logoUpload.ok) {
        return {
          ok: false,
          intent,
          error: "invalid_brand_logo" as const,
          message: logoUpload.message,
        };
      }
      if (logoUpload.brandLogo) {
        brandingInput.brandLogo = logoUpload.brandLogo;
      }
    }

    const result = await upsertWorkspaceBranding(env, session.user.id, brandingInput);

    return {
      ok: true,
      intent,
      message:
        result.brandName && result.brandLogo
          ? "Agency name and logo saved for shared reports."
          : result.brandName
            ? `Saved. Shared reports now open with "Prepared by ${result.brandName}".`
            : result.brandLogo
              ? "Saved. Shared reports use your agency logo."
              : "Branding cleared. Shared reports show Five to Nine only.",
    };
  }

  if (intent === "save-brand-profile") {
    const brandWebsiteInput = String(formData.get("brandWebsite") ?? "").trim();
    const brandWebsite = normalizeCompetitorWebsiteInput(brandWebsiteInput);
    if (hasInvalidCompetitorWebsite(brandWebsite)) {
      return {
        ok: false,
        intent,
        error: "invalid_brand_website" as const,
        message: brandWebsite.error,
      };
    }

    const result = await upsertWorkspaceBranding(env, session.user.id, {
      brandWebsite: brandWebsite.normalizedUrl,
    });

    return {
      ok: true,
      intent,
      message: result.brandWebsite
        ? "Saved your brand website."
        : "Brand website cleared.",
    };
  }

  if (intent === "resend-verification") {
    const { requestEmailVerification } = await import("~/lib/email-verification.server");
    await requestEmailVerification(env, request, {
      email: session.user.email,
      callbackURL: "/app/account",
    });
    return {
      ok: true,
      intent,
      message: "Verification email sent. The link expires after an hour — check your inbox.",
    };
  }

  if (intent === "revoke-session") {
    if (isE2EFixtureSession) {
      return { ok: false, intent, message: "Sign in with email to manage active sessions." };
    }

    const { revokeBetterAuthSessionById } = await import("~/lib/better-auth.server");
    try {
      const result = await revokeBetterAuthSessionById(env, request, {
        currentSessionId: session.session.id,
        sessionId: String(formData.get("sessionId") ?? ""),
      });
      if (!result.ok) {
        return { ok: false, intent, message: result.reason };
      }
      return { ok: true, intent, message: "That session was revoked." };
    } catch (error) {
      console.error("[account] session revoke failed", error);
      return { ok: false, intent, message: "Sign in again, then retry session revocation." };
    }
  }

  if (intent === "revoke-other-sessions") {
    if (isE2EFixtureSession) {
      return { ok: false, intent, message: "Sign in with email to manage active sessions." };
    }

    const { revokeOtherBetterAuthSessions } = await import("~/lib/better-auth.server");
    try {
      await revokeOtherBetterAuthSessions(env, request);
      return { ok: true, intent, message: "Other active sessions were revoked." };
    } catch (error) {
      console.error("[account] revoke other sessions failed", error);
      return { ok: false, intent, message: "Sign in again, then retry session revocation." };
    }
  }

  if (intent === "request-account-deletion" || intent === "request-email-change") {
    // Both deletion and email change now live behind dedicated POST routes
    // (/api/account/delete-request, /api/account/email-change-request).
    // The forms in this page POST directly to those endpoints. If a stale
    // tab still submits the old intent, return a friendly message so the
    // user sees the page is current rather than a no-op success.
    return {
      ok: false,
      intent,
      message:
        intent === "request-account-deletion"
          ? "Account deletion now lives at /app/account#deletion. Use the form there."
          : "Email change now lives at /app/account#email. Use the form there.",
    };
  }

  return { ok: false, intent, message: "We couldn't complete that action. Refresh the page and try again." };
}

function isPlausibleEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export default function AccountRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const brandProfileAction =
    actionData?.intent === "save-brand-profile" ? actionData : null;
  const reportBrandingAction =
    actionData?.intent === "save-report-branding" ? actionData : null;
  const reportBrandLogoInvalid = Boolean(
    reportBrandingAction &&
      !reportBrandingAction.ok &&
      "error" in reportBrandingAction &&
      reportBrandingAction.error === "invalid_brand_logo",
  );
  const sessionAction =
    actionData?.intent === "revoke-session" || actionData?.intent === "revoke-other-sessions"
      ? actionData
      : null;
  const deletionAction =
    actionData?.intent === "request-account-deletion" ? actionData : null;
  const emailChangeAction =
    actionData?.intent === "request-email-change" ? actionData : null;
  const resendVerificationAction =
    actionData?.intent === "resend-verification" ? actionData : null;
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyPendingId, setPasskeyPendingId] = useState<string | null>(null);
  const [passkeyConfirmId, setPasskeyConfirmId] = useState<string | null>(null);
  const otherSessionCount = data.activeSessions.filter((session) => !session.isCurrent).length;
  // /api/account/delete-confirm or /api/account/delete-cancel redirects
  // back here with one of these flags. The Account page surfaces the
  // matching notice instead of a generic toast so the user sees exactly
  // which way the request went. Loader reads URL search params directly
  // (no useSearchParams — see loader for the reason).
  const deletionNotice = data.deletionNotice ?? null;
  const emailChangeNotice = data.emailChangeNotice ?? null;

  return (
    <DashboardPage className="f9-wk-page f9-acct-page f9-acct-account">
      <WorkingHeader
        context={
          <>
            Signed in as {data.email}. Sign-in security, brand setup, and sensitive requests live
            here.
          </>
        }
        title="Account & security"
      />

      <section className="f9-acct-section">
        <div className="f9-acct-section-head">
          <div>
            <span className="f9-acct-label">Appearance</span>
            <h2>Workspace theme</h2>
          </div>
        </div>
        <p className="f9-acct-copy">
          Choose how the workspace looks on this device. "System" follows your operating system
          setting. Saved in this browser only — public pages and shared reports stay light.
        </p>
        <ThemeToggle />
      </section>

      {!data.emailVerified ? (
        <section className="f9-acct-section">
          <div className="f9-acct-section-head">
            <div>
              <span className="f9-acct-label">Email</span>
              <h2>Verify your email</h2>
            </div>
            <Form method="post">
              <input name="intent" type="hidden" value="resend-verification" />
              <SubmitButton className="f9-acct-text-action" intent="resend-verification" pendingLabel="Sending…">
                Resend verification email
              </SubmitButton>
            </Form>
          </div>
          <p className="f9-acct-copy">
            {resendVerificationAction?.message ??
              `Watchlists, digests, and alerts stay locked until ${data.email} is verified.`}
          </p>
        </section>
      ) : null}

      <section className="f9-acct-section">
        <div className="f9-acct-section-head">
          <div>
            <span className="f9-acct-label">Workspace setup</span>
            <h2>Add another competitor</h2>
          </div>
          <Link className="f9-acct-text-action" to="/app/watchlists">
            Add competitor
          </Link>
        </div>
        <p className="f9-acct-copy">
          Extend the watch board without resetting the account, or{" "}
          <Link to="#brand-profile">update your own brand website</Link> below.
        </p>
      </section>

      {data.passkeysEnabled ? (
        <section className="f9-acct-section">
          <div className="f9-acct-section-head">
            <div>
              <span className="f9-acct-label">Passkeys</span>
              <h2>Use this device to sign in faster</h2>
            </div>
          </div>
          {passkeyMessage ? <p aria-live="polite" className="f9-wk-notice is-success" role="status">{passkeyMessage}</p> : null}
          {passkeyError ? <p aria-live="polite" className="f9-wk-notice is-error" role="alert">{passkeyError}</p> : null}
          {data.passkeyControlsMessage ? (
            <p className="f9-acct-copy">{data.passkeyControlsMessage}</p>
          ) : (
            <>
              <div className="f9-account-security-actions">
                <button
                  className="f9-acct-text-action"
                  disabled={passkeyPending}
                  onClick={() => {
                    void registerPasskey({
                      setError: setPasskeyError,
                      setMessage: setPasskeyMessage,
                      setPending: setPasskeyPending,
                      revalidate: () => revalidator.revalidate(),
                    });
                  }}
                  type="button"
                >
                  {passkeyPending ? "Adding..." : "Add passkey"}
                </button>
              </div>
              {data.passkeys.length > 0 ? (
                <div className="f9-passkey-list">
                  {data.passkeys.map((passkey) => (
                    <div className="f9-passkey-row" key={passkey.id}>
                      <div>
                        <strong>{passkey.label}</strong>
                        <span>Created <LocalTime iso={passkey.createdAt} mode="date" /></span>
                      </div>
                      <span>
                        {passkey.lastUsedAt ? (
                          <>Last used <LocalTime iso={passkey.lastUsedAt} mode="date" /></>
                        ) : (
                          "Not used yet"
                        )}
                      </span>
                      <div className="f9-account-security-actions">
                        {passkeyConfirmId === passkey.id ? (
                          <>
                            <button
                              className="f9-acct-text-action"
                              disabled={passkeyPendingId === passkey.id}
                              onClick={() => setPasskeyConfirmId(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                            <button
                              className="f9-acct-text-action"
                              disabled={passkeyPendingId === passkey.id}
                              onClick={() => {
                                void removePasskey({
                                  id: passkey.id,
                                  setError: setPasskeyError,
                                  setMessage: setPasskeyMessage,
                                  setPendingId: setPasskeyPendingId,
                                  setConfirmId: setPasskeyConfirmId,
                                  revalidate: () => revalidator.revalidate(),
                                });
                              }}
                              type="button"
                            >
                              {passkeyPendingId === passkey.id ? "Removing…" : "Confirm — remove passkey?"}
                            </button>
                          </>
                        ) : (
                          <button
                            className="f9-acct-text-action"
                            disabled={passkeyPendingId !== null}
                            onClick={() => {
                              setPasskeyError(null);
                              setPasskeyConfirmId(passkey.id);
                            }}
                            type="button"
                          >
                            Remove passkey
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="f9-wk-note">No passkey is attached yet — add one and it signs you in without a link.</p>
              )}
            </>
          )}
        </section>
      ) : null}

      <section className="f9-acct-section" id="brand-profile">
        <div className="f9-acct-section-head">
          <div>
            <span className="f9-acct-label">My brand</span>
            <h2>Set your own website once</h2>
          </div>
        </div>
        {brandProfileAction?.message ? (
          <div
            aria-live={brandProfileAction.ok ? "polite" : "assertive"}
            className={`f9-wk-notice ${brandProfileAction.ok ? "is-success" : "is-error"}`}
            role={brandProfileAction.ok ? "status" : "alert"}
          >
            <p>{brandProfileAction.message}</p>
          </div>
        ) : null}
        <Form className="f9-auth-form" method="post">
          <input name="intent" type="hidden" value="save-brand-profile" />
          <label className="f9-field">
            <span>My brand website</span>
            <input
              autoComplete="url"
              defaultValue={data.brandWebsite ?? ""}
              inputMode="url"
              name="brandWebsite"
              placeholder="https://yourbrand.com"
              spellCheck={false}
              type="text"
            />
          </label>
          <SubmitButton
            className="f9-acct-text-action"
            intent="save-brand-profile"
            pendingLabel="Saving…"
          >
            Save my brand
          </SubmitButton>
          <p className="f9-acct-copy">
            Optional. Set it once; competitor search stays separate.
          </p>
        </Form>
      </section>

      <section className="f9-acct-section">
        <div className="f9-acct-section-head">
          <div>
            <span className="f9-acct-label">Agency reports</span>
            <h2>Put your agency name on shared reports</h2>
          </div>
        </div>
        <ActionFeedback
          data={
            reportBrandingAction
              ? {
                  ok: reportBrandingAction.ok,
                  intent: reportBrandingAction.intent,
                  message: reportBrandingAction.message ?? undefined,
                }
              : null
          }
          intent="save-report-branding"
        />
        {data.plan === "agency" ? (
          <AccountBrandingForm
            brandLogo={data.brandLogo}
            brandLogoInvalid={reportBrandLogoInvalid}
            brandName={data.brandName}
          />
        ) : (
          <div className="f9-acct-entitlement">
            <p>
              Branded reports are part of Agency. Add your name and logo to client-facing
              reports without changing the evidence underneath.
            </p>
            <Link className="f9-wk-btn" prefetch="intent" to="/app/billing?source=branding#plans">
              See Agency plans
            </Link>
          </div>
        )}
      </section>

      <section className="f9-acct-section">
        <div className="f9-acct-section-head">
          <div>
            <span className="f9-acct-label">Security</span>
            <h2>Session and account controls</h2>
          </div>
        </div>
        {sessionAction?.message ? (
          <div
            aria-live={sessionAction.ok ? "polite" : "assertive"}
            className={`f9-wk-notice ${sessionAction.ok ? "is-success" : "is-error"}`}
            role={sessionAction.ok ? "status" : "alert"}
          >
            <p>{sessionAction.message}</p>
          </div>
        ) : null}
        <p className="f9-acct-copy">
          This device is signed in until <LocalTime iso={data.sessionExpiresAt} />. Sign out from the navigation
          menu to remove access on this device.
        </p>
        {data.sessionControlsMessage ? (
          <p aria-live="assertive" className="f9-wk-notice is-error" role="alert">
            {data.sessionControlsMessage}
          </p>
        ) : null}
        {data.activeSessions.length > 0 ? (
          <div className="f9-passkey-list">
            {data.activeSessions.map((session) => (
              <div className="f9-passkey-row" key={session.id}>
                <div>
                  <strong>{session.isCurrent ? "This device" : formatSessionDevice(session.userAgent)}</strong>
                  <span>
                    Last active <LocalTime iso={session.updatedAt} /> · Expires{" "}
                    <LocalTime iso={session.expiresAt} />
                  </span>
                  <span>{formatSessionLocation(session.ipAddress, session.userAgent)}</span>
                </div>
                {session.isCurrent ? (
                  <span className="f9-acct-current">Current</span>
                ) : (
                  <Form method="post">
                    <input name="intent" type="hidden" value="revoke-session" />
                    <input name="sessionId" type="hidden" value={session.id} />
                    <ConfirmSubmitButton
                      className="f9-acct-text-action"
                      confirmLabel="Confirm — revoke?"
                      intent="revoke-session"
                      match={{ sessionId: session.id }}
                      pendingLabel="Revoking…"
                      variant="light"
                    >
                      Revoke
                    </ConfirmSubmitButton>
                  </Form>
                )}
              </div>
            ))}
          </div>
        ) : null}
        <div className="f9-account-security-actions">
          <Form method="post">
            <input name="intent" type="hidden" value="revoke-other-sessions" />
            <ConfirmSubmitButton
              className="f9-acct-text-action"
              confirmLabel="Confirm — revoke all others?"
              disabled={otherSessionCount === 0}
              intent="revoke-other-sessions"
              pendingLabel="Revoking…"
              variant="light"
            >
              Revoke other sessions
            </ConfirmSubmitButton>
          </Form>
        </div>

        <div className="f9-acct-section-head f9-acct-subsection" id="email">
          <div>
            <span className="f9-acct-label">Email</span>
            <h3>Change your email</h3>
          </div>
        </div>
        <p className="f9-acct-copy">
          We email the NEW address a one-time confirm link. After you click it, the address
          swaps, the old address gets a heads-up, and your other sessions are revoked. Passkeys
          stay bound to your account.
        </p>
        {data.pendingEmailChange ? (
          <div aria-live="polite" className="f9-wk-notice is-success" role="status">
            <p>
              Verification link sent to <strong>{data.pendingEmailChange.newEmail}</strong>.
              Click it within an hour; after that, request a fresh link.
            </p>
          </div>
        ) : null}
        {emailChangeNotice === "confirmed" ? (
          <div aria-live="polite" className="f9-wk-notice is-success" role="status">
            <p>
              Your email changed. Other sessions on this account were signed out; sign back in with
              the new address.
            </p>
          </div>
        ) : null}
        {emailChangeNotice === "expired" ? (
          <div aria-live="assertive" className="f9-wk-notice is-error" role="alert">
            <p>That link expired. Submit the form again to get a fresh verification link.</p>
          </div>
        ) : null}
        {emailChangeNotice === "already" ? (
          <div aria-live="assertive" className="f9-wk-notice is-error" role="alert">
            <p>That link was already used. Submit the form again if you still need to change your email.</p>
          </div>
        ) : null}
        {emailChangeAction?.message ? (
          <div
            aria-live={emailChangeAction.ok ? "polite" : "assertive"}
            className={`f9-wk-notice ${emailChangeAction.ok ? "is-success" : "is-error"}`}
            role={emailChangeAction.ok ? "status" : "alert"}
          >
            <p>{emailChangeAction.message}</p>
          </div>
        ) : null}
        <Form action="/api/account/email-change-request" method="post" className="f9-auth-form">
          <label className="f9-field">
            <span>New email address</span>
            <input
              autoComplete="email"
              inputMode="email"
              name="newEmail"
              placeholder="you@newdomain.com"
              required
              type="email"
            />
          </label>
          <label className="f9-checkbox-row">
            <input name="confirmEmailChange" required type="checkbox" value="yes" />
            <span>
              I confirm the new address is mine and want the swap to happen once I click the link
              in the verification email.
            </span>
          </label>
          <SubmitButton
            className="f9-acct-text-action"
            pendingLabel="Sending verification link…"
          >
            Send verification link
          </SubmitButton>
        </Form>
      </section>

      <section className="f9-acct-section f9-acct-danger">
        <div className="f9-acct-section-head">
          <div>
            <span className="f9-wk-kick">Danger zone</span>
            <h2>Delete your account</h2>
          </div>
        </div>
        {data.pendingDeletion ? (
          <>
            <div aria-live="polite" className="f9-wk-notice" role="status">
              <p>
                Deletion is scheduled for <strong><LocalTime iso={data.pendingDeletion.scheduledFor} mode="datetime" /></strong>.
                You have 7 days from your request to cancel — the email we sent also has a
                cancel-deletion link. After that, your watchlists, evidence, and account are
                permanently removed.
              </p>
            </div>
            <p className="f9-wk-dim">
              Confirmation was sent to <strong>{data.pendingDeletion.emailAtRequest}</strong>.
              Click the link in that email if you have not yet — without it, this request stays
              pending and nothing is deleted.
            </p>
          </>
        ) : null}
        {deletionNotice === "pending" ? (
          <div aria-live="polite" className="f9-wk-notice is-success" role="status">
            <p>
              Deletion scheduled. You'll see the timer here; the link we emailed also has the
              cancel button if you change your mind.
            </p>
          </div>
        ) : null}
        {deletionNotice === "cancelled" || deletionNotice === "cancel-already" ? (
          <div aria-live="polite" className="f9-wk-notice is-success" role="status">
            <p>Deletion cancelled. Your account, watchlists, and evidence are unchanged.</p>
          </div>
        ) : null}
        {deletionNotice === "completed" ? (
          <div aria-live="polite" className="f9-wk-notice" role="status">
            <p>Deletion completed.</p>
          </div>
        ) : null}
        {deletionAction?.message ? (
          <div
            aria-live={deletionAction.ok ? "polite" : "assertive"}
            className={`f9-wk-notice ${deletionAction.ok ? "is-success" : "is-error"}`}
            role={deletionAction.ok ? "status" : "alert"}
          >
            <p>{deletionAction.message}</p>
          </div>
        ) : null}
        {!data.pendingDeletion ? (
          <>
            <p>
              Schedule deletion in-app. We email a one-time confirm link; you have 7 days to
              cancel from this page or the email link. After that, your user row, sessions,
              passkeys, watchlists, collections, digests, API keys, and org membership are
              permanently removed.
            </p>
            <Form action="/api/account/delete-request" method="post" className="f9-auth-form">
              <label className="f9-field">
                <span>Confirm your password</span>
                <input
                  autoComplete="current-password"
                  name="password"
                  placeholder="Your current sign-in password"
                  required
                  type="password"
                />
              </label>
              <label className="f9-checkbox-row">
                <input name="confirmDeletion" required type="checkbox" value="yes" />
                <span>
                  I understand this schedules permanent deletion after a 7-day grace window. I
                  can cancel during the grace from this page or the link in the email.
                </span>
              </label>
              <SubmitButton
                className="f9-acct-danger-action"
                pendingLabel="Sending confirmation link…"
              >
                Send confirmation link
              </SubmitButton>
            </Form>
          </>
        ) : (
          <Form method="post">
            <input name="intent" type="hidden" value="dismiss-deletion" />
            <SubmitButton
              className="f9-acct-text-action"
              pendingLabel="Refreshing…"
            >
              Refresh
            </SubmitButton>
          </Form>
        )}
      </section>
    </DashboardPage>
  );
}

async function registerPasskey(input: {
  setError: (message: string | null) => void;
  setMessage: (message: string | null) => void;
  setPending: (pending: boolean) => void;
  revalidate: () => void;
}) {
  input.setError(null);
  input.setMessage(null);
  input.setPending(true);
  try {
    const { authClient } = await import("~/lib/auth-client");
    const result = await authClient.passkey.addPasskey({
      name: "Five to Nine passkey",
    });
    if (result.error) {
      throw new Error(result.error.message || "passkey_failed");
    }

    input.setMessage("Passkey added.");
    input.setPending(false);
    // Re-run the loader to pull in the new passkey instead of a full reload.
    input.revalidate();
  } catch (error) {
    if (error instanceof Error && error.name === "InvalidStateError") {
      input.setError("This passkey is already attached to your account.");
    } else if (error instanceof Error && error.name === "NotAllowedError") {
      input.setError("Passkey setup was cancelled.");
    } else {
      input.setError("We couldn't add that passkey. Try again, or use email sign-in.");
    }
    input.setPending(false);
  }
}

async function removePasskey(input: {
  id: string;
  setConfirmId: (id: string | null) => void;
  setError: (message: string | null) => void;
  setMessage: (message: string | null) => void;
  setPendingId: (id: string | null) => void;
  revalidate: () => void;
}) {
  input.setError(null);
  input.setMessage(null);
  input.setPendingId(input.id);
  try {
    const { authClient } = await import("~/lib/auth-client");
    const id = input.id;
    const result = await authClient.passkey.deletePasskey({ id });
    if (result.error) {
      throw new Error(result.error.message || "passkey_delete_failed");
    }

    input.setPendingId(null);
    input.setConfirmId(null);
    input.setMessage("Passkey removed.");
    // Re-run the loader to drop the removed passkey instead of a full reload.
    input.revalidate();
  } catch {
    input.setPendingId(null);
    input.setError("We couldn't remove that passkey. Try again, or use email sign-in.");
  }
}

function formatSessionDevice(userAgent: string | null) {
  if (!userAgent) {
    return "Active session";
  }
  if (userAgent.includes("Firefox")) {
    return "Firefox session";
  }
  if (userAgent.includes("Edg/")) {
    return "Edge session";
  }
  if (userAgent.includes("Chrome")) {
    return "Chrome session";
  }
  if (userAgent.includes("Safari")) {
    return "Safari session";
  }
  return "Active session";
}

function formatSessionLocation(ipAddress: string | null, userAgent: string | null) {
  const parts = [
    ipAddress ? `IP ${ipAddress}` : null,
    userAgent ? summarizeUserAgent(userAgent) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "Session details unavailable";
}

function summarizeUserAgent(userAgent: string) {
  if (userAgent.includes("Mac OS X")) {
    return "macOS browser";
  }
  if (userAgent.includes("Windows")) {
    return "Windows browser";
  }
  if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
    return "iOS browser";
  }
  if (userAgent.includes("Android")) {
    return "Android browser";
  }
  return "Browser session";
}
