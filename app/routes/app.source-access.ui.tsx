import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { ConfirmSubmitButton } from "~/components/confirm-button";
import { EmptyState } from "~/components/empty-state";
import { LocalTime } from "~/components/local-time";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { SubmitButton } from "~/components/submit-button";
import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";
import type { NullableString, RouteActionData } from "~/routes/workspace-settings.shared";

export const sourceAccessMeta: MetaFunction = () => [
  { title: "Source access | Five to Nine" },
  {
    name: "description",
    content: "Manage backup Meta access and tracking reliability for Five to Nine.",
  },
];

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
								<EmptyState title="No backup Meta access is connected yet." variant="inline" />
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
										<ConfirmSubmitButton
											className="f9-secondary-button"
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
            </section>
          </div>
        </section>
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
	return (
		customerDiscoverySummary(summary) ??
		"Tracking status will appear after the first check."
	);
}
