import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { LocalTime } from "~/components/local-time";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { SubmitButton } from "~/components/submit-button";
import {
  isSlackDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
} from "~/lib/ga-customer-surface";

export const sourceAccessMeta: MetaFunction = () => [
  { title: "Source access | Five to Nine" },
  {
    name: "description",
    content: "Manage backup Meta access and tracking reliability for Five to Nine.",
  },
];

export const notificationsMeta: MetaFunction = () => [
  { title: "Notifications | Five to Nine" },
  {
    name: "description",
    content: "Manage email digest delivery and alert channels for Five to Nine.",
  },
];

export const developerAccessMeta: MetaFunction = () => [
  { title: "Developer access | Five to Nine" },
  {
    name: "description",
    content: "Manage API keys for exports and approved account actions in Five to Nine.",
  },
];

type NullableString = string | null;

type RouteActionData = {
  ok: boolean;
  message: string;
};

type SourceAccessConnection = {
  status: string;
  tokenLastFour: string;
  summary: NullableString;
  lastCheckedAt: NullableString;
  lastErrorCode: NullableString;
  lastErrorMessage: NullableString;
  updatedAt: string;
};

type SourceAccessDiscoveryStatus = {
  status: string;
  summary?: NullableString;
};

export type SourceAccessLoaderData = {
  connection: SourceAccessConnection | null;
  discoveryStatus: SourceAccessDiscoveryStatus;
};

type CustomerApiKeyView = {
  id: string;
  name: string;
  keyPrefix: string;
  actionsWriteEnabled: boolean;
  lastUsedAt: NullableString;
  revokedAt: NullableString;
  createdAt: string;
};

export type DeveloperAccessLoaderData = {
  apiKeys: CustomerApiKeyView[];
};

type DeveloperAccessActionData = RouteActionData & {
  apiKeySecret?: string;
  apiKeyPrefix?: string;
};

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

export function SourceAccessHydrateFallback() {
  return <DashboardRouteLoading title="Source access" />;
}

export function NotificationsHydrateFallback() {
  return <DashboardRouteLoading title="Notifications" />;
}

export function DeveloperAccessHydrateFallback() {
  return <DashboardRouteLoading title="Developer access" />;
}

export function WorkspaceSettingsErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export function SourceAccessRoute() {
  const data = useLoaderData<SourceAccessLoaderData>();
  const actionData = useActionData<RouteActionData>();
  const statusLabel = data.connection ? formatConnectionStatus(data.connection.status) : "Not connected";

  return (
    <DashboardPage>
      <DashboardPageHeader
        action={{ label: "Open watchlists", to: "/app/watchlists" }}
        lead="Backup Meta access and tracking reliability."
        title="Source access"
      />
      <section className="f9-app-stack">
        <section className="f9-app-panel f9-source-setup">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Source access</span>
              <h2>Backup Meta ad checks</h2>
            </div>
            <Link className="f9-secondary-button" to="/app/notifications">
              Notification settings
            </Link>
          </div>
          <p className="f9-muted-copy">
            Five to Nine checks public ad and landing-page signals for you. If Meta limits access, add your own Meta Ad
            Library token so this account has a backup.
          </p>

          <div className="f9-status-strip">
            <div>
              <span className="f9-app-kicker">Backup access</span>
              <strong>{statusLabel}</strong>
              {data.connection ? (
                <p className="f9-muted-copy">
                  Connected token ends in {data.connection.tokenLastFour}
                  {data.connection.lastCheckedAt ? (
                    <> · tested <LocalTime iso={data.connection.lastCheckedAt} /></>
                  ) : (
                    ""
                  )}
                </p>
              ) : (
                <p className="f9-muted-copy">No backup Meta access is connected yet.</p>
              )}
            </div>
            <div>
              <span className="f9-app-kicker">Tracking status</span>
              <strong>{formatDiscoveryStatus(data.discoveryStatus.status)}</strong>
              <p className="f9-muted-copy">{formatTrackingStatusSummary(data.discoveryStatus.summary)}</p>
            </div>
          </div>

          {actionData?.message ? (
            <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
              <p>{actionData.message}</p>
            </div>
          ) : null}

          <div className="f9-dashboard-grid">
            <section className="f9-app-panel f9-source-guide">
              <span className="f9-app-kicker">Add backup Meta access</span>
              <h3>Where to get the token</h3>
              <ol className="f9-numbered-guide">
                <li>
                  Open Meta's{" "}
                  <a href="https://www.facebook.com/ads/library/api/" rel="noreferrer" target="_blank">
                    Ad Library API page
                  </a>
                  .
                </li>
                <li>Confirm identity and location if Meta asks.</li>
                <li>Create or select a Meta for Developers app.</li>
                <li>
                  Open{" "}
                  <a href="https://developers.facebook.com/tools/explorer/" rel="noreferrer" target="_blank">
                    Graph API Explorer
                  </a>{" "}
                  and generate an access token for that app.
                </li>
                <li>Paste the full token below and test it before saving.</li>
              </ol>
              <p className="f9-muted-copy">
                The token is stored encrypted and only used to check ads for this account.
              </p>
            </section>

            <section className="f9-app-panel f9-source-guide">
              <span className="f9-app-kicker">Save backup access</span>
              <h3>Paste and test</h3>
              <Form className="f9-auth-form" method="post">
                <input name="intent" type="hidden" value="connect-meta-token" />
                <label className="f9-field">
                  <span>Meta access token</span>
                  <textarea
                    autoComplete="off"
                    name="metaToken"
                    placeholder="Paste the full Meta access token here"
                    rows={5}
                  />
                </label>
                <SubmitButton className="f9-primary-button" intent="connect-meta-token" pendingLabel="Saving…">
                  Test and save access
                </SubmitButton>
              </Form>

              {data.connection ? (
                <div className="f9-action-row">
                  <Form method="post">
                    <input name="intent" type="hidden" value="retest-meta-token" />
                    <SubmitButton className="f9-secondary-button" intent="retest-meta-token" pendingLabel="Testing…">
                      Retest saved access
                    </SubmitButton>
                  </Form>
                  <Form method="post">
                    <input name="intent" type="hidden" value="disconnect-meta-token" />
                    <SubmitButton className="f9-secondary-button" intent="disconnect-meta-token" pendingLabel="Removing…">
                      Disconnect
                    </SubmitButton>
                  </Form>
                </div>
              ) : null}
            </section>
          </div>
        </section>
      </section>
    </DashboardPage>
  );
}

