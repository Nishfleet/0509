import { Form, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { ActionFeedback } from "~/components/action-feedback";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { EmptyState } from "~/components/empty-state";
import { LocalTime } from "~/components/local-time";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { SubmitButton } from "~/components/submit-button";
import type { NullableString, RouteActionData } from "~/routes/workspace-settings.shared";

export const developerAccessMeta: MetaFunction = () => [
  { title: "Developer access | Five to Nine" },
  {
    name: "description",
    content: "Manage API keys for exports and approved account actions in Five to Nine.",
  },
];

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
  canCreateApiKeys?: boolean;
  createDisabledReason?: NullableString;
  apiKeys: CustomerApiKeyView[];
};

type DeveloperAccessActionData = RouteActionData & {
  apiKeySecret?: string;
  apiKeyPrefix?: string;
  apiKeyId?: string;
};

export function DeveloperAccessRoute() {
  const data = useLoaderData<DeveloperAccessLoaderData>();
  const actionData = useActionData<DeveloperAccessActionData>();
  const activeApiKeyCount = data.apiKeys.filter((apiKey) => !apiKey.revokedAt).length;
  const writeEnabledApiKeyCount = data.apiKeys.filter((apiKey) => !apiKey.revokedAt && apiKey.actionsWriteEnabled).length;
  const hasNewApiKeySecret = Boolean(actionData && "apiKeySecret" in actionData && actionData.apiKeySecret);
  const canCreateApiKeys = data.canCreateApiKeys !== false && !data.createDisabledReason;
  const createDisabledReason = data.createDisabledReason ?? null;
  const ownerManagedApiKeys = Boolean(createDisabledReason?.startsWith("Only "));

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

          <ActionFeedback data={actionData} fallback />

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
                  <dd>{"/api/v1/watchlists/{id}?format=json"}</dd>
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
              {createDisabledReason ? (
                <div aria-live="assertive" className="f9-message is-error" role="alert">
                  <p>{createDisabledReason}</p>
                </div>
              ) : null}
              {!hasNewApiKeySecret ? (
                <ActionFeedback data={actionData} intent="create-api-key" />
              ) : null}
              {hasNewApiKeySecret && actionData && "apiKeySecret" in actionData ? (
                <div className="f9-message is-success" role="status">
                  <p>Copy this key now. Five to Nine stores only the hashed key and cannot show it again.</p>
                  <label className="f9-field">
                    <span>{actionData.apiKeyPrefix}</span>
                    <textarea readOnly rows={3} value={actionData.apiKeySecret} />
                  </label>
                </div>
              ) : null}
              <Form className="f9-auth-form" method="post">
                <input name="intent" type="hidden" value="create-api-key" />
                <label className="f9-field">
                  <span>Key name</span>
                  <input
                    autoComplete="off"
                    disabled={!canCreateApiKeys}
                    name="apiKeyName"
                    placeholder="Zapier, workflow script, assistant..."
                    type="text"
                  />
                </label>
                <label className="f9-checkbox-row">
                  <input disabled={!canCreateApiKeys} name="actionsWriteEnabled" type="checkbox" value="1" />
                  <span>Allow approved account actions</span>
                </label>
                <SubmitButton
                  className="f9-primary-button"
                  disabled={!canCreateApiKeys}
                  intent="create-api-key"
                  pendingLabel="Creating…"
                >
                  {canCreateApiKeys ? "Create API key" : "API keys unavailable"}
                </SubmitButton>
              </Form>
            </section>
          </div>

          <ActionFeedback data={actionData} intent="revoke-api-key" />
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
                      <ConfirmSubmitButton
                        className="f9-secondary-button"
                        confirmLabel="Confirm — revoke key?"
                        intent="revoke-api-key"
                        match={{ apiKeyId: apiKey.id }}
                        pendingLabel="Removing…"
                      >
                        Revoke
                      </ConfirmSubmitButton>
                    </Form>
                  )}
                </article>
              ))
            ) : (
              <EmptyState
                description={
                  ownerManagedApiKeys
                    ? createDisabledReason ?? "API keys are managed by the account owner."
                    : "Create one when you are ready to connect an external tool."
                }
                title={ownerManagedApiKeys ? "API keys are managed by the account owner" : "No API keys yet"}
                variant="row"
              />
            )}
          </div>
        </section>
      </section>
    </DashboardPage>
  );
}
