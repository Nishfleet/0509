import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { ActionFeedback } from "~/components/action-feedback";
import { AccountBrandingForm } from "~/components/account-branding-form";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { EmptyState } from "~/components/empty-state";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
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
  const { isE2ETestSessionId } = await import("~/lib/e2e-auth.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const isE2EFixtureSession = isE2ETestSessionId(session.session.id);

  const plan = await getUserPlan(env, session.user.id);
  const reportBrandIdentity = await resolveWorkspaceBrandIdentity(env, session.user.id);
  const branding = await getWorkspaceBranding(env, session.user.id);
  const passkeysEnabled = !isE2EFixtureSession && isBetterAuthPasskeyEnabled(env);
  let passkeys: Awaited<ReturnType<typeof listBetterAuthPasskeys>> = [];
  let passkeyControlsMessage: string | null = null;
  if (passkeysEnabled) {
    try {
      passkeys = await listBetterAuthPasskeys(env, request);
    } catch (error) {
      console.warn("[account] passkey controls unavailable", error);
      passkeyControlsMessage = "Sign in again to manage passkeys.";
    }
  }
  let activeSessions: Awaited<ReturnType<typeof listBetterAuthSessions>> = [];
  let sessionControlsMessage: string | null = isE2EFixtureSession
    ? "Sign in with email to manage active sessions."
    : null;
  if (!isE2EFixtureSession) {
    try {
      activeSessions = await listBetterAuthSessions(env, request, session.session.id);
    } catch (error) {
      console.warn("[account] session controls unavailable", error);
      sessionControlsMessage = "Sign in again to manage active sessions.";
    }
  }

  // Default to verified on a transient DB error so the banner never nags a
  // verified user; the retention gates re-check on every action anyway.
  let emailVerified = true;
  try {
    const { isUserEmailVerified } = await import("~/lib/email-verification.server");
    emailVerified = await isUserEmailVerified(env, session.user.id);
  } catch (error) {
    console.warn("[account] email verification status unavailable", error);
  }

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
  const { isE2ETestSessionId } = await import("~/lib/e2e-auth.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const isE2EFixtureSession = isE2ETestSessionId(session.session.id);

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
      message: removeBrandLogo
        ? "Logo removed. Shared reports still use your saved agency name when present."
        : brandingInput.brandLogo
          ? "Agency name and logo saved for shared reports."
          : result.brandName
            ? `Saved. Shared reports now open with "Prepared by ${result.brandName}".`
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
        message: "Confirm that you understand deletion is permanent before sending the request.",
      };
    }

    const { assertAccountDeletable } = await import("~/lib/auth.server");
    const { createSupportCase, getUserPlanBillingInfo } = await import("~/lib/data.server");
    const billing = await getUserPlanBillingInfo(env, session.user.id);
    try {
      assertAccountDeletable(billing);
    } catch (error) {
      return {
        ok: false,
        intent,
        message: error instanceof Error
          ? error.message
          : "Cancel your subscription before requesting account deletion.",
      };
    }

    const supportCase = await createSupportCase(env, {
      userId: session.user.id,
      category: "security",
      priority: "urgent",
      subject: "Delete my Five to Nine account",
      detail: [
        "Signed-in account deletion request.",
        `Account email: ${session.user.email}`,
        `Account user ID: ${session.user.id}`,
        "Support must verify by email before deleting account data.",
      ].join("\n"),
      context: {
        createdFrom: "signed_in_account_deletion_request",
        source: "app.account",
      },
      reopenClosed: true,
      requestKey: `account-deletion:${session.user.id}`,
    });

    if (!supportCase) {
      return { ok: false, intent, message: "Could not open the deletion request. Email support and we will handle it." };
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
        message: `Deletion request opened as case ${supportCase.id}. Support notification failed, so email ${SUPPORT_EMAIL} if you need it handled urgently.`,
      };
    }

    return {
      ok: true,
      intent,
      message: supportCase.alreadyExists
        ? `Deletion request is already open as case ${supportCase.id}.`
        : `Deletion request opened as case ${supportCase.id}. We will verify by email before anything is deleted.`,
    };
  }

  return { ok: false, intent, message: "Unknown account action." };
}