export function DeveloperAccessRoute() {
  const data = useLoaderData<DeveloperAccessLoaderData>();
  const actionData = useActionData<DeveloperAccessActionData>();
  const activeApiKeyCount = data.apiKeys.filter((apiKey) => !apiKey.revokedAt).length;
  const writeEnabledApiKeyCount = data.apiKeys.filter((apiKey) => !apiKey.revokedAt && apiKey.actionsWriteEnabled).length;
  const hasNewApiKeySecret = Boolean(actionData && "apiKeySecret" in actionData && actionData.apiKeySecret);

  return (
    <DashboardPage>
      <DashboardPageHeader
        action={{ label: "API docs", to: "/api/docs" }}
        lead="API keys for exports and approved account actions."
        title="Developer access"
      />
      <section className="f9-app-stack">
        <section className="f9-app-panel f9-source-setup">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Developer access</span>
              <h2>Connect exports and approved actions</h2>
            </div>
            <a className="f9-secondary-button" href="/api/docs" target="_blank" rel="noreferrer">
              API docs
            </a>
          </div>

          <p className="f9-muted-copy">
            API keys can read saved collections, watchlists, digests, source trails, and exports for this account.
            Write-enabled keys can run approved account actions only for trusted workflows. See the{" "}
            <a href="/api/docs" rel="noreferrer" target="_blank">
              API documentation
            </a>{" "}
            for the full capability list.
          </p>

          <div className="f9-status-strip">
            <div>
              <span className="f9-app-kicker">Active keys</span>
              <strong>{activeApiKeyCount}</strong>
            </div>
            <div>
              <span className="f9-app-kicker">Write access</span>
              <strong>{writeEnabledApiKeyCount > 0 ? `${writeEnabledApiKeyCount} enabled` : "Needs write key"}</strong>
            </div>
            <div>
              <span className="f9-app-kicker">Scope</span>
              <strong>Saved account data only</strong>
            </div>
          </div>

          {actionData?.message && !hasNewApiKeySecret ? (
            <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
              <p>{actionData.message}</p>
            </div>
          ) : null}

          {hasNewApiKeySecret && actionData && "apiKeySecret" in actionData ? (
            <div className="f9-message is-success">
              <p>Copy this key now. Five to Nine stores only the hashed key and cannot show it again.</p>
              <label className="f9-field">
                <span>{actionData.apiKeyPrefix}</span>
                <textarea readOnly rows={3} value={actionData.apiKeySecret} />
              </label>
            </div>
          ) : null}

          <div className="f9-dashboard-grid">
            <section className="f9-app-panel f9-source-guide">
              <span className="f9-app-kicker">Tool setup</span>
              <h3>Connect your tools without exposing secrets</h3>
              <ol className="f9-numbered-guide">
                <li>
                  <strong>Create a read key</strong>
                  <span>Use it for saved collections, watchlists, digests, and reports.</span>
                </li>
                <li>
                  <strong>Enable write access only when needed</strong>
                  <span>Allow trusted workflows to run approved account actions.</span>
                </li>
                <li>
                  <strong>Review and revoke keys</strong>
                  <span>Remove keys you no longer use from this page.</span>
                </li>
              </ol>
            </section>

            <section className="f9-app-panel f9-source-guide">
              <span className="f9-app-kicker">API examples</span>
              <h3>Current live endpoints</h3>
              <dl className="proof-trail-list">
                <div>
                  <dt>JSON</dt>
                  <dd>/api/v1/watchlists/&lbrace;id&rbrace;?format=json</dd>
                </div>
                <div>
                  <dt>Header</dt>
                  <dd>Authorization: Bearer your Five to Nine API key</dd>
                </div>
              </dl>
              <p className="f9-muted-copy">
                This API can read saved manual external evidence links in collections. Write-enabled keys can update
                approved account resources, but this does not add automated TikTok, Google, LinkedIn, or Pinterest
                ingestion.
              </p>
            </section>
          </div>

          <div className="f9-dashboard-grid">
            <section className="f9-app-panel f9-source-guide">
              <span className="f9-app-kicker">Create API key</span>
              <h3>Exports and approved actions</h3>
              <Form className="f9-auth-form" method="post">
                <input name="intent" type="hidden" value="create-api-key" />
                <label className="f9-field">
                  <span>Key name</span>
                  <input
                    autoComplete="off"
                    name="apiKeyName"
                    placeholder="Zapier, workflow script, assistant..."
                    type="text"
                  />
                </label>
                <label className="f9-checkbox-row">
                  <input name="actionsWriteEnabled" type="checkbox" value="1" />
                  <span>Allow approved account actions</span>
                </label>
                <SubmitButton className="f9-primary-button" intent="create-api-key" pendingLabel="Creating…">
                  Create API key
                </SubmitButton>
              </Form>
            </section>
          </div>

          <div className="f9-work-list">
            {data.apiKeys.length > 0 ? (
              data.apiKeys.map((apiKey) => (
                <article className="f9-work-row" key={apiKey.id}>
                  <div>
                    <strong>{apiKey.name}</strong>
                    <p>
                      {apiKey.keyPrefix}...
                      {apiKey.lastUsedAt ? (
                        <> · last used <LocalTime iso={apiKey.lastUsedAt} /></>
                      ) : (
                        " · never used"
                      )}
                      {apiKey.revokedAt ? (
                        <> · revoked <LocalTime iso={apiKey.revokedAt} /></>
                      ) : (
                        ""
                      )}
                      {" · "}
                      {apiKey.actionsWriteEnabled ? "actions enabled" : "read-only"}
                    </p>
                  </div>
                  {apiKey.revokedAt ? null : (
                    <Form method="post">
                      <input name="intent" type="hidden" value="revoke-api-key" />
                      <input name="apiKeyId" type="hidden" value={apiKey.id} />
                      <SubmitButton
                        className="f9-secondary-button"
                        intent="revoke-api-key"
                        match={{ apiKeyId: apiKey.id }}
                        pendingLabel="Removing…"
                      >
                        Revoke
                      </SubmitButton>
                    </Form>
                  )}
                </article>
              ))
            ) : (
              <article className="f9-work-row">
                <div>
                  <strong>No API keys yet</strong>
                  <p>Create one when you are ready to connect an external tool.</p>
                </div>
              </article>
            )}
          </div>
        </section>
      </section>
    </DashboardPage>
  );
}

