import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { SubmitButton } from "~/components/submit-button";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const meta = () => [{ title: "Account | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { getWorkspaceBranding } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);

  const plan = await getUserPlan(env, session.user.id);
  const branding =
    plan === "agency" ? await getWorkspaceBranding(env, session.user.id) : { brandName: null };

  return {
    email: session.user.email,
    name: session.user.name,
    currentSessionId: session.session.id,
    sessionExpiresAt: session.session.expiresAt,
    plan,
    brandName: branding.brandName,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { upsertWorkspaceBranding } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save-report-branding") {
    const plan = await getUserPlan(env, session.user.id);
    if (plan !== "agency") {
      return {
        ok: false,
        error: "plan_gated" as const,
        message: "Branded reports are part of Agency.",
      };
    }

    const result = await upsertWorkspaceBranding(env, session.user.id, {
      brandName: String(formData.get("brandName") ?? ""),
    });

    return {
      ok: true,
      message: result.brandName
        ? `Saved. Shared reports now open with "Prepared by ${result.brandName}".`
        : "Branding cleared. Shared reports show Five to Nine only.",
    };
  }

  return { ok: false, message: "Unknown account action." };
}

export default function AccountRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <section className="f9-app-stack">
      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Account</span>
            <h2>Signed in as {data.email}</h2>
          </div>
        </div>

        <p className="f9-muted-copy">
          Sign-in is handled by Stytch B2B. Five to Nine currently supports secure email links for
          workspace access, while workspace data stays in Five to Nine.
        </p>
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Report branding</span>
            <h2>Put your agency name on shared reports</h2>
          </div>
        </div>
        {actionData?.message ? (
          <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
            <p>{actionData.message}</p>
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
          Current Stytch session: {data.currentSessionId}. The session expires at{" "}
          {data.sessionExpiresAt}. Sign out from the app header to revoke this device.
        </p>
        <p className="f9-muted-copy">
          To change your account email, remove a user, or delete a workspace, email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>. We keep this operator-assisted until the
          Stytch admin portal is enabled for customers.
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
