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
import type { AppEnv } from "~/lib/env.server";

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

  if (intent === "request-account-deletion") {
    if (isE2EFixtureSession) {
      return { ok: false, intent, message: "Sign in with email to request account deletion." };
    }

    if (String(formData.get("confirmDeletion") ?? "") !== "yes") {
      return {
        ok: false,
        intent,
        message: "Confirm that this sends a support deletion request and does not delete anything automatically or in-app.",
      };
    }

    const { createSupportCase } = await import("~/lib/data.server");

    const supportCase = await createSupportCase(env, {
      userId: session.user.id,
      category: "security",
      priority: "urgent",
      subject: "Delete my Five to Nine account",
      detail: [
        "Signed-in support deletion request.",
        `Account email: ${session.user.email}`,
        `Account user ID: ${session.user.id}`,
        "Nothing is deleted automatically or in-app. Support reviews and verifies the request, then communicates the feasible process.",
      ].join("\n"),
      context: {
        createdFrom: "signed_in_account_deletion_request",
        source: "app.account",
      },
      reopenClosed: true,
      requestKey: `account-deletion:${session.user.id}`,
    });

    if (!supportCase) {
      return { ok: false, intent, message: "We couldn't open the support deletion request. Email support and we'll take care of it." };
    }

    const notificationResult = await notifyAccountDeletionOperator(env, {
      caseId: supportCase.id,
      dedupeKey: isReopenedSupportCase(supportCase)
        ? `support-case-reopen:${supportCase.id}:${supportCase.updatedAt}`
        : `support-case:${supportCase.id}`,
      requesterEmail: session.user.email,
      userId: session.user.id,
    });
    if (notificationResult === "failed") {
      return {
        ok: true,
        intent,
        message: `Support deletion request opened as case ${supportCase.id}. Support notification failed, so email ${SUPPORT_EMAIL} if you need it handled urgently. Nothing is deleted automatically or in-app.`,
      };
    }

    return {
      ok: true,
      intent,
      message: supportCase.alreadyExists
        ? `Support deletion request is already open as case ${supportCase.id}. Support will review and verify it, then communicate the feasible process.`
        : `Support deletion request opened as case ${supportCase.id}. Support will review and verify the request, then communicate the feasible process. Nothing is deleted automatically or in-app.`,
    };
  }

  if (intent === "request-email-change") {
    if (isE2EFixtureSession) {
      return { ok: false, intent, message: "Sign in with email to request an email change." };
    }

    const newEmail = String(formData.get("newEmail") ?? "").trim();
    const normalizedNewEmail = newEmail.toLowerCase();
    if (String(formData.get("confirmEmailChange") ?? "") !== "yes") {
      return {
        ok: false,
        intent,
        message: "Confirm that this opens a support request and that support completes the change.",
      };
    }
    if (!isPlausibleEmail(newEmail)) {
      return {
        ok: false,
        intent,
        message: "Enter the new email address you'd like on the account.",
      };
    }
    if (normalizedNewEmail === session.user.email.toLowerCase()) {
      return { ok: false, intent, message: "That's already the email on this account." };
    }

    const { createSupportCase } = await import("~/lib/data.server");

    const supportCase = await createSupportCase(env, {
      userId: session.user.id,
      category: "account",
      priority: "normal",
      subject: "Change my Five to Nine account email",
      detail: [
        "Signed-in support email-change request.",
        `Current account email: ${session.user.email}`,
        `Requested new email: ${newEmail}`,
        `Account user ID: ${session.user.id}`,
        "Support verifies ownership and completes the change; nothing changes automatically or in-app.",
      ].join("\n"),
      context: {
        createdFrom: "signed_in_account_email_change_request",
        source: "app.account",
        requestedNewEmail: newEmail,
      },
      reopenClosed: true,
      requestKey: `account-email-change:${session.user.id}:${normalizedNewEmail}`,
    });

    if (!supportCase) {
      return {
        ok: false,
        intent,
        message: "We couldn't open the email-change request. Email support and we'll take care of it.",
      };
    }

    const notificationResult = await notifyAccountEmailChangeOperator(env, {
      caseId: supportCase.id,
      dedupeKey: isReopenedSupportCase(supportCase)
        ? `support-case-reopen:${supportCase.id}:${supportCase.updatedAt}`
        : `support-case:${supportCase.id}`,
      requesterEmail: session.user.email,
      requestedEmail: newEmail,
      userId: session.user.id,
    });
    if (notificationResult === "failed") {
      return {
        ok: true,
        intent,
        message: `Email-change request opened as case ${supportCase.id}. Support notification failed, so email ${SUPPORT_EMAIL} if you need it handled quickly. Support completes the change; nothing changes automatically or in-app.`,
      };
    }

    return {
      ok: true,
      intent,
      message: supportCase.alreadyExists
        ? `Email-change request is already open as case ${supportCase.id}. Support will verify ownership and complete the change.`
        : `Email-change request opened as case ${supportCase.id}. Support will verify ownership and complete the change. Nothing changes automatically or in-app.`,
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

        <div className="f9-acct-section-head f9-acct-subsection">
          <div>
            <span className="f9-acct-label">Email</span>
            <h3>Change your email</h3>
          </div>
        </div>
        <p className="f9-acct-copy">
          Support completes email changes so we can verify it's really you. This opens a tracked
          support request — your email doesn't change automatically or in-app.
        </p>
        {emailChangeAction?.message ? (
          <div
            aria-live={emailChangeAction.ok ? "polite" : "assertive"}
            className={`f9-wk-notice ${emailChangeAction.ok ? "is-success" : "is-error"}`}
            role={emailChangeAction.ok ? "status" : "alert"}
          >
            <p>{emailChangeAction.message}</p>
          </div>
        ) : null}
        <Form className="f9-auth-form" method="post">
          <input name="intent" type="hidden" value="request-email-change" />
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
              I understand this opens a support request, and support verifies ownership and completes
              the change — it doesn't change automatically or in-app.
            </span>
          </label>
          <SubmitButton
            className="f9-acct-text-action"
            intent="request-email-change"
            pendingLabel="Sending request…"
          >
            Request email change
          </SubmitButton>
        </Form>
      </section>

      <section className="f9-acct-section f9-acct-danger">
        <div className="f9-acct-section-head">
          <div>
            <span className="f9-wk-kick">Danger zone</span>
            <h2>Request account deletion support</h2>
          </div>
        </div>
        {deletionAction?.message ? (
          <div
            aria-live={deletionAction.ok ? "polite" : "assertive"}
            className={`f9-wk-notice ${deletionAction.ok ? "is-success" : "is-error"}`}
            role={deletionAction.ok ? "status" : "alert"}
          >
            <p>{deletionAction.message}</p>
          </div>
        ) : null}
        <p>
          This sends a support deletion request. Nothing is deleted automatically or in-app.
          Support reviews and verifies the request, then communicates the feasible process and any
          timing. You can also email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you need help.
        </p>
        <Form className="f9-auth-form" method="post">
          <input name="intent" type="hidden" value="request-account-deletion" />
          <label className="f9-checkbox-row">
            <input name="confirmDeletion" required type="checkbox" value="yes" />
            <span>I understand this is a support request, not an in-app deletion, and support will review and verify it.</span>
          </label>
          <SubmitButton
            className="f9-acct-danger-action"
            intent="request-account-deletion"
            pendingLabel="Sending request…"
          >
            Send support deletion request
          </SubmitButton>
        </Form>
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

async function notifyAccountEmailChangeOperator(
  env: AppEnv,
  input: {
    caseId: string;
    dedupeKey: string;
    requesterEmail: string;
    requestedEmail: string;
    userId: string;
  },
): Promise<AccountDeletionOperatorNotificationResult> {
  const idempotencyKey = input.dedupeKey;
  const { createSupportCaseEvent, getDeliveryAttemptByIdempotencyKey } = await import("~/lib/data.server");
  try {
    const existingAttempt = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
    if (existingAttempt?.status === "sent") {
      return "already_sent";
    }

    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const notified = await sendOperatorAlertEmail(env, {
      subject: "0509 account email change request",
      lines: [
        `Case: ${input.caseId}`,
        `Requester (current email): ${input.requesterEmail}`,
        `Requested new email: ${input.requestedEmail}`,
        `User ID: ${input.userId}`,
        "Category: Account",
        "Action: support verifies ownership and completes the email change; nothing changes automatically or in-app",
      ],
      idempotencyKey,
    });

    await createSupportCaseEvent(env, {
      caseId: input.caseId,
      userId: input.userId,
      eventType: notified ? "support_notified" : "support_notification_failed",
      message: notified
        ? "Support was notified about the account email change request."
        : "Support notification failed for the account email change request.",
      visibleToCustomer: true,
      metadata: {
        delivery: notified ? "sent" : "failed",
      },
    });
    return notified ? "sent" : "failed";
  } catch (error) {
    console.error("[account] email change operator notification failed", error);
    try {
      await createSupportCaseEvent(env, {
        caseId: input.caseId,
        userId: input.userId,
        eventType: "support_notification_failed",
        message: "Support notification failed for the account email change request.",
        visibleToCustomer: true,
        metadata: {
          delivery: "failed",
        },
      });
    } catch (eventError) {
      console.error("[account] email change notification event failed", eventError);
    }
    return "failed";
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

type AccountDeletionOperatorNotificationResult = "sent" | "already_sent" | "failed";

function isReopenedSupportCase(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      "reopened" in value &&
      (value as { reopened?: unknown }).reopened === true,
  );
}

async function notifyAccountDeletionOperator(
  env: AppEnv,
  input: {
    caseId: string;
    dedupeKey: string;
    requesterEmail: string;
    userId: string;
  },
): Promise<AccountDeletionOperatorNotificationResult> {
  const idempotencyKey = input.dedupeKey;
  const { createSupportCaseEvent, getDeliveryAttemptByIdempotencyKey } = await import("~/lib/data.server");
  try {
    const existingAttempt = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
    if (existingAttempt?.status === "sent") {
      return "already_sent";
    }

    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    const notified = await sendOperatorAlertEmail(env, {
      subject: "0509 account deletion request",
      lines: [
        `Case: ${input.caseId}`,
        `Requester: ${input.requesterEmail}`,
        `User ID: ${input.userId}`,
        "Category: Security, privacy, or deletion",
        "Priority: Urgent",
        "Action: support reviews and verifies the request, then communicates the feasible process; nothing is deleted automatically or in-app",
      ],
      idempotencyKey,
    });

    await createSupportCaseEvent(env, {
      caseId: input.caseId,
      userId: input.userId,
      eventType: notified ? "support_notified" : "support_notification_failed",
      message: notified
        ? "Support was notified about the account deletion request."
        : "Support notification failed for the account deletion request.",
      visibleToCustomer: true,
      metadata: {
        delivery: notified ? "sent" : "failed",
      },
    });
    return notified ? "sent" : "failed";
  } catch (error) {
    console.error("[account] deletion operator notification failed", error);
    try {
      await createSupportCaseEvent(env, {
        caseId: input.caseId,
        userId: input.userId,
        eventType: "support_notification_failed",
        message: "Support notification failed for the account deletion request.",
        visibleToCustomer: true,
        metadata: {
          delivery: "failed",
        },
      });
    } catch (eventError) {
      console.error("[account] deletion notification event failed", eventError);
    }
    return "failed";
  }
}
