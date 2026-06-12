import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";

export const meta: MetaFunction = () => [
  { title: "Tracking access | Five to Nine" },
  {
    name: "description",
    content: "Review the access that keeps competitor tracking reliable in Five to Nine.",
  },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getCustomerMetaConnection,
    listCustomerApiKeys,
    listDeliveryTargets,
  } = await import("~/lib/data.server");
  const { getMetaAdsBetaReadiness } = await import("~/lib/meta-ads-readiness.server");
  const {
    isCustomerWhatsAppReady,
    isWhatsAppProviderConfigured,
    isWhatsAppWebhookConfigured,
  } = await import("~/lib/env.server");
  const { slackTargetDisplayName } = await import("~/lib/slack.server");
  const { whatsappTargetDisplayName } = await import("~/lib/whatsapp.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const [connection, discoveryStatus, betaReadiness, apiKeys, slackTargets, whatsappTargets] = await Promise.all([
    getCustomerMetaConnection(env, session.user.id),
    resolveCommercialAdSourceStatus(env),
    getMetaAdsBetaReadiness(env),
    listCustomerApiKeys(env, session.user.id),
    listDeliveryTargets(env, session.user.id, {
      watchlistId: null,
      channel: "slack",
      limit: 10,
    }),
    listDeliveryTargets(env, session.user.id, {
      channel: "whatsapp",
      limit: 100,
    }),
  ]);
  const usableWhatsAppTargets = whatsappTargets.filter(
    (target) =>
      target.isOptedIn &&
      target.isValidated &&
      target.validationStatus === "validated" &&
      target.templateEligible &&
      !target.isPaused &&
      !target.optedOutAt,
  );
  const lastWhatsAppSuccessAt = whatsappTargets
    .map((target) => target.lastSuccessfulDeliveryAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    connection: connection
      ? {
          status: connection.status,
          tokenLastFour: connection.tokenLastFour,
          summary: connection.summary,
          lastCheckedAt: connection.lastCheckedAt,
          lastErrorCode: connection.lastErrorCode,
          lastErrorMessage: connection.lastErrorMessage,
          updatedAt: connection.updatedAt,
        }
      : null,
    discoveryStatus,
    betaReadiness,
    apiKeys: apiKeys.map((apiKey) => ({
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    })),
    slackTargets: slackTargets.map((target) => ({
      id: target.id,
      displayName: slackTargetDisplayName(target),
      isPaused: target.isPaused,
      lastSuccessfulDeliveryAt: target.lastSuccessfulDeliveryAt,
      createdAt: target.createdAt,
    })),
    whatsappTargets: whatsappTargets.map((target) => ({
      id: target.id,
      displayName: whatsappTargetDisplayName(target),
      isPaused: target.isPaused,
      validationStatus: target.validationStatus,
      templateEligible: target.templateEligible,
      lastSuccessfulDeliveryAt: target.lastSuccessfulDeliveryAt,
      createdAt: target.createdAt,
    })),
    whatsappDelivery: {
      providerConfigured: isWhatsAppProviderConfigured(env),
      customerReady: isCustomerWhatsAppReady(env),
      webhookConfigured: isWhatsAppWebhookConfigured(env),
      configuredTargets: whatsappTargets.length,
      usableTargets: usableWhatsAppTargets.length,
      lastSuccessfulDeliveryAt: lastWhatsAppSuccessAt,
    },
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    disconnectCustomerMetaToken,
    retestSavedCustomerMetaToken,
    saveCustomerMetaToken,
  } = await import("~/lib/customer-meta.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "connect-meta-token") {
    const token = String(formData.get("metaToken") ?? "");
    const result = await saveCustomerMetaToken(env, session.user.id, token);

    return {
      ok: result.ok,
      message: result.testResult.summary,
    };
  }

  if (intent === "retest-meta-token") {
    const result = await retestSavedCustomerMetaToken(env, session.user.id);

    return {
      ok: result.ok,
      message: result.testResult.summary,
    };
  }

  if (intent === "disconnect-meta-token") {
    await disconnectCustomerMetaToken(env, session.user.id);
    return {
      ok: true,
      message: "Backup Meta access disconnected.",
    };
  }

  if (intent === "create-api-key") {
    const { createCustomerApiKey } = await import("~/lib/api-keys.server");
    const name = String(formData.get("apiKeyName") ?? "");
    const result = await createCustomerApiKey(env, session.user.id, name);

    return {
      ok: true,
      message: "API key created. Copy it now; it will not be shown again.",
      apiKeySecret: result.secret,
      apiKeyPrefix: result.apiKey.keyPrefix,
    };
  }

  if (intent === "revoke-api-key") {
    const { revokeCustomerApiKey } = await import("~/lib/data.server");
    const apiKeyId = String(formData.get("apiKeyId") ?? "");
    await revokeCustomerApiKey(env, {
      userId: session.user.id,
      apiKeyId,
    });

    return {
      ok: true,
      message: "API key revoked.",
    };
  }

  if (intent === "save-slack-webhook") {
    const { saveSlackWebhookTarget } = await import("~/lib/slack.server");
    const {
      getWorkspaceDeliveryConfig,
      legacyWorkspaceDeliveryDefaults,
      upsertWorkspaceDeliveryConfig,
    } = await import("~/lib/data.server");
    const webhookUrl = String(formData.get("slackWebhookUrl") ?? "");
    const name = String(formData.get("slackDestinationName") ?? "");
    try {
      await saveSlackWebhookTarget(env, {
        userId: session.user.id,
        webhookUrl,
        name,
      });
    } catch (error) {
      if (error instanceof Response && error.status >= 400 && error.status < 500) {
        return {
          ok: false,
          message: (await error.text()) || "Slack delivery could not be connected.",
        };
      }

      throw error;
    }
    const existingConfig = await getWorkspaceDeliveryConfig(env, session.user.id);
    const defaults = legacyWorkspaceDeliveryDefaults({
      hasEmail: Boolean(session.user.email),
    });
    await upsertWorkspaceDeliveryConfig(env, {
      userId: session.user.id,
      sensitivityMode: existingConfig?.sensitivityMode ?? defaults.sensitivityMode,
      instantEnabled: existingConfig?.instantEnabled ?? defaults.instantEnabled,
      digestEnabled: existingConfig?.digestEnabled ?? defaults.digestEnabled,
      emailEnabled: existingConfig?.emailEnabled ?? defaults.emailEnabled,
      whatsappEnabled: existingConfig?.whatsappEnabled ?? defaults.whatsappEnabled,
      slackEnabled: true,
      quietHours: existingConfig?.quietHours ?? null,
      timezone: existingConfig?.timezone ?? null,
    });

    return {
      ok: true,
      message:
        "Slack delivery connected. Slack accepted the setup test, and future eligible digests can post to that channel.",
    };
  }

  if (intent === "save-whatsapp-target") {
    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");
    const {
      getWorkspaceDeliveryConfig,
      legacyWorkspaceDeliveryDefaults,
      upsertWorkspaceDeliveryConfig,
    } = await import("~/lib/data.server");
    const targetValue = String(formData.get("whatsappTargetValue") ?? "");
    const name = String(formData.get("whatsappDestinationName") ?? "");
    const explicitOptIn = formData.has("whatsappExplicitOptIn");
    try {
      await saveWhatsAppDeliveryTarget(env, {
        userId: session.user.id,
        targetValue,
        name,
        explicitOptIn,
      });
    } catch (error) {
      if (error instanceof Response && error.status >= 400 && error.status < 500) {
        return {
          ok: false,
          message: (await error.text()) || "WhatsApp delivery could not be connected.",
        };
      }

      throw error;
    }
    const existingConfig = await getWorkspaceDeliveryConfig(env, session.user.id);
    const defaults = legacyWorkspaceDeliveryDefaults({
      hasEmail: Boolean(session.user.email),
    });
    await upsertWorkspaceDeliveryConfig(env, {
      userId: session.user.id,
      sensitivityMode: existingConfig?.sensitivityMode ?? defaults.sensitivityMode,
      instantEnabled: existingConfig?.instantEnabled ?? defaults.instantEnabled,
      digestEnabled: existingConfig?.digestEnabled ?? defaults.digestEnabled,
      emailEnabled: existingConfig?.emailEnabled ?? defaults.emailEnabled,
      whatsappEnabled: true,
      slackEnabled: existingConfig?.slackEnabled ?? defaults.slackEnabled,
      quietHours: existingConfig?.quietHours ?? null,
      timezone: existingConfig?.timezone ?? null,
    });

    return {
      ok: true,
      message:
        "WhatsApp setup sent. Delivery turns on after Meta confirms the setup template was delivered.",
    };
  }

  if (intent === "pause-slack-webhook") {
    const { pauseSlackWebhookTarget } = await import("~/lib/slack.server");
    const targetId = String(formData.get("slackTargetId") ?? "");
    const paused = await pauseSlackWebhookTarget(env, {
      userId: session.user.id,
      targetId,
    });

    return {
      ok: paused,
      message: paused ? "Slack delivery paused." : "Slack delivery target was not found.",
    };
  }

  if (intent === "resume-slack-webhook") {
    const { resumeSlackWebhookTarget } = await import("~/lib/slack.server");
    const targetId = String(formData.get("slackTargetId") ?? "");
    const resumed = await resumeSlackWebhookTarget(env, {
      userId: session.user.id,
      targetId,
    });

    return {
      ok: resumed,
      message: resumed ? "Slack delivery resumed." : "Slack delivery target was not found.",
    };
  }

  return {
    ok: false,
    message: "Unknown source action.",
  };
}

