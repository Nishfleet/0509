import type { ReactNode } from "react";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { SubmitButton } from "~/components/submit-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { WorkingHeader } from "~/components/workspace/working-header";
import type { NullableString, RouteActionData } from "~/routes/workspace-settings.shared";

export const notificationsMeta: MetaFunction = () => [
  { title: "Notifications | Five to Nine" },
  {
    name: "description",
    content: "Manage email digest delivery and alert channels for Five to Nine.",
  },
];

export type NotificationsLoaderData = {
  emailDeliveryReady: boolean;
  digestCadencePreference: "plan_default" | "weekly_only";
};

/**
 * BL-039 — Notifications in the landing language.
 *
 * Delivery is a set of definitions, not a dashboard. The first ruled row
 * begins in the signed-in SaaS band established by BL-030/31, and the only
 * deeper objects are working form rows. Loader/action behavior is deliberately
 * kept in app.notifications.ts and remains byte-frozen.
 */
export function NotificationsRoute() {
  const data = useLoaderData<NotificationsLoaderData>();
  const actionData = useActionData<RouteActionData>();

  return (
    <DashboardPage className="f9-wk-page f9-notif-page">
      <WorkingHeader
        context="Briefs and confirmed competitor changes reach your team by email."
        title="Notifications"
      />

      {actionData?.message ? (
        <FeedbackStrip
          label={actionData.ok ? "Saved" : "Not saved"}
          tone={actionData.ok ? "ok" : "bad"}
        >
          {actionData.message}
        </FeedbackStrip>
      ) : null}

      <section aria-labelledby="notification-channels-title" className="f9-notif-section is-first">
        <SectionHeading
          id="notification-channels-title"
          title="Delivery channel"
        />
        <dl className="f9-notif-definitions" data-testid="notification-channel-rows">
          <ChannelRow
            copy={
              data.emailDeliveryReady
                ? "Briefs go to the account email."
                : "Add an account email first."
            }
            name="Email"
            status={data.emailDeliveryReady ? "Ready" : "Needs email"}
          />
        </dl>
      </section>

      <section aria-labelledby="email-delivery-title" className="f9-notif-section">
        <SectionHeading
          context="Each workspace keeps one frequency; quiet hours stay with the competitor they protect."
          id="email-delivery-title"
          title="Email delivery"
        />
        <div className="f9-notif-working-rows">
          <div className="f9-notif-work-row">
            <WorkRowCopy
              name="Digest frequency"
              say="Use the plan cadence, or keep every workspace brief weekly."
            />
            <Form className="f9-notif-inline-form" method="post">
              <input name="intent" type="hidden" value="save-digest-cadence" />
              <label className="f9-notif-field">
                <span className="f9-notif-label">Frequency</span>
                <select
                  className="f9-notif-select"
                  defaultValue={data.digestCadencePreference ?? "plan_default"}
                  name="digestCadencePreference"
                >
                  <option value="plan_default">
                    Plan default (daily when your plan includes it)
                  </option>
                  <option value="weekly_only">Weekly only</option>
                </select>
              </label>
              <SubmitButton
                className="f9-wk-lnk f9-notif-submit"
                intent="save-digest-cadence"
                pendingLabel="Saving…"
              >
                Save frequency
              </SubmitButton>
            </Form>
          </div>
          <div className="f9-notif-work-row">
            <WorkRowCopy
              name="Quiet hours"
              say="Instant alerts wait during each competitor’s quiet hours. Digests keep their scheduled cadence."
            />
            <Link className="f9-wk-lnk" to="/app/watchlists">
              Tune on competitors <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
          <div className="f9-notif-work-row">
            <WorkRowCopy
              name="Recipients"
              say={
                data.emailDeliveryReady
                  ? "Briefs go to the account email. Per-competitor recipients live with each competitor's delivery settings."
                  : "No account email is ready, so email delivery cannot start yet."
              }
            />
            <Link className="f9-wk-lnk" to="/app/account">
              Open account <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
          <div className="f9-notif-work-row">
            <WorkRowCopy
              name="Delivery history"
              say="Briefs keep the sent, pending, and all-quiet delivery trail."
            />
            <Link className="f9-wk-lnk" to="/app/digests">
              Open briefs <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
        </div>
      </section>


      <div className="f9-wk-opline">
        <span>Delivery channel: email</span>
      </div>
    </DashboardPage>
  );
}

function SectionHeading({
  id,
  title,
  context,
}: {
  id: string;
  title: string;
  context?: string;
}) {
  return (
    <div className="f9-notif-section-head">
      <div>
        <h2 className="f9-notif-section-title" id={id}>
          {title}
        </h2>
        {context ? <p className="f9-notif-section-context">{context}</p> : null}
      </div>
    </div>
  );
}

function ChannelRow({
  name,
  status,
  copy,
}: {
  name: string;
  status: ReactNode;
  copy: ReactNode;
}) {
  return (
    <div className="f9-notif-definition-row">
      <dt>{name}</dt>
      <dd className="f9-notif-definition-status">{status}</dd>
      <dd className="f9-notif-definition-copy">{copy}</dd>
    </div>
  );
}

function WorkRowCopy({ name, say }: { name: string; say: ReactNode }) {
  return (
    <div className="f9-notif-work-copy">
      <h3>{name}</h3>
      <p>{say}</p>
    </div>
  );
}











