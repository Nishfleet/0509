import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";

import { SubmitButton } from "~/components/submit-button";
import {
  hasInvalidCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
} from "~/lib/competitor-website";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const meta = () => [{ title: "Account | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { isBetterAuthPasskeyEnabled, listBetterAuthPasskeys } = await import(
    "~/lib/better-auth.server"
  );
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { getWorkspaceBranding } = await import("~/lib/data.server");
  const { resolveWorkspacePreparedBy } = await import("~/lib/plan-feature-gate.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);

  const plan = await getUserPlan(env, session.user.id);
  const brandName = await resolveWorkspacePreparedBy(env, session.user.id);
  const branding = await getWorkspaceBranding(env, session.user.id);
  const passkeysEnabled = isBetterAuthPasskeyEnabled(env);
  const passkeys = passkeysEnabled ? await listBetterAuthPasskeys(env, request) : [];

  return {
    email: session.user.email,
    name: session.user.name,
    sessionExpiresAt: session.session.expiresAt,
    plan,
    brandName,
    brandWebsite: branding.brandWebsite,
    passkeys,
    passkeysEnabled,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { upsertWorkspaceBranding } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

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

    const result = await upsertWorkspaceBranding(env, session.user.id, {
      brandName: String(formData.get("brandName") ?? ""),
    });

    return {
      ok: true,
      intent,
      message: result.brandName
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

  return { ok: false, intent, message: "Unknown account action." };
}

export default function AccountRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const brandProfileAction =
    actionData?.intent === "save-brand-profile" ? actionData : null;
  const reportBrandingAction =
    actionData?.intent === "save-report-branding" ? actionData : null;
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  return (
    <section className="f9-app-stack">
      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Account</span>
            <h2>{data.name || data.email}</h2>
          </div>
        </div>

        <p className="f9-muted-copy">
          Signed in as {data.email}. Sign-in is handled by Better Auth. Use this page for brand setup,
          sign-in options, and sensitive account requests.
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
                    <span>Created {formatAccountDate(passkey.createdAt)}</span>
                  </div>
                  <span>
                    {passkey.lastUsedAt ? `Last used ${formatAccountDate(passkey.lastUsedAt)}` : "Not used yet"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="f9-muted-copy">
              No passkeys are attached to this account yet.
            </p>
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
        {reportBrandingAction?.message ? (
          <div className={`f9-message ${reportBrandingAction.ok ? "is-success" : "is-error"}`}>
            <p>{reportBrandingAction.message}</p>
          </div>
        ) : null}
        {data.plan === "agency" ? (
          <Form className="f9-auth-form" method="post">
            <input name="intent" type="hidden" value="save-report-branding" />
            <label className="f9-field">
              <span>Brand name shown to clients</span>
              <input
                defaultValue={data.brandName ?? ""}
                maxLength={60}
                name="brandName"
                placeholder="Your agency name"
                type="text"
              />
            </label>
            <SubmitButton
              className="f9-secondary-button"
              intent="save-report-branding"
              pendingLabel="Saving…"
            >
              Save branding
            </SubmitButton>
            <p className="f9-muted-copy">
              Shared report links open with "Prepared by {data.brandName || "your brand"}". Five to
              Nine stays in the footer. Leave the field empty to clear it.
            </p>
          </Form>
        ) : (
          <p className="f9-muted-copy">
            Branded reports are part of Agency. <a href="/#pricing">See plans</a>
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
        <p className="f9-muted-copy">
          This device is signed in until {data.sessionExpiresAt}. Sign out from the sidebar to remove access on this
          device.
        </p>
        <p className="f9-muted-copy">
          To change your email, remove a teammate, or close the account, email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>. Support handles sensitive account changes
          until self-service controls are ready.
        </p>
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Danger zone</span>
            <h2>Delete this account</h2>
          </div>
        </div>
        <p>
          Permanently removes your account, watchlists, history, and evidence. We email a
          confirmation first; nothing is deleted until the request is verified. Deletion is blocked
          while a subscription is active - cancel first from{" "}
          <a href="/app/billing">Plan &amp; billing</a> (you keep access until the end of the
          period you've paid for), or email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and
          we'll handle both.
        </p>
        <a className="f9-secondary-button" href={SUPPORT_MAILTO}>
          Request account deletion
        </a>
      </article>
    </section>
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

function formatAccountDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
