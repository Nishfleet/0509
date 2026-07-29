import type { ReactNode } from "react";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { WorkingHeader } from "~/components/workspace/working-header";
import {
  isWhatsAppDeliveryCustomerFacing,
  slackDeliveryUnavailableMessage,
  whatsappDeliveryUnavailableMessage,
} from "~/lib/ga-customer-surface";
import type { PlanFamily } from "~/lib/plan-entitlements";
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

type WhatsAppTargetView = DeliveryTargetView & {
  validationStatus: string;
  templateEligible: boolean;
};

export type NotificationsLoaderData = {
  emailDeliveryReady: boolean;
  digestCadencePreference: "plan_default" | "weekly_only";
  showSlackDelivery: boolean;
  slackDelivery: {
    plan: PlanFamily;
    entitled: boolean;
  };
  canManageWhatsAppDelivery: boolean;
  slackTargets: DeliveryTargetView[];
  whatsappTargets: WhatsAppTargetView[];
  whatsappDelivery: {
    providerConfigured: boolean;
    customerReady: boolean;
    webhookConfigured: boolean;
    configuredTargets: number;
    usableTargets: number;
    lastSuccessfulDeliveryAt: NullableString;
  };
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
  const showWhatsAppDelivery = isWhatsAppDeliveryCustomerFacing();

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
          <ChannelRow
            copy={slackChannelCopy(data)}
            name="Slack"
            status={slackChannelStatus(data)}
          />
          <ChannelRow
            copy={whatsAppChannelCopy(data, showWhatsAppDelivery)}
            name="WhatsApp"
            status={whatsAppChannelStatus(data, showWhatsAppDelivery)}
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

      {data.showSlackDelivery ? <SlackDelivery data={data} /> : null}
      {showWhatsAppDelivery ? <WhatsAppDelivery data={data} /> : null}

      <div className="f9-wk-opline">
        <span>Email delivery generally available</span>
        <span>Slack and WhatsApp stay dormant until their customer-facing checks pass</span>
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

function SlackDelivery({ data }: { data: NotificationsLoaderData }) {
  return (
    <section aria-labelledby="slack-delivery-title" className="f9-nt-section">
      <SectionHeading
        context="Eligible digests and high-priority confirmed changes can post to an encrypted incoming webhook."
        id="slack-delivery-title"
        title="Slack delivery"
      />

      {!data.slackDelivery.entitled ? (
        <div className="f9-nt-lock" role="status">
          <div>
            <h3>Slack controls are locked on this plan</h3>
            <p>
              Slack delivery is included in Starter and Agency plans. Existing channel
              history stays visible below.
            </p>
          </div>
          <Link className="f9-wk-btn" to="/app/billing?source=notifications#plans">
            View plans
          </Link>
        </div>
      ) : (
        <Form className="f9-nt-connect-row" method="post">
          <input name="intent" type="hidden" value="save-slack-webhook" />
          <WorkRowCopy
            name="Connect channel"
            say="The webhook is encrypted and never shown again after saving."
          />
          <label className="f9-nt-field">
            <span className="f9-nt-label">Channel label</span>
            <input
              autoComplete="off"
              className="f9-nt-input"
              name="slackDestinationName"
              placeholder="Growth team, competitor alerts..."
              type="text"
            />
          </label>
          <label className="f9-nt-field">
            <span className="f9-nt-label">Slack webhook URL</span>
            <input
              autoComplete="off"
              className="f9-nt-input"
              name="slackWebhookUrl"
              placeholder="Paste the incoming webhook URL"
              type="password"
            />
          </label>
          <SubmitButton
            className="f9-wk-lnk f9-nt-submit"
            intent="save-slack-webhook"
            pendingLabel="Saving…"
          >
            Save Slack delivery
          </SubmitButton>
        </Form>
      )}

      <dl className="f9-nt-definitions is-compact">
        <ChannelRow
          copy="Weekly or daily digest summaries when the account plan allows digests."
          name="Digests"
          status="Included"
        />
        <ChannelRow
          copy="High-priority confirmed competitor changes outside quiet hours."
          name="Alerts"
          status="Confirmed only"
        />
        <ChannelRow
          copy="The webhook is encrypted and never shown again after saving."
          name="Secret"
          status="Encrypted"
        />
      </dl>

      <TargetList
        emptyCopy="Add a webhook when you want digests and important changes posted to Slack."
        emptyTitle="No Slack channel connected"
        title="Connected channels"
      >
        {data.slackTargets.map((target) => (
          <div className="f9-nt-target-row" key={target.id}>
            <div>
              <strong>{target.displayName}</strong>
              <p>
                {target.isPaused ? "Paused" : "Active"}
                {target.lastSuccessfulDeliveryAt ? (
                  <> · last sent <LocalTime iso={target.lastSuccessfulDeliveryAt} /></>
                ) : (
                  " · no sends yet"
                )}
              </p>
            </div>
            {data.slackDelivery.entitled ? (
              <Form method="post">
                <input
                  name="intent"
                  type="hidden"
                  value={target.isPaused ? "resume-slack-webhook" : "pause-slack-webhook"}
                />
                <input name="slackTargetId" type="hidden" value={target.id} />
                <SubmitButton
                  className="f9-wk-lnk f9-nt-submit"
                  intent={target.isPaused ? "resume-slack-webhook" : "pause-slack-webhook"}
                  match={{ slackTargetId: target.id }}
                  pendingLabel="Updating…"
                >
                  {target.isPaused ? "Resume" : "Pause"}
                </SubmitButton>
              </Form>
            ) : null}
          </div>
        ))}
      </TargetList>
    </section>
  );
}

function WhatsAppDelivery({ data }: { data: NotificationsLoaderData }) {
  if (!data.canManageWhatsAppDelivery) {
    return (
      <section aria-labelledby="whatsapp-delivery-title" className="f9-nt-section">
        <SectionHeading
          context="WhatsApp is customer-facing, but this account has not passed every provider and confirmation check yet."
          id="whatsapp-delivery-title"
          title="WhatsApp delivery"
        />
        <p className="f9-nt-quiet">
          WhatsApp setup is not ready for this account. Use email delivery until provider
          access, account access, and delivery confirmation are all configured.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="whatsapp-delivery-title" className="f9-nt-section">
      <SectionHeading
        context="WhatsApp delivery is enabled for this account. Only add recipients who have explicitly opted in."
        id="whatsapp-delivery-title"
        title="WhatsApp delivery"
      />

      <Form className="f9-nt-connect-row" method="post">
        <input name="intent" type="hidden" value="save-whatsapp-target" />
        <WorkRowCopy
          name="Connect recipient"
          say="Delivery turns on after Meta confirms the setup template was delivered."
        />
        <label className="f9-nt-field">
          <span className="f9-nt-label">Recipient label</span>
          <input
            autoComplete="off"
            className="f9-nt-input"
            name="whatsappDestinationName"
            placeholder="Founder, growth lead..."
            type="text"
          />
        </label>
        <label className="f9-nt-field">
          <span className="f9-nt-label">WhatsApp number</span>
          <input
            autoComplete="off"
            className="f9-nt-input"
            inputMode="tel"
            name="whatsappTargetValue"
            placeholder="+919876543210"
            type="tel"
          />
        </label>
        <label className="f9-nt-check-row">
          <input name="whatsappExplicitOptIn" type="checkbox" value="yes" />
          <span>Recipient has opted in to receive Five to Nine WhatsApp updates.</span>
        </label>
        <SubmitButton
          className="f9-wk-lnk f9-nt-submit"
          intent="save-whatsapp-target"
          pendingLabel="Saving…"
        >
          Save WhatsApp delivery
        </SubmitButton>
      </Form>

      <dl className="f9-nt-definitions is-compact">
        <ChannelRow
          copy="The recipient must agree to receive WhatsApp updates."
          name="Recipient opt-in"
          status="Required"
        />
        <ChannelRow
          copy="Meta must approve the message template before updates can be sent."
          name="Template approval"
          status={data.whatsappDelivery.customerReady ? "Enabled" : "Not enabled"}
        />
        <ChannelRow
          copy="Delivery turns on after the first test message is confirmed."
          name="Successful test"
          status={data.whatsappDelivery.webhookConfigured ? "Configured" : "Not configured"}
        />
        <ChannelRow
          copy={`${data.whatsappDelivery.usableTargets} of ${data.whatsappDelivery.configuredTargets} configured recipient${
            data.whatsappDelivery.configuredTargets === 1 ? "" : "s"
          } can receive updates.`}
          name="Recipients"
          status={`${data.whatsappDelivery.usableTargets}/${data.whatsappDelivery.configuredTargets} usable`}
        />
        <ChannelRow
          copy="The latest confirmed customer delivery."
          name="Last sent"
          status={
            data.whatsappDelivery.lastSuccessfulDeliveryAt ? (
              <LocalTime iso={data.whatsappDelivery.lastSuccessfulDeliveryAt} />
            ) : (
              "No successful send yet"
            )
          }
        />
      </dl>

      <TargetList
        emptyCopy="Add an opted-in recipient when WhatsApp is enabled for this account."
        emptyTitle="No WhatsApp recipient connected"
        title="Connected recipients"
      >
        {data.whatsappTargets.map((target) => (
          <div className="f9-nt-target-row" key={target.id}>
            <div>
              <strong>{target.displayName}</strong>
              <p>
                {target.validationStatus === "validated" && target.templateEligible
                  ? "Template-ready"
                  : "Needs validation"}
                {target.lastSuccessfulDeliveryAt ? (
                  <> · last sent <LocalTime iso={target.lastSuccessfulDeliveryAt} /></>
                ) : (
                  " · no successful send yet"
                )}
              </p>
            </div>
          </div>
        ))}
      </TargetList>
    </section>
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

function slackChannelStatus(data: NotificationsLoaderData) {
  if (!data.showSlackDelivery) return "Not available";
  if (!data.slackDelivery.entitled) return "Upgrade required";
  return data.slackTargets.length > 0 ? "Connected" : "Available";
}

function slackChannelCopy(data: NotificationsLoaderData) {
  if (!data.showSlackDelivery) return slackDeliveryUnavailableMessage();
  if (!data.slackDelivery.entitled) {
    return "Slack delivery is included in Starter and Agency plans.";
  }
  return data.slackTargets.length > 0
    ? `${data.slackTargets.length} channel${data.slackTargets.length === 1 ? "" : "s"} connected.`
    : "Add an incoming webhook for eligible digests and high-priority changes.";
}

function whatsAppChannelStatus(
  data: NotificationsLoaderData,
  showWhatsAppDelivery: boolean,
) {
  if (!showWhatsAppDelivery) return "Not available";
  if (!data.canManageWhatsAppDelivery) return "Setup not ready";
  return data.whatsappDelivery.usableTargets > 0 ? "Connected" : "Available";
}

function whatsAppChannelCopy(
  data: NotificationsLoaderData,
  showWhatsAppDelivery: boolean,
) {
  if (!showWhatsAppDelivery) return whatsappDeliveryUnavailableMessage();
  if (!data.canManageWhatsAppDelivery) {
    return "WhatsApp delivery is not ready for this account yet. Use email delivery.";
  }
  return data.whatsappDelivery.usableTargets > 0
    ? `${data.whatsappDelivery.usableTargets} opted-in recipient${data.whatsappDelivery.usableTargets === 1 ? "" : "s"} ready.`
    : "Add an opted-in recipient, then wait for Meta to confirm the setup template.";
}
