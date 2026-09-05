import { useEffect, useId, useState } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { ConfirmSubmitButton } from "~/components/confirm-button";
import { LocalTime } from "~/components/local-time";
import { DashboardPage } from "~/components/dashboard-page";
import { SubmitButton } from "~/components/submit-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { WorkingHeader } from "~/components/workspace/working-header";
import type {
  NullableString,
  RouteActionData,
} from "~/routes/workspace-settings.shared";

export const developerAccessMeta: MetaFunction = () => [
  { title: "Developer access | Five to Nine" },
  {
    name: "description",
    content:
      "Manage API keys for exports and approved account actions in Five to Nine.",
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
  const activeApiKeys = data.apiKeys.filter((apiKey) => !apiKey.revokedAt);
  const activeApiKeyCount = activeApiKeys.length;
  const writeEnabledApiKeyCount = activeApiKeys.filter(
    (apiKey) => apiKey.actionsWriteEnabled,
  ).length;
  const hasNewApiKeySecret = Boolean(
    actionData &&
      "apiKeySecret" in actionData &&
      actionData.apiKeySecret,
  );
  const canCreateApiKeys =
    data.canCreateApiKeys !== false && !data.createDisabledReason;
  const createDisabledReason = data.createDisabledReason ?? null;
  const ownerManagedApiKeys = Boolean(
    createDisabledReason?.startsWith("Only "),
  );
  const planLocked = Boolean(createDisabledReason && !ownerManagedApiKeys);

  return (
    <DashboardPage className="f9-wk-page f9-access-page f9-access-developer">
      <WorkingHeader
        action={
          planLocked
            ? {
                label: "Upgrade to Agency",
                to: "/app/billing?source=developer-access#plans",
              }
            : null
        }
        context={`${activeApiKeyCount} active ${
          activeApiKeyCount === 1 ? "key" : "keys"
        } · ${writeEnabledApiKeyCount} with approved actions · saved account data only`}
        title="Developer access"
      />

      {actionData?.message && !hasNewApiKeySecret ? (
        <FeedbackStrip
          label={actionData.ok ? "Access updated" : "Access issue"}
          tone={actionData.ok ? "ok" : "bad"}
        >
          {actionData.message}
        </FeedbackStrip>
      ) : null}

      <section aria-labelledby="developer-scope-title" className="f9-access-section">
        <div className="f9-access-section-head">
          <div>
            <h2 id="developer-scope-title">Connect exports and approved actions</h2>
            <p>
              Read keys reach saved workspace material. Write access is for trusted,
              approved account actions.
            </p>
          </div>
          <div className="f9-access-text-actions">
            <a
              className="f9-access-text-action"
              href="/mcp/setup"
              rel="noreferrer"
              target="_blank"
            >
              MCP setup <span aria-hidden="true">&rsaquo;</span>
            </a>
            <a
              className="f9-access-text-action"
              href="/api/docs"
              rel="noreferrer"
              target="_blank"
            >
              API docs <span aria-hidden="true">&rsaquo;</span>
            </a>
          </div>
        </div>

        <div aria-label="API connection facts" className="f9-access-rows" role="list">
          <div
            className="f9-access-fact-row"
            data-bl040-first-row
            role="listitem"
          >
            <span>JSON endpoint</span>
            <code>{"/api/v1/watchlists/{id}?format=json"}</code>
          </div>
          <div className="f9-access-fact-row" role="listitem">
            <span>Authorization</span>
            <code>Bearer your Five to Nine API key</code>
          </div>
          <div className="f9-access-fact-row" role="listitem">
            <span>Coverage</span>
            <p>
              Saved account data and manual external evidence links. This does not add
              automated TikTok, Google, LinkedIn, or Pinterest ingestion.
            </p>
          </div>
        </div>
      </section>

      {hasNewApiKeySecret &&
      actionData &&
      actionData.apiKeySecret &&
      actionData.apiKeyPrefix ? (
        <section
          aria-labelledby="new-key-title"
          aria-live="polite"
          className="f9-access-section"
          role="status"
        >
          <div className="f9-access-section-head">
            <div>
              <h2 id="new-key-title">Copy the new key now</h2>
              <p>
                Five to Nine stores only the hashed key and cannot show the full secret
                again.
              </p>
            </div>
          </div>
          <NewApiKeySecret
            key={actionData.apiKeyPrefix}
            prefix={actionData.apiKeyPrefix}
            secret={actionData.apiKeySecret}
          />
        </section>
      ) : null}

      {canCreateApiKeys ? (
        <section aria-labelledby="create-key-title" className="f9-access-section">
          <div className="f9-access-section-head">
            <div>
              <h2 id="create-key-title">Create an API key</h2>
              <p>
                Name the tool, keep it read-only by default, and revoke it here when the
                connection is retired.
              </p>
            </div>
          </div>
          <Form className="f9-access-key-form" method="post">
            <input name="intent" type="hidden" value="create-api-key" />
            <label className="f9-access-field">
              <span>Key name</span>
              <input
                autoComplete="off"
                name="apiKeyName"
                placeholder="Workflow script or reporting tool"
                type="text"
              />
            </label>
            <label className="f9-access-check">
              <input
                name="actionsWriteEnabled"
                type="checkbox"
                value="1"
              />
              <span>
                Allow approved account actions
                <small>Leave off for exports and reporting.</small>
              </span>
            </label>
            <SubmitButton
              className="f9-wk-btn"
              intent="create-api-key"
              pendingLabel="Creating…"
            >
              Create API key
            </SubmitButton>
          </Form>
        </section>
      ) : (
        <section aria-labelledby="developer-lock-title" className="f9-access-section">
          <div className="f9-access-quiet">
            <h2 id="developer-lock-title">
              {ownerManagedApiKeys
                ? "API keys are managed by the account owner"
                : "Developer access is on Agency"}
            </h2>
            <p>
              {createDisabledReason ??
                "Developer access is included in the Agency plan. Upgrade to Agency to create API keys."}
            </p>
            {planLocked ? (
              <p>
                Existing keys remain visible below so you can review or revoke them. The
                Agency upgrade action above is the only step needed to create another.
              </p>
            ) : null}
          </div>
        </section>
      )}

      <section aria-labelledby="api-keys-title" className="f9-access-section">
        <div className="f9-access-section-head">
          <div>
            <h2 id="api-keys-title">API keys</h2>
            <p>
              Full secrets disappear after creation. Rows retain the prefix, scope, and
              activity needed to identify a key safely.
            </p>
          </div>
        </div>

        <div aria-label="API keys" className="f9-access-key-rows" role="list">
          {data.apiKeys.length > 0 ? (
            data.apiKeys.map((apiKey) => (
              <article
                className={`f9-access-key-row${apiKey.revokedAt ? " is-revoked" : ""}`}
                key={apiKey.id}
                role="listitem"
              >
                <div>
                  <strong className="f9-access-key-name">{apiKey.name}</strong>
                  <code>{apiKey.keyPrefix}…</code>
                </div>
                <p>
                  {apiKey.actionsWriteEnabled ? "Approved actions" : "Read-only"}
                  {" · "}
                  {apiKey.lastUsedAt ? (
                    <>
                      last used <LocalTime iso={apiKey.lastUsedAt} />
                    </>
                  ) : (
                    "never used"
                  )}
                </p>
                <span
                  className={`f9-access-status${apiKey.revokedAt ? " is-bad" : ""}`}
                >
                  {apiKey.revokedAt ? (
                    <>
                      Revoked <LocalTime iso={apiKey.revokedAt} />
                    </>
                  ) : (
                    "Active"
                  )}
                </span>
                {apiKey.revokedAt ? (
                  <span aria-hidden="true" className="f9-access-key-spacer" />
                ) : (
                  <Form method="post">
                    <input name="intent" type="hidden" value="revoke-api-key" />
                    <input name="apiKeyId" type="hidden" value={apiKey.id} />
                    <ConfirmSubmitButton
                      className="f9-access-text-action is-danger"
                      confirmLabel="Confirm — revoke key?"
                      intent="revoke-api-key"
                      match={{ apiKeyId: apiKey.id }}
                      pendingLabel="Removing…"
                      variant="light"
                    >
                      Revoke
                    </ConfirmSubmitButton>
                  </Form>
                )}
              </article>
            ))
          ) : (
            <div className="f9-access-empty-row" role="listitem">
              <strong>
                {ownerManagedApiKeys
                  ? "No keys are visible to workspace members"
                  : "No API keys yet"}
              </strong>
              <p>
                {ownerManagedApiKeys
                  ? "The account owner can review and manage developer access."
                  : planLocked
                    ? "Upgrade to Agency when an external tool needs account access."
                    : "Create a key when an external tool is ready to connect."}
              </p>
            </div>
          )}
        </div>
      </section>

      <p className="f9-wk-opline">
        Use read-only keys unless a trusted workflow needs an approved account action.
      </p>
    </DashboardPage>
  );
}

function NewApiKeySecret({
  prefix,
  secret,
}: {
  prefix: string;
  secret: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const statusId = `new-api-key-status-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copySecret() {
    setCopyState("idle");
    try {
      await navigator.clipboard.writeText(secret);
      setCopyState("copied");
    } catch {
      setRevealed(true);
      setCopyState("error");
    }
  }

  return (
    <div className="f9-access-secret-row">
      <input
        aria-label={`New API key beginning ${prefix}`}
        className="f9-access-secret-control"
        readOnly
        type={revealed ? "text" : "password"}
        value={secret}
      />
      <div className="f9-access-text-actions">
        <button
          aria-pressed={revealed}
          className="f9-access-text-action"
          onClick={() => setRevealed((value) => !value)}
          type="button"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button
          aria-describedby={statusId}
          className="f9-access-text-action"
          onClick={() => void copySecret()}
          type="button"
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Try copy again"
              : "Copy"}
        </button>
      </div>
      <span
        className="f9-sr-only"
        id={statusId}
      >
        {copyState === "copied"
          ? "API key copied."
          : copyState === "error"
            ? "Could not copy the API key. Select and copy it manually."
            : ""}
      </span>
    </div>
  );
}