export default function AppSourcesRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const statusLabel = data.connection ? formatConnectionStatus(data.connection.status) : "Not connected";

  return (
    <section className="f9-app-stack">
      <section className="f9-app-panel f9-source-setup">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Tracking reliability</span>
            <h2>Keep competitor tracking reliable</h2>
          </div>
          <Link className="f9-secondary-button" to="/app/watchlists">
            Open watchlists
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

        <div className="f9-source-readiness-panel">
          <div>
            <span className="f9-app-kicker">Recent tracking health</span>
            <strong>{formatReadinessLabel(data.betaReadiness.label)}</strong>
            <p className="f9-muted-copy">
              {data.betaReadiness.samples}/{data.betaReadiness.sampleTarget} fresh checks in the last{" "}
              {data.betaReadiness.windowDays} days · {formatSuccessRate(data.betaReadiness.successRate)} successful
              {data.betaReadiness.latestSuccessAt ? (
                <> · last success <LocalTime iso={data.betaReadiness.latestSuccessAt} /></>
              ) : (
                " · no recent success yet"
              )}
            </p>
          </div>
          {data.betaReadiness.blockers.length > 0 ? (
            <ul className="source-proof-list">
              {data.betaReadiness.blockers.map((blocker) => (
                <li key={blocker}>{formatReadinessBlocker(blocker)}</li>
              ))}
            </ul>
          ) : null}
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

      <section className="f9-app-panel f9-source-setup">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Customer API</span>
            <h2>Use Five to Nine from your tools</h2>
          </div>
          <a className="f9-secondary-button" href="/api/v1" target="_blank" rel="noreferrer">
            API docs
          </a>
        </div>

        <p className="f9-muted-copy">
          API keys are read-only and only expose boards, watchlists, digests, proof trails, and export markdown
          owned by this account.
        </p>

        {actionData && "apiKeySecret" in actionData && actionData.apiKeySecret ? (
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
            <span className="f9-app-kicker">Create API key</span>
            <h3>Read-only export access</h3>
            <Form className="f9-auth-form" method="post">
              <input name="intent" type="hidden" value="create-api-key" />
              <label className="f9-field">
                <span>Key name</span>
                <input
                  autoComplete="off"
                  name="apiKeyName"
                  placeholder="Claude, Slack workflow, Zapier..."
                  type="text"
                />
              </label>
              <SubmitButton className="f9-primary-button" intent="create-api-key" pendingLabel="Creating…">
                Create API key
              </SubmitButton>
            </Form>
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
                <dt>Slack copy</dt>
                <dd>/api/v1/digests/&lbrace;id&rbrace;?format=slack</dd>
              </div>
              <div>
                <dt>MCP</dt>
                <dd>POST /api/mcp</dd>
              </div>
              <div>
                <dt>Header</dt>
                <dd>Authorization: Bearer your Five to Nine API key</dd>
              </div>
            </dl>
            <p className="f9-muted-copy">
              This API can read saved manual external proof links in boards, but does not add automated
              TikTok, Google, LinkedIn, Pinterest, or write access.
            </p>
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
                <p>Create one when you are ready to connect a tool or agent workflow.</p>
              </div>
            </article>
          )}
        </div>
      </section>

      <section className="f9-app-panel f9-source-setup">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Slack delivery</span>
            <h2>Send competitor changes to Slack</h2>
          </div>
        </div>

        <p className="f9-muted-copy">
          Add an incoming webhook from your Slack app. Five to Nine stores the webhook encrypted and sends eligible
          digests and high-priority change alerts through the delivery engine.
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

      <section className="f9-app-panel f9-source-setup">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">WhatsApp delivery</span>
            <h2>WhatsApp is guarded until proof exists</h2>
          </div>
        </div>

        <p className="f9-muted-copy">
          WhatsApp delivery stays off for customer channels until provider setup, customer enablement, opt-in,
          validation, template eligibility, webhook readiness, and successful delivery proof are all present.
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
            <span className="f9-app-kicker">Readiness</span>
            <h3>What must pass</h3>
            <dl className="proof-trail-list">
              <div>
                <dt>Setup template</dt>
                <dd>Meta must accept the customer template before the target becomes usable.</dd>
              </div>
              <div>
                <dt>Webhook proof</dt>
                <dd>Launch readiness waits for delivered status from the WhatsApp webhook.</dd>
              </div>
              <div>
                <dt>Customer lane</dt>
                <dd>Customer WhatsApp delivery must be explicitly enabled in production.</dd>
              </div>
            </dl>
          </section>
        </div>

        <dl className="proof-trail-list">
          <div>
            <dt>Provider</dt>
            <dd>{data.whatsappDelivery.providerConfigured ? "Configured" : "Not configured"}</dd>
          </div>
          <div>
            <dt>Customer delivery</dt>
            <dd>{data.whatsappDelivery.customerReady ? "Enabled" : "Not enabled"}</dd>
          </div>
          <div>
            <dt>Webhook</dt>
            <dd>{data.whatsappDelivery.webhookConfigured ? "Configured" : "Not configured"}</dd>
          </div>
          <div>
            <dt>Targets</dt>
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
                      " · no delivered proof yet"
                    )}
                  </p>
                </div>
              </article>
            ))
          ) : (
            <article className="f9-work-row">
              <div>
                <strong>No WhatsApp recipient connected</strong>
                <p>Add an opted-in recipient after WhatsApp provider and webhook setup are ready.</p>
              </div>
            </article>
          )}
        </div>
      </section>

      <article className="f9-app-panel f9-callout-panel">
        <span className="f9-app-kicker">Reliability guardrail</span>
        <p>
          If fresh ad checks are delayed, website snapshots, visible offer text checks, and reports can
          still continue independently.
        </p>
      </article>
    </section>
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

function formatSuccessRate(value: number | null) {
  if (value === null) {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
}

function formatReadinessLabel(label: string) {
  return label.replace(/^Beta:\s*/i, "");
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

function formatReadinessBlocker(blocker: string) {
  const labels: Record<string, string> = {
    missing_db: "Production database signals are unavailable.",
    no_recent_live_success: "No fresh live success in the last 24 hours.",
    not_enough_live_samples: "Not enough live samples yet.",
    recent_live_failures: "There were live failures in the last 24 hours.",
    success_rate_below_95_percent: "Seven-day success rate is below 95%.",
    visual_path_not_healthy: "The visual capture path is not consistently healthy yet.",
  };

  return labels[blocker] ?? blocker.replaceAll("_", " ");
}
