import type { ReactNode } from "react";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { LocalTime } from "~/components/local-time";
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

type DeliveryTargetView = {
  id: string;
  displayName: string;
  isPaused: boolean;
  lastSuccessfulDeliveryAt: NullableString;
  createdAt: string;
};

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
    <DashboardPage className="f9-wk-page f9-nt-page">
      <WorkingHeader
        context="Choose how briefs and confirmed competitor changes reach your team."
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

      <section aria-labelledby="notification-channels-title" className="f9-nt-section is-first">
        <SectionHeading
          id="notification-channels-title"
          title="Delivery channels"
        />
        <dl className="f9-nt-definitions" data-testid="notification-channel-rows">
          <ChannelRow
            copy={
              data.emailDeliveryReady
                ? "Digest delivery can use the account email."
                : "Add an account email first."
            }
            name="Email"
            status={data.emailDeliveryReady ? "Ready" : "Needs email"}
          />
        </dl>
      </section>

      <section aria-labelledby="email-delivery-title" className="f9-nt-section">
        <SectionHeading
          context="Email is generally available. Each workspace keeps one frequency, while quiet hours stay with the competitor they protect."
          id="email-delivery-title"
          title="Email delivery"
        />
        <div className="f9-nt-working-rows">
          <div className="f9-nt-work-row">
            <WorkRowCopy
              name="Digest frequency"
              say="Use the plan cadence, or keep every workspace brief weekly."
            />
            <Form className="f9-nt-inline-form" method="post">
              <input name="intent" type="hidden" value="save-digest-cadence" />
              <label className="f9-nt-field">
                <span className="f9-nt-label">Frequency</span>
                <select
                  className="f9-nt-select"
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
                className="f9-wk-lnk f9-nt-submit"
                intent="save-digest-cadence"
                pendingLabel="Saving…"
              >
                Save frequency
              </SubmitButton>
            </Form>
          </div>
          <div className="f9-nt-work-row">
            <WorkRowCopy
              name="Quiet hours"
              say="Instant alerts wait during each competitor’s quiet hours. Digests keep their scheduled cadence."
            />
            <Link className="f9-wk-lnk" to="/app/watchlists">
              Tune on competitors <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
          <div className="f9-nt-work-row">
            <WorkRowCopy
              name="Recipients"
              say={
                data.emailDeliveryReady
                  ? "Briefs go to the account email. Channel-specific recipients appear below only when that channel is available."
                  : "No account email is ready, so email delivery cannot start yet."
              }
            />
            <Link className="f9-wk-lnk" to="/app/account">
              Open account <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
          <div className="f9-nt-work-row">
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
        <span>Email delivery generally available</span>
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
    <div className="f9-nt-section-head">
      <div>
        <h2 className="f9-nt-section-title" id={id}>
          {title}
        </h2>
        {context ? <p className="f9-nt-section-context">{context}</p> : null}
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
    <div className="f9-nt-definition-row">
      <dt>{name}</dt>
      <dd className="f9-nt-definition-status">{status}</dd>
      <dd className="f9-nt-definition-copy">{copy}</dd>
    </div>
  );
}

function WorkRowCopy({ name, say }: { name: string; say: ReactNode }) {
  return (
    <div className="f9-nt-work-copy">
      <h3>{name}</h3>
      <p>{say}</p>
    </div>
  );
}



function TargetList({
  title,
  emptyTitle,
  emptyCopy,
  children,
}: {
  title: string;
  emptyTitle: string;
  emptyCopy: string;
  children: ReactNode;
}) {
  const targets = Array.isArray(children) ? children : [children];
  const hasTargets = targets.some(Boolean);

  return (
    <div className="f9-nt-targets">
      <h3>{title}</h3>
      {hasTargets ? (
        children
      ) : (
        <div className="f9-nt-target-row">
          <div>
            <strong>{emptyTitle}</strong>
            <p>{emptyCopy}</p>
          </div>
        </div>
      )}
    </div>
  );
}








