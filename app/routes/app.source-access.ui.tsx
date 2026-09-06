import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { ConfirmSubmitButton } from "~/components/confirm-button";
import { LocalTime } from "~/components/local-time";
import { DashboardPage } from "~/components/dashboard-page";
import { SubmitButton } from "~/components/submit-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { WorkingHeader } from "~/components/workspace/working-header";
import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";
import type {
  NullableString,
  RouteActionData,
} from "~/routes/workspace-settings.shared";

export const sourceAccessMeta: MetaFunction = () => [
  { title: "Source access | Five to Nine" },
  {
    name: "description",
    content:
      "Manage backup Meta access and tracking reliability for Five to Nine.",
  },
];

type SourceAccessConnection = {
  status: string;
  tokenLastFour: string;
  summary: NullableString;
  lastCheckedAt: NullableString;
  updatedAt: string;
};

type SourceAccessDiscoveryStatus = {
  status: string;
  summary?: NullableString;
};

export type SourceAccessLoaderData = {
  connection: SourceAccessConnection | null;
  discoveryStatus: SourceAccessDiscoveryStatus;
  canManageSourceAccess: boolean;
};

export function SourceAccessRoute() {
  const data = useLoaderData<SourceAccessLoaderData>();
  const actionData = useActionData<RouteActionData>();
  const canManageSourceAccess = data.canManageSourceAccess !== false;
  const connectionStatus = data.connection
    ? formatConnectionStatus(data.connection.status)
    : "Not connected";
  const discoveryStatus = formatDiscoveryStatus(data.discoveryStatus.status);

  return (
    <DashboardPage className="f9-wk-page f9-access-page f9-access-source">
      <WorkingHeader
        context="Public checks run first. Backup Meta access keeps this workspace checking when Meta limits them."
        title="Source access"
      />

      {actionData?.message ? (
        <FeedbackStrip
          label={actionData.ok ? "Access updated" : "Access issue"}
          tone={actionData.ok ? "ok" : "bad"}
        >
          {actionData.message}
        </FeedbackStrip>
      ) : null}

      <section aria-labelledby="source-status-title" className="f9-access-section">
        <div className="f9-access-section-head">
          <div>
            <h2 id="source-status-title">Backup Meta ad checks</h2>
            <p>
              Public checks stay primary. A saved token is used only as backup for this
              account.
            </p>
          </div>
          <Link className="f9-access-text-action" to="/app/notifications">
            Notification settings <span aria-hidden="true">&rsaquo;</span>
          </Link>
        </div>

        <div aria-label="Source access status" className="f9-access-rows" role="list">
          <div
            className="f9-access-status-row"
            data-bl040-first-row
            role="listitem"
          >
            <div>
              <strong>Tracking status</strong>
              <p>{formatTrackingStatusSummary(data.discoveryStatus.summary)}</p>
            </div>
            <span
              className={`f9-access-status${discoveryStatus.tone === "bad" ? " is-bad" : ""}`}
            >
              {discoveryStatus.label}
            </span>
          </div>
          <div className="f9-access-status-row" role="listitem">
            <div>
              <strong>Backup access</strong>
              {data.connection && canManageSourceAccess ? (
                <p>
                  Token ending in {data.connection.tokenLastFour}
                  {data.connection.lastCheckedAt ? (
                    <>
                      {" "}
                      · tested <LocalTime iso={data.connection.lastCheckedAt} />
                    </>
                  ) : null}
                </p>
              ) : (
                <p>
                  {canManageSourceAccess
                    ? "Add a token only if you want a fallback when public access is limited."
                    : "The account owner manages the saved token."}
                </p>
              )}
            </div>
            <span
              className={`f9-access-status${
                data.connection?.status === "degraded" ? " is-bad" : ""
              }`}
            >
              {connectionStatus}
            </span>
          </div>
        </div>
      </section>

      {canManageSourceAccess ? (
        <section aria-labelledby="source-connect-title" className="f9-access-section">
          <div className="f9-access-section-head">
            <div>
              <h2 id="source-connect-title">Add backup Meta access</h2>
              <p>
                The token is stored encrypted and used only to check ads for this account.
              </p>
            </div>
          </div>

          <div className="f9-access-setup">
            <div className="f9-access-instructions">
              <h3>Get a token from Meta</h3>
              <ol>
                <li>
                  Open Meta&apos;s{" "}
                  <a
                    href="https://www.facebook.com/ads/library/api/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Ad Library API page
                  </a>
                  .
                </li>
                <li>Confirm identity and location if Meta asks.</li>
                <li>Create or select a Meta for Developers app.</li>
                <li>
                  Generate an access token in{" "}
                  <a
                    href="https://developers.facebook.com/tools/explorer/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Graph API Explorer
                  </a>
                  .
                </li>
                <li>Paste the full token here. Five to Nine tests it before saving.</li>
              </ol>
            </div>

            <div className="f9-access-form-column">
              <Form className="f9-access-form" method="post">
                <input name="intent" type="hidden" value="connect-meta-token" />
                <label className="f9-access-field">
                  <span>Meta access token</span>
                  <textarea
                    autoComplete="off"
                    name="metaToken"
                    placeholder="Paste the full Meta access token"
                    rows={5}
                  />
                </label>
                <SubmitButton
                  className="f9-wk-btn"
                  intent="connect-meta-token"
                  pendingLabel="Saving…"
                >
                  Test and save access
                </SubmitButton>
              </Form>

              {data.connection ? (
                <div className="f9-access-text-actions">
                  <Form method="post">
                    <input name="intent" type="hidden" value="retest-meta-token" />
                    <SubmitButton
                      className="f9-access-text-action"
                      intent="retest-meta-token"
                      pendingLabel="Testing…"
                    >
                      Retest saved access
                    </SubmitButton>
                  </Form>
                  <Form method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value="disconnect-meta-token"
                    />
                    <ConfirmSubmitButton
                      className="f9-access-text-action is-danger"
                      confirmLabel="Confirm — disconnect?"
                      intent="disconnect-meta-token"
                      pendingLabel="Removing…"
                      variant="light"
                    >
                      Disconnect
                    </ConfirmSubmitButton>
                  </Form>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section aria-labelledby="source-owner-title" className="f9-access-section">
          <div className="f9-access-quiet">
            <h2 id="source-owner-title">The account owner manages source access</h2>
            <p>
              You can read the current tracking state here. Only the account owner can add,
              retest, or disconnect the backup token.
            </p>
          </div>
        </section>
      )}

      <p className="f9-wk-opline">
        Public checks remain the primary source. A missing backup token does not mean
        monitoring is off.
      </p>
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

function formatDiscoveryStatus(status: string): {
  label: string;
  tone: "quiet" | "bad";
} {
  if (status === "cache_only") {
    return { label: "Using recent results", tone: "quiet" };
  }
  if (status === "healthy") {
    return { label: "Live tracking ready", tone: "quiet" };
  }
  if (status === "demo") {
    return { label: "Needs setup", tone: "bad" };
  }
  if (status === "degraded") {
    return { label: "Needs attention", tone: "bad" };
  }
  if (status === "disabled") {
    return { label: "Unavailable", tone: "bad" };
  }
  return { label: "Needs attention", tone: "bad" };
}

function formatTrackingStatusSummary(summary: string | null | undefined) {
  return (
    customerDiscoverySummary(summary) ??
    "Tracking status will appear after the first check."
  );
}