export default function AccountRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
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
  const resendVerificationAction =
    actionData?.intent === "resend-verification" ? actionData : null;
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const otherSessionCount = data.activeSessions.filter((session) => !session.isCurrent).length;

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          lead="Signed-in profile, brand setup, passkeys, and sensitive account requests."
          title="Account & security"
        />

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <h2>{data.name || data.email}</h2>
          </div>
        </div>

        <p className="f9-muted-copy">
          Signed in as {data.email}. Sign-in security is managed on this page — use it for brand setup,
          sign-in options, and sensitive account requests.
        </p>
      </article>

      {!data.emailVerified ? (
        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Email</span>
              <h2>Verify your email</h2>
            </div>
            <Form method="post">
              <input name="intent" type="hidden" value="resend-verification" />
              <SubmitButton className="f9-secondary-button" intent="resend-verification" pendingLabel="Sending…">
                Resend verification email
              </SubmitButton>
            </Form>
          </div>
          <p className="f9-muted-copy">
            {resendVerificationAction?.message ??
              `Watchlists, digests, and alerts stay locked until ${data.email} is verified.`}
          </p>
        </article>
      ) : null}

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Setup</span>
            <h2>Resume account setup</h2>
          </div>
          <Link className="f9-secondary-button" to="/app/onboard?resume=1">
            Resume setup
          </Link>
        </div>
        <p className="f9-muted-copy">
          Add another competitor watch or update your own brand website without resetting the account.
        </p>
      </article>

      {data.passkeysEnabled ? (
        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Passkeys</span>
              <h2>Use this device to sign in faster</h2>
            </div>
          </div>
          {passkeyMessage ? <p className="f9-message is-success">{passkeyMessage}</p> : null}
          {passkeyError ? <p className="f9-message is-error">{passkeyError}</p> : null}
          {data.passkeyControlsMessage ? (
            <p className="f9-muted-copy">{data.passkeyControlsMessage}</p>
          ) : (
            <>
              <div className="f9-account-security-actions">
                <button
                  className="f9-secondary-button"
                  disabled={passkeyPending}
                  onClick={() => {
                    void registerPasskey({
                      setError: setPasskeyError,
                      setMessage: setPasskeyMessage,
                      setPending: setPasskeyPending,
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
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No passkeys are attached to this account yet." variant="inline" />
              )}
            </>
          )}
        </article>
      ) : null}

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">My brand</span>
            <h2>Set your own website once</h2>
          </div>
        </div>
        {brandProfileAction?.message ? (
          <div className={`f9-message ${brandProfileAction.ok ? "is-success" : "is-error"}`}>
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
            className="f9-secondary-button"
            intent="save-brand-profile"
            pendingLabel="Saving…"
          >
            Save my brand
          </SubmitButton>
          <p className="f9-muted-copy">
            Optional. Set it once; competitor search stays separate.
          </p>
        </Form>
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Agency reports</span>
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
          <p className="f9-muted-copy">
            Branded reports are part of Agency.{" "}
            <Link prefetch="intent" to="/app/billing?source=branding#plans">
              See plans
            </Link>
          </p>
        )}
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Security</span>
            <h2>Session and account controls</h2>
          </div>
        </div>
        {sessionAction?.message ? (
          <div className={`f9-message ${sessionAction.ok ? "is-success" : "is-error"}`}>
            <p>{sessionAction.message}</p>
          </div>
        ) : null}
        <p className="f9-muted-copy">
          This device is signed in until <LocalTime iso={data.sessionExpiresAt} />. Sign out from the navigation
          menu to remove access on this device.
        </p>
        {data.sessionControlsMessage ? (
          <p className="f9-message is-error">{data.sessionControlsMessage}</p>
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
                  <span className="f9-status-pill is-healthy">Current</span>
                ) : (
                  <Form method="post">
                    <input name="intent" type="hidden" value="revoke-session" />
                    <input name="sessionId" type="hidden" value={session.id} />
                    <ConfirmSubmitButton
                      className="f9-secondary-button"
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
              className="f9-secondary-button"
              confirmLabel="Confirm — revoke all others?"
              disabled={otherSessionCount === 0}
              intent="revoke-other-sessions"
              pendingLabel="Revoking…"
              variant="light"
            >
              Revoke other sessions
            </ConfirmSubmitButton>
          </Form>
          <a className="f9-secondary-button" href={SUPPORT_MAILTO}>
            Change email
          </a>
        </div>
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Danger zone</span>
            <h2>Delete this account</h2>
          </div>
        </div>
        {deletionAction?.message ? (
          <div className={`f9-message ${deletionAction.ok ? "is-success" : "is-error"}`}>
            <p>{deletionAction.message}</p>
          </div>
        ) : null}
        <p>
          Permanently removes your account, watchlists, history, and evidence. We email a
          confirmation first; nothing is deleted until the request is verified. Deletion is blocked
          while a subscription is active - cancel first from{" "}
          <Link prefetch="intent" to="/app/billing">
            Plan &amp; billing
          </Link>{" "}
          (you keep access until the end of the period you've paid for), or email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we'll handle both.
        </p>
        <Form className="f9-auth-form" method="post">
          <input name="intent" type="hidden" value="request-account-deletion" />
          <label className="f9-checkbox-row">
            <input name="confirmDeletion" required type="checkbox" value="yes" />
            <span>I understand deletion is permanent and support will verify by email first.</span>
          </label>
          <SubmitButton
            className="f9-secondary-button"
            intent="request-account-deletion"
            pendingLabel="Opening request…"
          >
            Request account deletion
          </SubmitButton>
        </Form>
      </article>
      </section>
    </DashboardPage>
  );
}

async function registerPasskey(input: {
  setError: (message: string | null) => void;
  setMessage: (message: string | null) => void;
  setPending: (pending: boolean) => void;
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
    window.setTimeout(() => window.location.reload(), 400);
  } catch (error) {
    if (error instanceof Error && error.name === "InvalidStateError") {
      input.setError("This passkey is already attached to your account.");
    } else if (error instanceof Error && error.name === "NotAllowedError") {
      input.setError("Passkey setup was cancelled.");
    } else {
      input.setError("That passkey could not be added. Try again or use email sign-in.");
    }
    input.setPending(false);
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
        "Action: verify by email before deleting account data",
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
