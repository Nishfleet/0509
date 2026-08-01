import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { LocalTime } from "~/components/local-time";
import { DashboardPage } from "~/components/dashboard-page";
import { SubmitButton } from "~/components/submit-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { WorkingHeader } from "~/components/workspace/working-header";
import {
  isWhatsAppDeliveryCustomerFacing,
  slackDeliveryUnavailableMessage,
  whatsappDeliveryUnavailableMessage,
} from "~/lib/ga-customer-surface";
import type { PlanFamily } from "~/lib/plan-entitlements";
import type {
  NullableString,
  RouteActionData,
} from "~/routes/workspace-settings.shared";

export const notificationsMeta: MetaFunction = () => [
  { title: "Notifications | Five to Nine" },
  {
    name: "description",
    content:
      "Manage email digest delivery and alert channels for Five to Nine.",
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

export function NotificationsRoute() {
  const data = useLoaderData<NotificationsLoaderData>();
  const actionData = useActionData<RouteActionData>();
  const showWhatsAppDelivery = isWhatsAppDeliveryCustomerFacing();

  return (
    <DashboardPage className="f9-wk-page f9-bl040-page">
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

      <section className="f9-app-stack">
        <section className="f9-app-panel f9-source-setup">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Notifications</span>
              <h2>Delivery channels</h2>
            </div>
            <Link className="f9-secondary-button" to="/app/watchlists">
              Tune delivery
            </Link>
          </div>
          <p className="f9-muted-copy">
            Choose where briefs and confirmed competitor changes should be sent.
            Source access and API keys live on their own pages.
          </p>

          <div
            aria-label="Delivery channels"
            className="f9-bl040-rows"
            role="list"
          >
            <div className="f9-bl040-status-row" role="listitem">
              <div>
                <strong>Email</strong>
                <p>
                  {data.emailDeliveryReady ? (
                    "Digest delivery can use the account email."
                  ) : (
                    <>
                      Add an account email first.{" "}
                      <Link to="/app/account">Open account</Link>
                    </>
                  )}
                </p>
              </div>
              <span
                className={`f9-bl040-status${data.emailDeliveryReady ? "" : " is-bad"}`}
              >
                {data.emailDeliveryReady ? "Ready" : "Needs email"}
              </span>
            </div>
            {data.showSlackDelivery ? (
              <div className="f9-bl040-status-row" role="listitem">
                <div>
                  <strong>Slack</strong>
                  <p>{slackChannelCopy(data)}</p>
                </div>
                <span className="f9-bl040-status">
                  {slackChannelStatus(data)}
                </span>
              </div>
            ) : null}
            {showWhatsAppDelivery ? (
              <div className="f9-bl040-status-row" role="listitem">
                <div>
                  <strong>WhatsApp</strong>
                  <p>{whatsAppChannelCopy(data, showWhatsAppDelivery)}</p>
                </div>
                <span className="f9-bl040-status">
                  {whatsAppChannelStatus(data, showWhatsAppDelivery)}
                </span>
              </div>
            ) : null}
          </div>

          <div className="f9-dashboard-grid">
            <section className="f9-app-panel f9-source-guide">
              <span className="f9-app-kicker">Email delivery</span>
              <h3>Tune what gets sent</h3>
              <p className="f9-muted-copy">
                Choose how often digests arrive. Instant alerts and quiet hours
                stay on each watchlist. Briefs go to the account email when one
                is ready.
              </p>
              <Form className="f9-auth-form" method="post">
                <input
                  name="intent"
                  type="hidden"
                  value="save-digest-cadence"
                />
                <label className="f9-field">
                  <span>Digest frequency</span>
                  <select
                    defaultValue={
                      data.digestCadencePreference ?? "plan_default"
                    }
                    name="digestCadencePreference"
                  >
                    <option value="plan_default">
                      Plan default (daily when your plan includes it)
                    </option>
                    <option value="weekly_only">Weekly only</option>
                  </select>
                </label>
                <SubmitButton
                  className="f9-primary-button"
                  intent="save-digest-cadence"
                  pendingLabel="Saving…"
                >
                  Save frequency
                </SubmitButton>
              </Form>
              <Link className="f9-secondary-button" to="/app/watchlists">
                Tune on competitors
              </Link>
              <Link className="f9-secondary-button" to="/app/account">
                Open account
              </Link>
            </section>

            <section className="f9-app-panel f9-source-guide">
              <span className="f9-app-kicker">Delivery history</span>
              <h3>Review what was sent</h3>
              <p className="f9-muted-copy">
                Digests show the delivery trail for completed checks and
                all-quiet summaries.
              </p>
              <Link className="f9-secondary-button" to="/app/digests">
                Open briefs
              </Link>
            </section>
          </div>
        </section>

        {data.showSlackDelivery ? (
          <section className="f9-app-panel f9-source-setup">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-app-kicker">Slack delivery</span>
                <h2>Send competitor changes to Slack</h2>
              </div>
            </div>

            <p className="f9-muted-copy">
              Add an incoming webhook from your Slack app. Five to Nine stores
              the webhook encrypted and sends eligible digests and high-priority
              change alerts to that channel.
            </p>

            {!data.slackDelivery.entitled ? (
              <div className="f9-message" role="status">
                <strong>Slack controls are locked on this plan</strong>
                <p>
                  Slack delivery is included in Starter and Agency plans.
                  Existing channel history stays visible below.{" "}
                  <Link to="/app/billing?source=notifications#plans">
                    View plans
                  </Link>{" "}
                  to restore channel controls.
                </p>
              </div>
            ) : null}

            <div className="f9-dashboard-grid">
              {data.slackDelivery.entitled ? (
                <section className="f9-app-panel f9-source-guide">
                  <span className="f9-app-kicker">Connect channel</span>
                  <h3>Incoming webhook</h3>
                  <Form className="f9-auth-form" method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value="save-slack-webhook"
                    />
                    <label className="f9-field">
                      <span>Channel label</span>
                      <input
                        autoComplete="off"
                        name="slackDestinationName"
                        placeholder="Growth team, competitor alerts..."
                        type="text"
                      />
                    </label>
                    <label className="f9-field">
                      <span>Slack webhook URL</span>
                      <input
                        autoComplete="off"
                        name="slackWebhookUrl"
                        placeholder="Paste the incoming webhook URL"
                        type="password"
                      />
                    </label>
                    <SubmitButton
                      className="f9-primary-button"
                      intent="save-slack-webhook"
                      pendingLabel="Saving…"
                    >
                      Save Slack delivery
                    </SubmitButton>
                  </Form>
                </section>
              ) : null}

              <section className="f9-app-panel f9-source-guide">
                <span className="f9-app-kicker">Delivery behavior</span>
                <h3>What posts to Slack</h3>
                <dl className="proof-trail-list">
                  <div>
                    <dt>Digests</dt>
                    <dd>
                      Weekly or daily digest summaries when the account plan
                      allows digests.
                    </dd>
                  </div>
                  <div>
                    <dt>Alerts</dt>
                    <dd>
                      High-priority confirmed competitor changes outside quiet
                      hours.
                    </dd>
                  </div>
                  <div>
                    <dt>Secrets</dt>
                    <dd>
                      The webhook is encrypted and never shown again after
                      saving.
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <div className="f9-work-list">
              {data.slackTargets.length > 0 ? (
                data.slackTargets.map((target) => (
                  <article className="f9-work-row" key={target.id}>
                    <div>
                      <strong>{target.displayName}</strong>
                      <p>
                        {target.isPaused ? "Paused" : "Active"}
                        {target.lastSuccessfulDeliveryAt ? (
                          <>
                            {" "}
                            · last sent{" "}
                            <LocalTime iso={target.lastSuccessfulDeliveryAt} />
                          </>
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
                          value={
                            target.isPaused
                              ? "resume-slack-webhook"
                              : "pause-slack-webhook"
                          }
                        />
                        <input
                          name="slackTargetId"
                          type="hidden"
                          value={target.id}
                        />
                        <SubmitButton
                          className="f9-secondary-button"
                          intent={
                            target.isPaused
                              ? "resume-slack-webhook"
                              : "pause-slack-webhook"
                          }
                          match={{ slackTargetId: target.id }}
                          pendingLabel="Updating…"
                        >
                          {target.isPaused ? "Resume" : "Pause"}
                        </SubmitButton>
                      </Form>
                    ) : null}
                  </article>
                ))
              ) : (
                <article className="f9-work-row">
                  <div>
                    <strong>No Slack channel connected</strong>
                    <p>
                      Add a webhook when you want digests and important changes
                      posted to Slack.
                    </p>
                  </div>
                </article>
              )}
            </div>
          </section>
        ) : null}

        {showWhatsAppDelivery ? (
          data.canManageWhatsAppDelivery ? (
            <details
              className="f9-app-panel f9-source-setup f9-settings-details"
              open={
                data.whatsappTargets.length > 0 ||
                data.whatsappDelivery.usableTargets > 0
              }
            >
              <summary>Advanced: WhatsApp delivery</summary>
              <div className="f9-panel-toolbar">
                <div>
                  <span className="f9-app-kicker">WhatsApp delivery</span>
                  <h2>Send changes to WhatsApp</h2>
                </div>
              </div>

              <p className="f9-muted-copy">
                WhatsApp delivery is enabled for this account. Only add
                recipients who have explicitly opted in.
              </p>

              <div className="f9-dashboard-grid">
                {whatsAppSetupPending(data) ? (
                  <div className="f9-message" role="status">
                    <strong>Recipient setup is pending</strong>
                    <p>
                      Review the existing recipient while validation or template
                      confirmation completes. New recipient setup is paused to
                      avoid duplicate delivery attempts.
                    </p>
                  </div>
                ) : (
                  <section className="f9-app-panel f9-source-guide">
                    <span className="f9-app-kicker">Connect recipient</span>
                    <h3>Validate WhatsApp</h3>
                    <Form className="f9-auth-form" method="post">
                      <input
                        name="intent"
                        type="hidden"
                        value="save-whatsapp-target"
                      />
                      <label className="f9-field">
                        <span>Recipient label</span>
                        <input
                          autoComplete="off"
                          name="whatsappDestinationName"
                          placeholder="Founder, growth lead..."
                          type="text"
                        />
                      </label>
                      <label className="f9-field">
                        <span>WhatsApp number</span>
                        <input
                          autoComplete="off"
                          inputMode="tel"
                          name="whatsappTargetValue"
                          placeholder="+15551234567"
                          type="tel"
                        />
                      </label>
                      <label className="f9-checkbox-row">
                        <input
                          name="whatsappExplicitOptIn"
                          type="checkbox"
                          value="yes"
                        />
                        <span>
                          Recipient has opted in to receive Five to Nine
                          WhatsApp updates.
                        </span>
                      </label>
                      <SubmitButton
                        className="f9-primary-button"
                        intent="save-whatsapp-target"
                        pendingLabel="Saving…"
                      >
                        Save WhatsApp delivery
                      </SubmitButton>
                    </Form>
                  </section>
                )}

                <section className="f9-app-panel f9-source-guide">
                  <span className="f9-app-kicker">Availability</span>
                  <h3>What Five to Nine checks before enabling it</h3>
                  <dl className="proof-trail-list">
                    <div>
                      <dt>Recipient opt-in</dt>
                      <dd>
                        The recipient must agree to receive WhatsApp updates.
                      </dd>
                    </div>
                    <div>
                      <dt>Template approval</dt>
                      <dd>
                        Meta must approve the message template before updates
                        can be sent.
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>

              <dl className="proof-trail-list">
                <div>
                  <dt>Availability</dt>
                  <dd>
                    {data.whatsappDelivery.providerConfigured
                      ? "Configured"
                      : "Not configured"}
                  </dd>
                </div>
                <div>
                  <dt>Account access</dt>
                  <dd>
                    {data.whatsappDelivery.customerReady
                      ? "Enabled"
                      : "Not enabled"}
                  </dd>
                </div>
                <div>
                  <dt>Delivery webhook</dt>
                  <dd>
                    {data.whatsappDelivery.webhookConfigured
                      ? "Configured · The confirmation webhook is configured for delivery receipts."
                      : "Not configured · Configure the confirmation webhook for delivery receipts."}
                  </dd>
                </div>
                <div>
                  <dt>Recipients</dt>
                  <dd>
                    {data.whatsappDelivery.usableTargets}/
                    {data.whatsappDelivery.configuredTargets} usable ·{" "}
                    {data.whatsappDelivery.usableTargets} of{" "}
                    {data.whatsappDelivery.configuredTargets} configured
                    recipient
                    {data.whatsappDelivery.configuredTargets === 1
                      ? ""
                      : "s"}{" "}
                    can receive updates.
                  </dd>
                </div>
                <div>
                  <dt>Last sent</dt>
                  <dd>
                    {data.whatsappDelivery.lastSuccessfulDeliveryAt ? (
                      <LocalTime
                        iso={data.whatsappDelivery.lastSuccessfulDeliveryAt}
                      />
                    ) : (
                      "No successful send yet"
                    )}
                  </dd>
                </div>
              </dl>

              <div className="f9-work-list">
                {data.whatsappTargets.length > 0 ? (
                  data.whatsappTargets.map((target) => (
                    <article className="f9-work-row" key={target.id}>
                      <div>
                        <strong>{target.displayName}</strong>
                        <p>
                          {target.isPaused
                            ? "Paused"
                            : target.validationStatus === "validated" &&
                                target.templateEligible
                              ? "Template-ready"
                              : "Needs validation"}
                          {target.lastSuccessfulDeliveryAt ? (
                            <>
                              {" "}
                              · last sent{" "}
                              <LocalTime
                                iso={target.lastSuccessfulDeliveryAt}
                              />
                            </>
                          ) : (
                            " · no successful send yet"
                          )}
                        </p>
                      </div>
                    </article>
                  ))
                ) : (
                  <article className="f9-work-row">
                    <div>
                      <strong>No WhatsApp recipient connected</strong>
                      <p>
                        Add an opted-in recipient when WhatsApp is enabled for
                        this account.
                      </p>
                    </div>
                  </article>
                )}
              </div>
            </details>
          ) : (
            <section
              className="f9-app-panel f9-source-setup"
              aria-labelledby="whatsapp-setup-title"
            >
              <div className="f9-panel-toolbar">
                <div>
                  <span className="f9-app-kicker">WhatsApp delivery</span>
                  <h2 id="whatsapp-setup-title">Setup not ready</h2>
                </div>
              </div>
              <p className="f9-muted-copy">
                WhatsApp setup is not ready for this account. Use email delivery
                until provider access, account access, and delivery confirmation
                are all configured.
              </p>
              <dl className="proof-trail-list">
                <div>
                  <dt>Provider access</dt>
                  <dd>
                    {data.whatsappDelivery.providerConfigured
                      ? "Configured"
                      : "Not configured"}
                  </dd>
                </div>
                <div>
                  <dt>Account access</dt>
                  <dd>
                    {data.whatsappDelivery.customerReady
                      ? "Enabled"
                      : "Not enabled"}
                  </dd>
                </div>
                <div>
                  <dt>Delivery webhook</dt>
                  <dd>
                    {data.whatsappDelivery.webhookConfigured
                      ? "Configured"
                      : "Not configured"}
                  </dd>
                </div>
              </dl>
            </section>
          )
        ) : null}
      </section>
    </DashboardPage>
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
  if (data.whatsappDelivery.usableTargets > 0) return "Connected";
  if (whatsAppSetupPending(data)) return "Pending";
  if (pausedWhatsAppTargetCount(data) > 0) return "Paused";
  return data.whatsappDelivery.configuredTargets > 0 ? "Pending" : "Available";
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
    ? `${data.whatsappDelivery.usableTargets} opted-in recipient${
        data.whatsappDelivery.usableTargets === 1 ? "" : "s"
      } ready.`
    : whatsAppSetupPending(data)
      ? `${data.whatsappDelivery.configuredTargets} configured recipient${
          data.whatsappDelivery.configuredTargets === 1 ? "" : "s"
        } awaiting validation or template confirmation. Review the existing recipient before adding another.`
      : pausedWhatsAppTargetCount(data) > 0
        ? `${pausedWhatsAppTargetCount(data)} configured recipient${
            pausedWhatsAppTargetCount(data) === 1 ? "" : "s"
          } paused. Review the existing recipient before adding another.`
        : "Add an opted-in recipient, then wait for Meta to confirm the setup template.";
}

function whatsAppSetupPending(data: NotificationsLoaderData) {
  return (
    data.whatsappDelivery.usableTargets === 0 &&
    pendingWhatsAppTargetCount(data) > 0
  );
}

function pendingWhatsAppTargetCount(data: NotificationsLoaderData) {
  return data.whatsappTargets.filter(isPendingWhatsAppTarget).length;
}

function pausedWhatsAppTargetCount(data: NotificationsLoaderData) {
  return data.whatsappTargets.filter((target) => target.isPaused).length;
}

function isPendingWhatsAppTarget(target: WhatsAppTargetView) {
  return (
    !target.isPaused &&
    (target.validationStatus !== "validated" || !target.templateEligible)
  );
}
