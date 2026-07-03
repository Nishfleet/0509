import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { LocalTime } from "~/components/local-time";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { SubmitButton } from "~/components/submit-button";
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
  showSlackDelivery: boolean;
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

  return (
    <DashboardPage>
      <DashboardPageHeader
        action={{ label: "Open digests", to: "/app/digests" }}
        lead="Email digest delivery and alert channels."
        title="Notifications"
      />
      <section className="f9-app-stack">
        <section className="f9-app-panel f9-source-setup">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Notifications</span>
              <h2>Digest and alert delivery</h2>
            </div>
            <Link className="f9-secondary-button" to="/app/watchlists">
              Tune delivery
            </Link>
          </div>
          <p className="f9-muted-copy">
            Choose where monitored changes and digest summaries should be sent. Source access and API keys live on their
            own pages.
          </p>

          <div className="f9-status-strip">
            <div>
              <span className="f9-app-kicker">Email</span>
              <strong>{data.emailDeliveryReady ? "Ready" : "Needs email"}</strong>
              <p className="f9-muted-copy">
                {data.emailDeliveryReady ? "Digest delivery can use the account email." : "Add an account email first."}
              </p>
            </div>
            <div>
              <span className="f9-app-kicker">Digest history</span>
              <strong>Available</strong>
              <p className="f9-muted-copy">Review sent and pending digests in Digests.</p>
            </div>
            <div>
              <span className="f9-app-kicker">Per-watchlist alerts</span>
              <strong>Configurable</strong>
              <p className="f9-muted-copy">Tune alert sensitivity from each watchlist.</p>
            </div>
          </div>

          {actionData?.message ? (
            <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
              <p>{actionData.message}</p>
            </div>
          ) : null}

          <div className="f9-dashboard-grid">
            <section className="f9-app-panel f9-source-guide">
              <span className="f9-app-kicker">Email notifications</span>
              <h3>Tune what gets sent</h3>
              <p className="f9-muted-copy">
                Watchlists control digest cadence, instant alerts, quiet hours, and which channels receive updates.
              </p>
              <Link className="f9-secondary-button" to="/app/watchlists">
                Open watchlists
              </Link>
            </section>

            <section className="f9-app-panel f9-source-guide">
              <span className="f9-app-kicker">Delivery history</span>
              <h3>Review what was sent</h3>
              <p className="f9-muted-copy">
                Digests show the delivery trail for completed checks and all-quiet summaries.
              </p>
              <Link className="f9-secondary-button" to="/app/digests">
                Open digests
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
              Add an incoming webhook from your Slack app. Five to Nine stores the webhook encrypted and sends eligible
              digests and high-priority change alerts to that channel.
            </p>

            <div className="f9-dashboard-grid">
              <section className="f9-app-panel f9-source-guide">
                <span className="f9-app-kicker">Connect channel</span>
                <h3>Incoming webhook</h3>
                <Form className="f9-auth-form" method="post">
                  <input name="intent" type="hidden" value="save-slack-webhook" />
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
                  <SubmitButton className="f9-primary-button" intent="save-slack-webhook" pendingLabel="Saving…">
                    Save Slack delivery
                  </SubmitButton>
                </Form>
              </section>

              <section className="f9-app-panel f9-source-guide">
                <span className="f9-app-kicker">Delivery behavior</span>
                <h3>What posts to Slack</h3>
                <dl className="proof-trail-list">
                  <div>
                    <dt>Digests</dt>
                    <dd>Weekly or daily digest summaries when the account plan allows digests.</dd>
                  </div>
                  <div>
                    <dt>Alerts</dt>
                    <dd>High-priority confirmed competitor changes outside quiet hours.</dd>
                  </div>
                  <div>
                    <dt>Secrets</dt>
                    <dd>The webhook is encrypted and never shown again after saving.</dd>
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
                          <> · last sent <LocalTime iso={target.lastSuccessfulDeliveryAt} /></>
                        ) : (
                          " · no sends yet"
                        )}
                      </p>
                    </div>
                    <Form method="post">
                      <input
                        name="intent"
                        type="hidden"
                        value={target.isPaused ? "resume-slack-webhook" : "pause-slack-webhook"}
                      />
                      <input name="slackTargetId" type="hidden" value={target.id} />
                      <SubmitButton
                        className="f9-secondary-button"
                        intent={target.isPaused ? "resume-slack-webhook" : "pause-slack-webhook"}
                        match={{ slackTargetId: target.id }}
                        pendingLabel="Updating…"
                      >
                        {target.isPaused ? "Resume" : "Pause"}
                      </SubmitButton>
                    </Form>
                  </article>
                ))
              ) : (
                <article className="f9-work-row">
                  <div>
                    <strong>No Slack channel connected</strong>
                    <p>Add a webhook when you want digests and important changes posted to Slack.</p>
                  </div>
                </article>
              )}
            </div>
          </section>
        ) : null}

        {data.canManageWhatsAppDelivery ? (
          <details
            className="f9-app-panel f9-source-setup f9-settings-details"
            open={data.whatsappTargets.length > 0 || data.whatsappDelivery.usableTargets > 0}
          >
            <summary>Advanced: WhatsApp delivery</summary>
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-app-kicker">WhatsApp delivery</span>
                <h2>Send changes to WhatsApp</h2>
              </div>
            </div>

            <p className="f9-muted-copy">
              WhatsApp delivery is enabled for this account. Only add recipients who have explicitly opted in.
            </p>

            <div className="f9-dashboard-grid">
              <section className="f9-app-panel f9-source-guide">
                <span className="f9-app-kicker">Connect recipient</span>
                <h3>Validate WhatsApp</h3>
                <Form className="f9-auth-form" method="post">
                  <input name="intent" type="hidden" value="save-whatsapp-target" />
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
                      placeholder="+919876543210"
                      type="tel"
                    />
                  </label>
                  <label className="f9-checkbox-row">
                    <input name="whatsappExplicitOptIn" type="checkbox" value="yes" />
                    <span>Recipient has opted in to receive Five to Nine WhatsApp updates.</span>
                  </label>
                  <SubmitButton className="f9-primary-button" intent="save-whatsapp-target" pendingLabel="Saving…">
                    Save WhatsApp delivery
                  </SubmitButton>
                </Form>
              </section>

              <section className="f9-app-panel f9-source-guide">
                <span className="f9-app-kicker">Availability</span>
                <h3>What Five to Nine checks before enabling it</h3>
                <dl className="proof-trail-list">
                  <div>
                    <dt>Recipient opt-in</dt>
                    <dd>The recipient must agree to receive WhatsApp updates.</dd>
                  </div>
                  <div>
                    <dt>Template approval</dt>
                    <dd>Meta must approve the message template before updates can be sent.</dd>
                  </div>
                  <div>
                    <dt>Successful test send</dt>
                    <dd>Delivery turns on after the first test message is confirmed.</dd>
                  </div>
                </dl>
              </section>
            </div>

            <dl className="proof-trail-list">
              <div>
                <dt>Availability</dt>
                <dd>{data.whatsappDelivery.providerConfigured ? "Configured" : "Not configured"}</dd>
              </div>
              <div>
                <dt>Account access</dt>
                <dd>{data.whatsappDelivery.customerReady ? "Enabled" : "Not enabled"}</dd>
              </div>
              <div>
                <dt>Delivery confirmation</dt>
                <dd>{data.whatsappDelivery.webhookConfigured ? "Configured" : "Not configured"}</dd>
              </div>
              <div>
                <dt>Recipients</dt>
                <dd>
                  {data.whatsappDelivery.usableTargets}/{data.whatsappDelivery.configuredTargets} usable
                </dd>
              </div>
              <div>
                <dt>Last sent</dt>
                <dd>
                  {data.whatsappDelivery.lastSuccessfulDeliveryAt ? (
                    <LocalTime iso={data.whatsappDelivery.lastSuccessfulDeliveryAt} />
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
                  </article>
                ))
              ) : (
                <article className="f9-work-row">
                  <div>
                    <strong>No WhatsApp recipient connected</strong>
                    <p>Add an opted-in recipient when WhatsApp is enabled for this account.</p>
                  </div>
                </article>
              )}
            </div>
          </details>
        ) : null}
      </section>
    </DashboardPage>
  );
}
