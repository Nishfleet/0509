import { Form, Link } from "react-router";

import { ActionFeedback } from "~/components/action-feedback";
import { AccountBrandingForm } from "~/components/account-branding-form";
import { SubmitButton } from "~/components/submit-button";

type BrandingAction = {
  ok: boolean;
  message?: string | null;
  intent: string;
};

export function AccountBrandingSection({
  brandLogo,
  brandLogoInvalid,
  brandName,
  brandProfileAction,
  brandWebsite,
  plan,
  reportBrandingAction,
}: {
  brandLogo: string | null;
  brandLogoInvalid: boolean;
  brandName: string | null;
  brandProfileAction: BrandingAction | null;
  brandWebsite: string | null;
  plan: string;
  reportBrandingAction: BrandingAction | null;
}) {
  return (
    <>
      <article className="f9-wk-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-wk-kick">My brand</span>
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
              defaultValue={brandWebsite ?? ""}
              inputMode="url"
              name="brandWebsite"
              placeholder="https://yourbrand.com"
              spellCheck={false}
              type="text"
            />
          </label>
          <SubmitButton
            className="f9-wk-btn-quiet"
            intent="save-brand-profile"
            pendingLabel="Saving…"
          >
            Save my brand
          </SubmitButton>
          <p className="f9-wk-dim">Optional. Set it once; competitor search stays separate.</p>
        </Form>
      </article>

      <article className="f9-wk-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-wk-kick">Agency reports</span>
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
        {plan === "agency" ? (
          <AccountBrandingForm
            brandLogo={brandLogo}
            brandLogoInvalid={brandLogoInvalid}
            brandName={brandName}
          />
        ) : (
          <p className="f9-wk-dim">
            Branded reports are part of Agency.{" "}
            <Link prefetch="intent" to="/app/billing?source=branding#plans">
              See plans
            </Link>
          </p>
        )}
      </article>
    </>
  );
}