export function NotificationsRoute() {
  const data = useLoaderData<NotificationsLoaderData>();
  const actionData = useActionData<RouteActionData>();
  const canManageWhatsAppDelivery =
    isWhatsAppDeliveryCustomerFacing() &&
    data.whatsappDelivery.providerConfigured &&
    data.whatsappDelivery.customerReady &&
    data.whatsappDelivery.webhookConfigured;
  const showSlackDelivery = isSlackDeliveryCustomerFacing();

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

        {showSlackDelivery ? (
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

        {canManageWhatsAppDelivery ? (
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

function formatConnectionStatus(status: string) {
  if (status === "healthy") {
    return "Connected";
  }
  if (status === "degraded") {
    return "Needs fresh access";
  }
  return "Untested";
}

function formatDiscoveryStatus(status: string) {
  if (status === "cache_only") {
    return "Using recent results";
  }
  if (status === "healthy") {
    return "Live tracking ready";
  }
  if (status === "demo") {
    return "Setup needed";
  }
  if (status === "degraded") {
    return "Needs attention";
  }
  if (status === "disabled") {
    return "Unavailable";
  }
  return "Needs attention";
}

function formatTrackingStatusSummary(summary: string | null | undefined) {
  if (!summary) {
    return "Tracking status will appear after the first check.";
  }

  return summary
    .replace(/Live commercial discovery/gi, "Fresh ad checks")
    .replace(/commercial discovery/gi, "competitor ad checks")
    .replace(/Commercial discovery/gi, "Competitor ad checks")
    .replace(/Browser Run/gi, "visual checks")
    .replace(/Official Meta API/gi, "alternate Meta ad access")
    .replace(/API fallback/gi, "alternate Meta ad results")
    .replace(/workspace Meta access/gi, "alternate Meta ad access")
    .replace(/fresh discovery/gi, "fresh checks")
    .replace(/cached live results/gi, "recent results")
    .replace(/cached results/gi, "recent results")
    .replace(/demo mode/gi, "sample mode");
}
